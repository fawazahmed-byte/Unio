import { BrandProfile, Campaign, CreatorProfile, Invitation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { mapBy, withTransaction } from '../utils/db.js';
import { pageResult, paginate } from '../utils/http.js';
import { assertBrandCanHire } from './brandVerification.service.js';
import { requireOwnCampaign } from './campaigns.service.js';
import { requireCreatorProfile } from './profile.service.js';
import { createProjectFromSource } from './projects.service.js';
import { campaignSummary, creatorSummary, publicBrand } from './serializers.js';

export async function inviteCreator(user, campaignId, { creatorId, message }) {
  const campaign = await requireOwnCampaign(user, campaignId);
  await assertBrandCanHire(user._id);
  if (campaign.status !== 'open') {
    throw ApiError.conflict('Open this campaign before inviting creators', 'CAMPAIGN_NOT_OPEN');
  }
  const creator = await CreatorProfile.findById(creatorId).lean();
  if (!creator) throw ApiError.notFound('Creator not found');

  const existing = await Invitation.findOne({ campaignId: campaign._id, creatorId: creator._id });
  if (existing) {
    if (['pending', 'accepted'].includes(existing.status)) {
      throw ApiError.conflict(
        existing.status === 'pending'
          ? 'This creator already has a pending invitation to this campaign'
          : 'This creator has already accepted an invitation to this campaign',
        'ALREADY_INVITED',
      );
    }
    // A declined or cancelled invitation can be re-sent; the unique index keeps one record per pair.
    existing.set({ status: 'pending', message: message ?? '', brandId: user._id });
    await existing.save();
    return existing.toObject();
  }

  try {
    const invitation = await Invitation.create({
      campaignId: campaign._id,
      brandId: user._id,
      creatorId: creator._id,
      message: message ?? '',
      status: 'pending',
    });
    return invitation.toObject();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('This creator was just invited to this campaign', 'ALREADY_INVITED');
    throw err;
  }
}

export async function listBrandInvitations(user, q) {
  const filter = { brandId: user._id };
  if (q.status) filter.status = q.status;
  if (q.creatorId) filter.creatorId = q.creatorId;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Invitation.find(filter).sort({ updatedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Invitation.countDocuments(filter),
  ]);
  const [campaigns, creators] = await Promise.all([
    mapBy(Campaign, docs.map((d) => d.campaignId)),
    mapBy(CreatorProfile, docs.map((d) => d.creatorId)),
  ]);
  const items = docs.map((d) => ({
    ...d,
    campaign: campaignSummary(campaigns.get(String(d.campaignId))),
    creator: creatorSummary(creators.get(String(d.creatorId))),
  }));
  return pageResult(items, total, pg);
}

export async function cancelInvitation(user, id) {
  const invitation = await Invitation.findOne({ _id: id, brandId: user._id });
  if (!invitation) throw ApiError.notFound('Invitation not found');
  if (invitation.status !== 'pending') throw ApiError.invalidTransition(invitation.status, 'cancelled');
  invitation.status = 'cancelled';
  await invitation.save();
  return invitation.toObject();
}

export async function listCreatorInvitations(user, q) {
  const profile = await requireCreatorProfile(user);
  const filter = { creatorId: profile._id };
  if (q.status) filter.status = q.status;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Invitation.find(filter).sort({ updatedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Invitation.countDocuments(filter),
  ]);
  const [campaigns, brands] = await Promise.all([
    mapBy(Campaign, docs.map((d) => d.campaignId)),
    mapBy(BrandProfile, docs.map((d) => d.brandId), { key: 'userId' }),
  ]);
  const items = docs.map((d) => {
    const c = campaigns.get(String(d.campaignId));
    return { ...d, campaign: c && { ...campaignSummary(c), brief: c.brief }, brand: publicBrand(brands.get(String(d.brandId))) };
  });
  return pageResult(items, total, pg);
}

export async function respondToInvitation(user, id, status) {
  const profile = await requireCreatorProfile(user);
  const existing = await Invitation.findOne({ _id: id, creatorId: profile._id }).lean();
  if (!existing) throw ApiError.notFound('Invitation not found');
  if (existing.status !== 'pending') throw ApiError.invalidTransition(existing.status, status);

  const campaign = await Campaign.findById(existing.campaignId).lean();
  if (status === 'accepted' && campaign?.status !== 'open') {
    throw ApiError.conflict('This campaign has closed, so the invitation can no longer be accepted', 'CAMPAIGN_CLOSED');
  }

  return withTransaction(async (session) => {
    const invitation = await Invitation.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status } },
      { returnDocument: 'after', session },
    ).lean();
    if (!invitation) throw ApiError.conflict('This invitation was already answered', 'INVALID_TRANSITION');

    let project = null;
    if (status === 'accepted') {
      project = await createProjectFromSource(
        { campaign, creatorId: profile._id, sourceType: 'invitation', sourceId: invitation._id },
        session,
      );
    }
    return { invitation, project };
  });
}
