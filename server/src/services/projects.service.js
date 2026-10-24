import mongoose from 'mongoose';
import { BrandProfile, Campaign, CreatorProfile, Message, Project } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { mapBy } from '../utils/db.js';
import { pageResult, paginate } from '../utils/http.js';
import { assertBrandCanHire } from './brandVerification.service.js';
import { campaignSummary, creatorSummary, publicBrand, rightsSummary } from './serializers.js';
import { recomputeCreatorTrust } from './trust.service.js';

/* F6 — projects, versions, decisions, messages. F7 — rights snapshot + rights card. */

export const CHANGES_NOTE_MIN = 10;
export const REVISIONS_USED_UP = 'Revision rounds used up — agree extra rounds in messages.';

function deliverablesFromCampaign(campaign) {
  const specs = campaign.deliverables?.length
    ? campaign.deliverables
    : [{ title: 'Final delivery', description: 'Agreed creative assets for this campaign', quantity: 1 }];
  return specs.map((d) => ({
    title: d.quantity > 1 ? `${d.title} ×${d.quantity}` : d.title,
    description: d.description ?? '',
    specNote: (d.description ?? '').slice(0, 200),
    dueDate: campaign.deadline ?? undefined,
    status: 'pending',
  }));
}

/**
 * Creates the single project for a campaign/creator pair, or returns the existing one.
 * The upsert plus the unique { campaignId, creatorId } index make this idempotent.
 * Rights are snapshotted here so later campaign edits never change a live project (F7).
 */
export async function createProjectFromSource({ campaign, creatorId, sourceType, sourceId }, session) {
  // Safety net: every way of starting a project goes through here. An invitation is accepted by the creator.
  await assertBrandCanHire(campaign.brandId, { actor: sourceType === 'invitation' ? 'creator' : 'brand' });
  try {
    return await Project.findOneAndUpdate(
      { campaignId: campaign._id, creatorId },
      {
        $setOnInsert: {
          campaignId: campaign._id,
          creatorId,
          brandId: campaign.brandId,
          sourceType,
          sourceId,
          status: 'not_started',
          deliverables: deliverablesFromCampaign(campaign),
          revisionsIncluded: campaign.revisionsIncluded ?? 2,
          revisionsUsed: 0,
          ...(campaign.clientId ? { clientId: campaign.clientId, clientName: campaign.clientName } : {}),
          ...(campaign.rights ? { rightsSnapshot: JSON.parse(JSON.stringify(campaign.rights)) } : {}),
        },
      },
      { upsert: true, returnDocument: 'after', session, setDefaultsOnInsert: true },
    ).lean();
  } catch (err) {
    // A concurrent upsert can lose the race on the unique index; the winner's project is the one we want.
    if (err?.code === 11000) return Project.findOne({ campaignId: campaign._id, creatorId }).session(session).lean();
    throw err;
  }
}

async function hydrate(projects) {
  const [campaigns, creators, brands] = await Promise.all([
    mapBy(Campaign, projects.map((p) => p.campaignId)),
    mapBy(CreatorProfile, projects.map((p) => p.creatorId)),
    mapBy(BrandProfile, projects.map((p) => p.brandId), { key: 'userId' }),
  ]);
  // The approval links (tokens' hashes, approver contact details) are the agency's: getProject adds them back for the brand.
  return projects.map(({ approvalLinks: _links, ...p }) => ({
    ...p,
    rightsSummary: rightsSummary(p.rightsSnapshot),
    campaign: campaignSummary(campaigns.get(String(p.campaignId))),
    creator: creatorSummary(creators.get(String(p.creatorId))),
    brand: publicBrand(brands.get(String(p.brandId))),
  }));
}

export async function listProjects(filter, q, user) {
  if (q.status) filter.status = q.status;
  if (q.clientId) filter.clientId = q.clientId;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Project.find(filter).sort({ updatedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Project.countDocuments(filter),
  ]);
  const items = await hydrate(docs);
  if (user) {
    const unread = await unreadByProject(user, docs.map((d) => d._id));
    for (const p of items) p.unreadCount = unread[String(p._id)] ?? 0;
  }
  return pageResult(items, total, pg);
}

/** Who is this user in the project? Returns 'creator' | 'brand' or throws 404 for non-participants. */
async function participantRole(project, user) {
  if (user.role === 'brand' && String(project.brandId) === String(user._id)) return 'brand';
  if (user.role === 'creator') {
    const profile = await CreatorProfile.findOne({ userId: user._id }, '_id').lean();
    if (profile && String(profile._id) === String(project.creatorId)) return 'creator';
  }
  throw ApiError.notFound('Project not found');
}

export async function loadForParticipant(user, id, { lean = false } = {}) {
  const query = Project.findById(id);
  const project = lean ? await query.lean() : await query;
  if (!project) throw ApiError.notFound('Project not found');
  const role = await participantRole(project, user);
  return { project, role };
}

export async function getProject(user, id) {
  const { project, role } = await loadForParticipant(user, id, { lean: true });
  const [hydrated] = await hydrate([project]);
  const campaign = await Campaign.findById(project.campaignId, 'brief deliverables requiredSkills requiredTools style formats languages contentType').lean();
  const unread = await unreadByProject(user, [project._id]);
  // Approval links belong to the agency (brand side): never sent to the creator, and never with their token hash.
  const approvalLinks = role === 'brand' ? (project.approvalLinks ?? []).map(({ tokenHash: _h, ...link }) => link) : undefined;
  return {
    project: { ...hydrated, ...(approvalLinks ? { approvalLinks } : {}), campaign: { ...hydrated.campaign, ...campaign }, unreadCount: unread[String(project._id)] ?? 0 },
    viewerRole: role,
  };
}

/* ---------- System messages ---------- */

export async function systemMessage(projectId, body, about) {
  const now = new Date();
  await Message.create({ projectId, senderRole: 'system', kind: 'system', body, ...(about ? { about } : {}) });
  await Project.updateOne({ _id: projectId }, { $set: { lastMessageAt: now } });
}

/* ---------- Status helpers ---------- */

/** Project status implied by the deliverables (F6 flow). Closed projects are left alone. */
function statusFromDeliverables(project) {
  const ds = project.deliverables;
  if (ds.length && ds.every((d) => d.status === 'approved')) return 'completed';
  if (ds.some((d) => d.status === 'revision_requested')) return 'revision_requested';
  if (ds.every((d) => ['submitted', 'approved'].includes(d.status)) && ds.some((d) => d.status === 'submitted')) return 'submitted';
  if (ds.some((d) => d.currentVersion > 0 || d.status !== 'pending')) return 'in_progress';
  return project.status;
}

const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

async function rightsCardFor(project) {
  const [creator, brand] = await Promise.all([
    CreatorProfile.findById(project.creatorId, 'displayName').lean(),
    BrandProfile.findOne({ userId: project.brandId }, 'companyName').lean(),
  ]);
  const rights = project.rightsSnapshot ?? {};
  const validFrom = project.completedAt ?? new Date();
  const tools = new Set();
  for (const d of project.deliverables) {
    const approved = [...(d.versions ?? [])].reverse().find((v) => v.status === 'approved') ?? d.versions?.at(-1);
    for (const t of approved?.toolsUsed ?? []) tools.add(t);
  }
  return {
    number: `UN-${validFrom.getFullYear()}-${String(1000 + Math.floor(Math.random() * 9000))}`,
    validFrom,
    validTo: rights.durationMonths ? addMonths(validFrom, rights.durationMonths) : null,
    summary: rightsSummary(rights) ?? 'Rights as agreed in the brief',
    toolsUsed: [...tools],
    creatorName: creator?.displayName ?? 'Creator',
    brandName: brand?.companyName ?? 'Brand',
    ...(project.clientName ? { clientName: project.clientName } : {}),
    createdAt: new Date(),
  };
}

/**
 * Completion side effects (both the Round 1 status route and the F6 decision route):
 * rights card (unique number, retried on the rare collision), ★ Made on UNIO recompute, system message.
 */
async function completeProject(project) {
  project.status = 'completed';
  project.completedAt = project.completedAt ?? new Date();
  for (let attempt = 0; ; attempt += 1) {
    if (!project.rightsCard?.number) project.rightsCard = await rightsCardFor(project);
    try {
      await project.save();
      break;
    } catch (err) {
      if (err?.code === 11000 && attempt < 5) {
        project.rightsCard = undefined;
        continue;
      }
      throw err;
    }
  }
  await recomputeCreatorTrust(project.creatorId);
  await systemMessage(project._id, `Project completed · rights card ${project.rightsCard.number} issued`);
}

/* ---------- Round 1 status + deliverable routes (kept) ---------- */

/** Allowed project transitions per participant role. */
export const PROJECT_TRANSITIONS = {
  creator: {
    not_started: ['in_progress'],
    in_progress: ['submitted'],
    revision_requested: ['in_progress', 'submitted'],
  },
  brand: {
    not_started: ['cancelled'],
    in_progress: ['cancelled'],
    submitted: ['completed', 'revision_requested', 'cancelled'],
    revision_requested: ['cancelled'],
  },
};

export async function updateProjectStatus(user, id, status) {
  const { project, role } = await loadForParticipant(user, id);

  if (!PROJECT_TRANSITIONS[role][project.status]?.includes(status)) {
    throw ApiError.invalidTransition(project.status, status);
  }
  if (status === 'submitted' && project.deliverables.some((d) => !['submitted', 'approved'].includes(d.status))) {
    throw ApiError.conflict('Submit every deliverable before submitting the project', 'DELIVERABLES_INCOMPLETE');
  }
  if (status === 'completed' && project.deliverables.some((d) => d.status !== 'approved')) {
    throw ApiError.conflict('Approve every deliverable before completing the project', 'DELIVERABLES_INCOMPLETE');
  }

  if (status === 'completed') {
    await completeProject(project);
  } else {
    project.status = status;
    await project.save();
    if (status === 'cancelled') await systemMessage(project._id, 'The brand cancelled this project.');
  }
  return getProject(user, id);
}

/** Brand feedback: real, one-time, only after the work is completed. */
export async function addFeedback(user, id, { rating, comment }) {
  const { project, role } = await loadForParticipant(user, id);
  if (role !== 'brand') throw ApiError.forbidden('Only the brand on this project can leave feedback');
  if (project.status !== 'completed') throw ApiError.conflict('Feedback can be left once the project is completed', 'NOT_COMPLETED');
  if (project.feedback?.rating) throw ApiError.conflict('Feedback has already been left for this project', 'ALREADY_REVIEWED');
  project.feedback = { rating, comment: comment ?? '', createdAt: new Date() };
  await project.save();
  await recomputeCreatorTrust(project.creatorId);
  return getProject(user, id);
}

const DELIVERABLE_TRANSITIONS = {
  creator: { pending: ['submitted'], revision_requested: ['submitted'] },
  brand: { submitted: ['approved', 'revision_requested'] },
};

const assertOpen = (project) => {
  if (['completed', 'cancelled'].includes(project.status)) {
    throw ApiError.conflict(`This project is ${project.status} and can no longer be changed`, 'PROJECT_CLOSED');
  }
};

export async function updateDeliverable(user, id, deliverableId, { mediaUrl, status }) {
  const { project, role } = await loadForParticipant(user, id);
  assertOpen(project);

  const deliverable = project.deliverables.id(deliverableId);
  if (!deliverable) throw ApiError.notFound('Deliverable not found');

  if (mediaUrl !== undefined) {
    if (role !== 'creator') throw ApiError.forbidden('Only the creator can attach delivery media');
    if (!['pending', 'revision_requested'].includes(deliverable.status)) {
      throw ApiError.conflict('Media can only be changed before the deliverable is submitted', 'INVALID_TRANSITION');
    }
    deliverable.mediaUrl = mediaUrl || undefined;
  }

  if (status !== undefined && status !== deliverable.status) {
    if (!DELIVERABLE_TRANSITIONS[role][deliverable.status]?.includes(status)) {
      throw ApiError.invalidTransition(deliverable.status, status);
    }
    if (status === 'submitted' && !deliverable.mediaUrl) {
      throw ApiError.badRequest('Add a media link before submitting this deliverable', [
        { location: 'body', field: 'mediaUrl', message: 'Media link is required to submit' },
      ]);
    }
    deliverable.status = status;
    // Keep the overall project state in step with deliverable activity.
    if (role === 'creator' && project.status === 'not_started') project.status = 'in_progress';
    if (role === 'brand' && status === 'revision_requested') project.status = 'revision_requested';
  }

  await project.save();
  return getProject(user, id);
}

/* ---------- F6: versions + decisions ---------- */

/** Creator submits the next version of a deliverable: v(n+1) with "what changed". */
export async function submitVersion(user, id, deliverableId, { mediaUrl, thumbnailUrl, changeNote, toolsUsed = [] }) {
  const { project, role } = await loadForParticipant(user, id);
  if (role !== 'creator') throw ApiError.forbidden('Only the creator on this project can submit versions');
  assertOpen(project);
  const deliverable = project.deliverables.id(deliverableId);
  if (!deliverable) throw ApiError.notFound('Deliverable not found');
  if (deliverable.status === 'approved') throw ApiError.conflict('This deliverable is already approved', 'ALREADY_APPROVED');
  const latest = deliverable.versions.at(-1);
  if (latest?.status === 'submitted') {
    throw ApiError.conflict(`v${latest.number} is still waiting for the brand’s decision`, 'AWAITING_DECISION');
  }

  const number = (deliverable.currentVersion ?? 0) + 1;
  const note = (changeNote ?? '').trim() || (number === 1 ? 'First version' : '');
  if (!note) {
    throw ApiError.badRequest('Say what changed in this version', [{ location: 'body', field: 'changeNote', message: 'Describe what changed since the last version' }]);
  }

  deliverable.versions.push({ number, mediaUrl, thumbnailUrl: thumbnailUrl || undefined, changeNote: note, toolsUsed, status: 'submitted', submittedAt: new Date() });
  deliverable.currentVersion = number;
  deliverable.mediaUrl = mediaUrl;
  deliverable.status = 'submitted';
  project.status = statusFromDeliverables(project);
  await project.save();

  const creator = await CreatorProfile.findById(project.creatorId, 'displayName').lean();
  await systemMessage(project._id, `${creator?.displayName?.split(' ')[0] ?? 'Creator'} uploaded v${number} of “${deliverable.title}”`, { deliverableId: deliverable._id, versionNumber: number });
  return getProject(user, id);
}

/** Brand decides on the latest submitted version: approve, or ask for changes with a note (≥ 10 chars). */
export async function decideVersion(user, id, deliverableId, number, { decision, note }) {
  const { project, role } = await loadForParticipant(user, id);
  if (role !== 'brand') throw ApiError.forbidden('Only the brand on this project can review versions');
  assertOpen(project);
  const deliverable = project.deliverables.id(deliverableId);
  if (!deliverable) throw ApiError.notFound('Deliverable not found');
  const version = deliverable.versions.find((v) => v.number === number);
  if (!version) throw ApiError.notFound('Version not found');
  if (number !== deliverable.currentVersion || version.status !== 'submitted') {
    throw ApiError.conflict('Only the latest submitted version can be reviewed', 'INVALID_TRANSITION');
  }
  const trimmed = (note ?? '').trim();
  if (decision === 'changes' && trimmed.length < CHANGES_NOTE_MIN) {
    throw new ApiError(400, 'NOTE_REQUIRED', `Explain what to change (at least ${CHANGES_NOTE_MIN} characters)`, [
      { location: 'body', field: 'note', message: `Explain what to change (at least ${CHANGES_NOTE_MIN} characters)` },
    ]);
  }

  const brand = await BrandProfile.findOne({ userId: user._id }, 'companyName').lean();
  version.status = decision === 'approve' ? 'approved' : 'changes_requested';
  version.feedback = { note: trimmed, byUserId: user._id, byName: brand?.companyName ?? user.name, byRole: 'brand', at: new Date() };
  deliverable.status = decision === 'approve' ? 'approved' : 'revision_requested';

  let warning = null;
  if (decision === 'changes') {
    // One revision round per review cycle, however many deliverables get changes in it.
    if (project.status !== 'revision_requested') {
      if (project.revisionsUsed >= project.revisionsIncluded) warning = REVISIONS_USED_UP;
      project.revisionsUsed += 1;
    }
  }

  const next = statusFromDeliverables(project);
  const about = { deliverableId: deliverable._id, versionNumber: number };
  if (next === 'completed') {
    await systemMessage(project._id, `${brand?.companyName ?? 'Brand'} approved v${number} of “${deliverable.title}”`, about);
    await completeProject(project);
  } else {
    project.status = next;
    await project.save();
    await systemMessage(
      project._id,
      `${brand?.companyName ?? 'Brand'} ${decision === 'approve' ? 'approved' : 'asked for changes on'} v${number} of “${deliverable.title}”`,
      about,
    );
  }
  const result = await getProject(user, id);
  return warning ? { ...result, warning } : result;
}

/* ---------- F6: messages ---------- */

export async function listMessages(user, id, { after }) {
  const { project } = await loadForParticipant(user, id, { lean: true });
  const filter = { projectId: project._id };
  if (after) filter.createdAt = { $gt: after };
  const items = await Message.find(filter).sort({ createdAt: 1 }).limit(300).lean();
  return {
    items: items.map((m) => ({ ...m, mine: String(m.senderId) === String(user._id), readBy: undefined })),
    serverTime: new Date().toISOString(),
  };
}

export async function postMessage(user, id, { body, about }) {
  const { project, role } = await loadForParticipant(user, id, { lean: true });
  if (project.status === 'cancelled') throw ApiError.conflict('This project was cancelled', 'PROJECT_CLOSED');
  if (about) {
    const d = project.deliverables.find((x) => String(x._id) === about.deliverableId);
    if (!d || !d.versions?.some((v) => v.number === about.versionNumber)) {
      throw ApiError.badRequest('That version doesn’t exist on this project', [{ location: 'body', field: 'about', message: 'Unknown version' }]);
    }
  }
  let senderName = user.name;
  if (role === 'brand') senderName = (await BrandProfile.findOne({ userId: user._id }, 'companyName').lean())?.companyName ?? user.name;
  if (role === 'creator') senderName = (await CreatorProfile.findById(project.creatorId, 'displayName').lean())?.displayName ?? user.name;
  const message = await Message.create({
    projectId: project._id,
    senderId: user._id,
    senderRole: role,
    senderName,
    body,
    kind: 'user',
    ...(about ? { about } : {}),
    readBy: [user._id],
  });
  await Project.updateOne({ _id: project._id }, { $set: { lastMessageAt: message.createdAt } });
  const plain = message.toObject();
  return { ...plain, mine: true, readBy: undefined };
}

export async function markRead(user, id) {
  const { project } = await loadForParticipant(user, id, { lean: true });
  const { modifiedCount } = await Message.updateMany({ projectId: project._id, readBy: { $ne: user._id } }, { $addToSet: { readBy: user._id } });
  return { marked: modifiedCount };
}

/** Unread message counts per project for this user (own messages never count). */
async function unreadByProject(user, projectIds) {
  if (!projectIds.length) return {};
  const uid = new mongoose.Types.ObjectId(String(user._id));
  const rows = await Message.aggregate([
    { $match: { projectId: { $in: projectIds.map((p) => new mongoose.Types.ObjectId(String(p))) }, readBy: { $ne: uid }, senderId: { $ne: uid } } },
    { $group: { _id: '$projectId', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

export async function unreadForUser(user) {
  let filter = null;
  if (user.role === 'brand') filter = { brandId: user._id };
  if (user.role === 'creator') {
    const profile = await CreatorProfile.findOne({ userId: user._id }, '_id').lean();
    if (profile) filter = { creatorId: profile._id };
  }
  if (!filter) return { total: 0, byProject: {} };
  const ids = (await Project.find(filter, '_id').lean()).map((p) => p._id);
  const byProject = await unreadByProject(user, ids);
  return { total: Object.values(byProject).reduce((a, b) => a + b, 0), byProject };
}

/* ---------- F7: rights card ---------- */

export async function getRightsCard(user, id) {
  const { project } = await loadForParticipant(user, id, { lean: true });
  if (!project.rightsCard) throw ApiError.conflict('The rights card is issued when the project is completed', 'NOT_COMPLETED');
  const campaign = await Campaign.findById(project.campaignId, 'title').lean();
  return { card: project.rightsCard, rights: project.rightsSnapshot ?? {}, campaignTitle: campaign?.title ?? '' };
}
