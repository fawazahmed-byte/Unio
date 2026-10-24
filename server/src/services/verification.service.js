import { BrandProfile, Campaign, CreatorProfile, PortfolioItem, Project, VerificationSubmission } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { mapBy } from '../utils/db.js';
import { pageResult, paginate } from '../utils/http.js';
import { requireCreatorProfile } from './profile.service.js';
import { creatorSummary } from './serializers.js';
import { isFlagged, normUrl, runCertificateChecks, runChallengeChecks } from './precheck.service.js';
import { EXPIRY_WARNING_DAYS, isExpired, recomputeCreatorTrust, refreshExpiredTrust } from './trust.service.js';
import crypto from 'node:crypto';
import { TOOL_NAMES } from '../models/taxonomy.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const slug = (s) => s.toLowerCase().trim().replace(/\s+/g, ' ');

function keyFor(type, { subject, portfolioItemId }) {
  return type === 'portfolio' ? `portfolio:${portfolioItemId}` : `${type}:${slug(subject)}`;
}

const DAY = 24 * 60 * 60 * 1000;
export const CHALLENGE_HOURS = 48;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — easy to read off a screen

/** UNIO-XXXX, from a CSPRNG. */
export function newChallengeCode() {
  return `UNIO-${Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('')}`;
}

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

/** What the creator sees of their own claim: no reviewer id; expiry spelled out. */
function ownView(doc, now = new Date()) {
  const { reviewerId: _r, ...rest } = doc.toObject ? doc.toObject() : doc;
  const expired = isExpired(rest, now);
  const expiresInDays = rest.status === 'VERIFIED' && rest.expiresAt && !expired ? Math.ceil((new Date(rest.expiresAt) - now) / DAY) : undefined;
  return { ...rest, expired, expiresInDays, expiringSoon: expiresInDays !== undefined && expiresInDays <= EXPIRY_WARNING_DAYS };
}

/** Creator-editable states. VERIFIED is locked so evidence can't be swapped after approval. */
const CREATOR_EDITABLE = ['SELF_REPORTED', 'PENDING', 'REJECTED'];

/**
 * The only statuses a creator action can produce. VERIFIED/REJECTED are reviewer-only and
 * are never accepted from creator input (the validator does not even allow a status field).
 */
function creatorStatus(submit, evidenceUrls) {
  if (!submit) return 'SELF_REPORTED';
  if (!evidenceUrls?.length) {
    throw ApiError.badRequest('Add at least one evidence link before submitting for review', [
      { location: 'body', field: 'evidenceUrls', message: 'At least one evidence link is required to submit' },
    ]);
  }
  return 'PENDING';
}

async function resolvePortfolioSubject(profile, portfolioItemId) {
  const item = await PortfolioItem.findOne({ _id: portfolioItemId, creatorId: profile._id }, 'title').lean();
  if (!item) throw ApiError.notFound('Portfolio item not found');
  return item.title;
}

/* ------------------------------------------------------------------ */
/* Creator                                                             */
/* ------------------------------------------------------------------ */

export async function listOwn(user) {
  const profile = await requireCreatorProfile(user);
  await refreshExpiredTrust(profile._id);
  const items = await VerificationSubmission.find({ creatorId: profile._id }).sort({ type: 1, updatedAt: -1 }).lean();
  // reviewerId is internal; creators see the decision and note only.
  return items.map((d) => ownView(d));
}

export async function create(user, { type, subject, portfolioItemId, description, evidenceUrls = [], submit, certificate }) {
  const profile = await requireCreatorProfile(user);
  if (type === 'certificate') return createCertificate(profile, { subject, description, certificate, submit });
  if (type === 'portfolio') {
    if (!portfolioItemId) throw ApiError.badRequest('Choose a portfolio piece', [{ location: 'body', field: 'portfolioItemId', message: 'Required' }]);
    subject = await resolvePortfolioSubject(profile, portfolioItemId);
  }
  const status = creatorStatus(submit, evidenceUrls);
  const key = keyFor(type, { subject, portfolioItemId });

  if (await VerificationSubmission.exists({ creatorId: profile._id, key })) {
    throw ApiError.conflict('You already have a verification entry for this. Edit it instead.', 'ALREADY_EXISTS');
  }
  try {
    const doc = await VerificationSubmission.create({
      creatorId: profile._id,
      type,
      key,
      subject,
      portfolioItemId: type === 'portfolio' ? portfolioItemId : undefined,
      description: description ?? '',
      evidenceUrls,
      method: 'evidence',
      status,
      submittedAt: status === 'PENDING' ? new Date() : undefined,
    });
    await recomputeCreatorTrust(profile._id);
    return ownView(doc);
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('You already have a verification entry for this. Edit it instead.', 'ALREADY_EXISTS');
    throw err;
  }
}

export async function update(user, id, { subject, description, evidenceUrls, submit }) {
  const profile = await requireCreatorProfile(user);
  const doc = await VerificationSubmission.findOne({ _id: id, creatorId: profile._id });
  if (!doc) throw ApiError.notFound('Verification entry not found');
  if (doc.method === 'challenge' || doc.method === 'certificate') {
    throw ApiError.conflict('Use the challenge or certificate flow to change this entry.', 'USE_TRUST_FLOW');
  }
  if (!CREATOR_EDITABLE.includes(doc.status)) {
    throw ApiError.conflict('Verified entries are locked. Withdraw it and create a new one to change the evidence.', 'LOCKED');
  }

  if (subject !== undefined && doc.type !== 'portfolio') {
    doc.subject = subject;
    doc.key = keyFor(doc.type, { subject });
  }
  if (description !== undefined) doc.description = description;
  if (evidenceUrls !== undefined) doc.evidenceUrls = evidenceUrls;

  const status = creatorStatus(submit, doc.evidenceUrls);
  doc.status = status;
  doc.submittedAt = status === 'PENDING' ? new Date() : undefined;
  // Any creator edit starts a fresh review cycle.
  doc.reviewerId = undefined;
  doc.reviewNote = '';
  doc.reviewedAt = undefined;

  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Another entry already covers this tool or workflow', 'ALREADY_EXISTS');
    throw err;
  }
  await recomputeCreatorTrust(profile._id);
  return ownView(doc);
}

export async function remove(user, id) {
  const profile = await requireCreatorProfile(user);
  const res = await VerificationSubmission.deleteOne({ _id: id, creatorId: profile._id });
  if (!res.deletedCount) throw ApiError.notFound('Verification entry not found');
  await recomputeCreatorTrust(profile._id);
  return { deleted: true };
}

/** Called when a portfolio item's media changes: earlier approval no longer covers the new file. */
export async function invalidatePortfolioEvidence(creatorId, portfolioItemId) {
  await VerificationSubmission.updateOne(
    { creatorId, key: `portfolio:${portfolioItemId}`, status: { $in: ['VERIFIED', 'PENDING'] } },
    {
      $set: { status: 'PENDING', submittedAt: new Date(), reviewNote: 'Portfolio media changed — awaiting re-review.' },
      $unset: { reviewerId: 1, reviewedAt: 1 },
    },
  );
  await recomputeCreatorTrust(creatorId);
}

/* ------------------------------------------------------------------ */
/* UNIO Trust: challenge codes and certificates (F5)                   */
/* ------------------------------------------------------------------ */

const canonicalTool = (name) => TOOL_NAMES.find((t) => slug(t) === slug(name)) ?? name.trim();

/** Re-verifying is allowed once an approval is inside its last 30 days, or has lapsed. */
const canReverify = (doc, now) => doc.status !== 'VERIFIED' || (doc.expiresAt && new Date(doc.expiresAt) - now <= EXPIRY_WARNING_DAYS * DAY);

/** Issue a fresh one-time code for a tool (48 h, one use). Creates the claim as self-reported if it is new. */
export async function issueChallenge(user, { tool }) {
  const profile = await requireCreatorProfile(user);
  const subject = canonicalTool(tool);
  const key = keyFor('tool', { subject });
  const now = new Date();
  const existing = await VerificationSubmission.findOne({ creatorId: profile._id, key }).lean();
  if (existing?.status === 'PENDING') throw ApiError.conflict('This tool is already waiting for review.', 'ALREADY_PENDING');
  if (existing && !canReverify(existing, now)) {
    throw ApiError.conflict('This tool is already verified. You can re-verify it during its last 30 days.', 'ALREADY_VERIFIED');
  }
  try {
    const doc = await VerificationSubmission.findOneAndUpdate(
      { creatorId: profile._id, key, status: { $ne: 'PENDING' } },
      {
        $set: {
          method: 'challenge',
          challengeCode: newChallengeCode(),
          challengeIssuedAt: now,
          challengeExpiresAt: new Date(now.getTime() + CHALLENGE_HOURS * 60 * 60 * 1000),
        },
        $unset: { challengeUsedAt: 1 },
        $setOnInsert: { type: 'tool', subject, status: 'SELF_REPORTED', description: '' },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    return ownView(doc);
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('This tool is already waiting for review.', 'ALREADY_PENDING');
    throw err;
  }
}

/** Submit a claim for review: a tool with its recording, or a certificate with its verify link. */
export async function submit(user, id, body = {}) {
  const profile = await requireCreatorProfile(user);
  const doc = await VerificationSubmission.findOne({ _id: id, creatorId: profile._id });
  if (!doc) throw ApiError.notFound('Verification entry not found');
  if (doc.type === 'tool') return submitChallenge(profile, doc, body);
  if (doc.type === 'certificate') return submitCertificate(profile, doc, body);
  throw ApiError.conflict('Workflow and portfolio claims are submitted with evidence links.', 'NOT_SUBMITTABLE');
}

async function submitChallenge(profile, doc, { recordingUrl, screenshotUrls = [] }) {
  const now = new Date();
  if (doc.status === 'PENDING') throw ApiError.conflict('This claim is already in review.', 'ALREADY_PENDING');
  if (doc.method !== 'challenge' || !doc.challengeCode || doc.challengeUsedAt) {
    throw ApiError.conflict('Get a new challenge code first. Each code works once.', 'NO_ACTIVE_CHALLENGE');
  }
  if (doc.challengeExpiresAt < now) throw ApiError.conflict('This code has expired. Get a new one and record again.', 'CHALLENGE_EXPIRED');
  if (!recordingUrl) {
    throw ApiError.badRequest('Add your recording link', [{ location: 'body', field: 'recordingUrl', message: 'The recording link is required' }]);
  }

  const rec = normUrl(recordingUrl);
  const shots = [...new Set(screenshotUrls.map(normUrl))];
  const checks = await runChallengeChecks({
    creatorId: profile._id, tool: doc.subject, code: doc.challengeCode, issuedAt: doc.challengeIssuedAt, recordingUrl: rec, screenshotUrls: shots, now,
  });
  // Atomic: the code is consumed by exactly one submission, and only while it is still valid.
  const updated = await VerificationSubmission.findOneAndUpdate(
    { _id: doc._id, creatorId: profile._id, challengeCode: doc.challengeCode, challengeUsedAt: { $exists: false }, challengeExpiresAt: { $gt: new Date() }, status: { $ne: 'PENDING' } },
    {
      $set: {
        status: 'PENDING', submittedAt: new Date(), challengeUsedAt: new Date(), recordingUrl: rec, screenshotUrls: shots,
        evidenceUrls: [rec, ...shots], checks, flagged: isFlagged(checks), reviewNote: '',
      },
      $unset: { reviewerId: 1, reviewedAt: 1, expiresAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw ApiError.conflict('This code was already used or has expired. Get a new one.', 'CODE_USED');
  await recomputeCreatorTrust(profile._id);
  return ownView(updated);
}

async function createCertificate(profile, { subject, description, certificate, submit: submitNow }) {
  subject = canonicalTool(subject);
  const key = `certificate:${slug(subject)}:${slug(certificate.issuer)}`;
  if (await VerificationSubmission.exists({ creatorId: profile._id, key })) {
    throw ApiError.conflict('You already have this certificate. Edit it instead.', 'ALREADY_EXISTS');
  }
  let doc;
  try {
    doc = await VerificationSubmission.create({
      creatorId: profile._id, type: 'certificate', key, subject, description: description ?? '', method: 'certificate', certificate,
      evidenceUrls: [certificate.verifyUrl], status: 'SELF_REPORTED',
    });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('You already have this certificate. Edit it instead.', 'ALREADY_EXISTS');
    throw err;
  }
  return submitNow ? submitCertificate(profile, doc, {}) : ownView(doc);
}

async function submitCertificate(profile, doc, { certificate }) {
  if (doc.status === 'PENDING') throw ApiError.conflict('This certificate is already in review.', 'ALREADY_PENDING');
  if (doc.status === 'VERIFIED' && !canReverify(doc, new Date())) throw ApiError.conflict('Verified entries are locked.', 'LOCKED');
  const merged = { ...(doc.certificate?.toObject?.() ?? {}), ...(certificate ?? {}) };
  if (!merged.verifyUrl || !merged.issuer) {
    throw ApiError.badRequest('Add the issuer and the verify link', [{ location: 'body', field: 'certificate', message: 'Issuer and verify link are required' }]);
  }
  const clean = { ...merged, verifyUrl: normUrl(merged.verifyUrl), ...(merged.fileUrl ? { fileUrl: normUrl(merged.fileUrl) } : {}) };
  const checks = await runCertificateChecks({ creatorId: profile._id, certificate: clean });
  const updated = await VerificationSubmission.findOneAndUpdate(
    { _id: doc._id, creatorId: profile._id, status: { $ne: 'PENDING' } },
    {
      $set: { status: 'PENDING', submittedAt: new Date(), certificate: clean, evidenceUrls: [clean.verifyUrl, clean.fileUrl].filter(Boolean), checks, flagged: isFlagged(checks), reviewNote: '' },
      $unset: { reviewerId: 1, reviewedAt: 1, expiresAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw ApiError.conflict('This certificate is already in review.', 'ALREADY_PENDING');
  await recomputeCreatorTrust(profile._id);
  return ownView(updated);
}

/* ------------------------------------------------------------------ */
/* Reviewer                                                            */
/* ------------------------------------------------------------------ */

async function hydrateForReview(docs) {
  const [creators, items] = await Promise.all([
    mapBy(CreatorProfile, docs.map((d) => d.creatorId)),
    mapBy(PortfolioItem, docs.map((d) => d.portfolioItemId)),
  ]);
  return docs.map((d) => ({
    ...d,
    creator: creatorSummary(creators.get(String(d.creatorId))),
    portfolioItem: d.portfolioItemId ? items.get(String(d.portfolioItemId)) ?? null : null,
  }));
}

export async function listForReview(q) {
  const filter = { status: q.status ?? 'PENDING' };
  if (q.type) filter.type = q.type;
  // Queue tabs (R1): Tools = every non-certificate claim, Certificates, Flagged = duplicate matches.
  if (q.tab === 'tools' && !q.type) filter.type = { $ne: 'certificate' };
  if (q.tab === 'certificates') filter.type = 'certificate';
  if (q.tab === 'flagged') filter.flagged = true;
  const pg = paginate(q);
  const sort = filter.status === 'PENDING' ? { submittedAt: 1 } : { reviewedAt: -1 };
  const [docs, total] = await Promise.all([
    VerificationSubmission.find(filter).sort(sort).skip(pg.skip).limit(pg.limit).lean(),
    VerificationSubmission.countDocuments(filter),
  ]);
  const counts = await VerificationSubmission.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const [tools, certificates, flagged] = await Promise.all([
    VerificationSubmission.countDocuments({ status: 'PENDING', type: { $ne: 'certificate' } }),
    VerificationSubmission.countDocuments({ status: 'PENDING', type: 'certificate' }),
    VerificationSubmission.countDocuments({ status: 'PENDING', flagged: true }),
  ]);
  return {
    ...pageResult(await hydrateForReview(docs), total, pg),
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    tabs: { tools, certificates, flagged },
  };
}

export async function decide(reviewer, id, { decision, note }) {
  const now = new Date();
  const current = await VerificationSubmission.findById(id, 'type status').lean();
  if (!current) throw ApiError.notFound('Submission not found');
  // ASK_MORE sends the claim back to the creator (self-reported, with the reviewer's note) instead of deciding it.
  const set = { status: decision === 'ASK_MORE' ? 'SELF_REPORTED' : decision, reviewNote: note ?? '', reviewerId: reviewer._id, reviewedAt: now };
  const update = { $set: set };
  if (decision === 'VERIFIED' && ['tool', 'certificate'].includes(current.type)) set.expiresAt = addMonths(now, 12);
  if (decision === 'ASK_MORE') {
    set.flagged = false;
    update.$unset = { submittedAt: 1 };
  }
  // Conditional update: only PENDING submissions can be decided, and only once.
  const doc = await VerificationSubmission.findOneAndUpdate({ _id: id, status: 'PENDING' }, update, { returnDocument: 'after' }).lean();
  if (!doc) {
    const exists = await VerificationSubmission.findById(id, 'status').lean();
    if (!exists) throw ApiError.notFound('Submission not found');
    throw ApiError.invalidTransition(exists.status, decision === 'ASK_MORE' ? 'SELF_REPORTED' : decision);
  }
  await recomputeCreatorTrust(doc.creatorId);
  const [hydrated] = await hydrateForReview([doc]);
  return hydrated;
}

/* ------------------------------------------------------------------ */
/* Public signals                                                      */
/* ------------------------------------------------------------------ */

/** What visitors may see. REJECTED is shown as SELF_REPORTED: the claim stands unverified. */
const publicStatus = (s) => (s === 'REJECTED' ? 'SELF_REPORTED' : s);

export async function publicSignals(profile) {
  const [docs, completedProjects, feedbackProjects] = await Promise.all([
    VerificationSubmission.find({ creatorId: profile._id }, 'type subject portfolioItemId description status reviewedAt expiresAt method challengeCode certificate.issuer').lean(),
    Project.countDocuments({ creatorId: profile._id, status: 'completed' }),
    Project.find({ creatorId: profile._id, status: 'completed', 'feedback.rating': { $exists: true } }, 'feedback brandId campaignId')
      .sort({ 'feedback.createdAt': -1 })
      .limit(10)
      .lean(),
  ]);

  // Per tool: Verified (reviewed recording, not expired) > Certified (reviewed certificate) > Pending > Self-reported.
  // An expired approval reads as self-reported to everyone but its owner.
  const now = new Date();
  const live = (d) => d.status === 'VERIFIED' && !isExpired(d, now);
  const toolDocs = docs.filter((d) => d.type === 'tool' || d.type === 'certificate');
  const toolNames = [...new Set([...(profile.tools ?? []), ...toolDocs.map((d) => d.subject)])];
  const tools = toolNames.map((name) => {
    const mine = toolDocs.filter((d) => slug(d.subject) === slug(name));
    const verified = mine.find((d) => d.type === 'tool' && live(d));
    const certified = mine.find((d) => d.type === 'certificate' && live(d));
    if (verified) {
      return {
        name, status: 'VERIFIED', reviewedAt: verified.reviewedAt, expiresAt: verified.expiresAt,
        method: verified.method ?? 'evidence', ...(verified.method === 'challenge' ? { code: verified.challengeCode } : {}),
      };
    }
    if (certified) return { name, status: 'CERTIFIED', reviewedAt: certified.reviewedAt, expiresAt: certified.expiresAt, issuer: certified.certificate?.issuer };
    return { name, status: mine.some((d) => d.status === 'PENDING') ? 'PENDING' : 'SELF_REPORTED' };
  });

  const workflows = docs
    .filter((d) => d.type === 'workflow' && ['VERIFIED', 'PENDING'].includes(d.status))
    .map((d) => ({ subject: d.subject, description: d.description, status: d.status }));

  const portfolio = Object.fromEntries(
    docs.filter((d) => d.type === 'portfolio').map((d) => [String(d.portfolioItemId), publicStatus(d.status)]),
  );

  const [brands, campaigns] = await Promise.all([
    mapBy(BrandProfile, feedbackProjects.map((p) => p.brandId), { key: 'userId', projection: 'companyName userId' }),
    mapBy(Campaign, feedbackProjects.map((p) => p.campaignId), { projection: 'title' }),
  ]);
  const feedback = feedbackProjects.map((p) => ({
    rating: p.feedback.rating,
    comment: p.feedback.comment,
    createdAt: p.feedback.createdAt,
    brandName: brands.get(String(p.brandId))?.companyName ?? 'Brand',
    campaignTitle: campaigns.get(String(p.campaignId))?.title ?? '',
  }));

  return {
    tools,
    workflows,
    portfolio,
    verifiedCount: docs.filter(live).length,
    completedProjects,
    feedback,
  };
}

/** Verified-signal and completed-project counts for many creators (directory cards). */
export async function signalCounts(creatorIds) {
  const [verified, completed] = await Promise.all([
    VerificationSubmission.aggregate([
      { $match: { creatorId: { $in: creatorIds }, status: 'VERIFIED', $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }] } },
      { $group: { _id: '$creatorId', n: { $sum: 1 } } },
    ]),
    Project.aggregate([
      { $match: { creatorId: { $in: creatorIds }, status: 'completed' } },
      { $group: { _id: '$creatorId', n: { $sum: 1 } } },
    ]),
  ]);
  const v = new Map(verified.map((r) => [String(r._id), r.n]));
  const c = new Map(completed.map((r) => [String(r._id), r.n]));
  return (id) => ({ verifiedCount: v.get(String(id)) ?? 0, completedProjects: c.get(String(id)) ?? 0 });
}
