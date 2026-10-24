import { Application, BrandProfile, Campaign, CreatorProfile, PortfolioItem } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { mapBy, withTransaction } from '../utils/db.js';
import { pageResult, paginate } from '../utils/http.js';
import { requireOwnCampaign } from './campaigns.service.js';
import { requireCreatorProfile } from './profile.service.js';
import { matchesForCampaign } from './matching.service.js';
import { assertBrandCanHire } from './brandVerification.service.js';
import { createProjectFromSource } from './projects.service.js';
import { campaignSummary, creatorSummary, publicBrand } from './serializers.js';

export async function applyToCampaign(user, campaignId, { proposal, proposedPrice, samplePieceIds = [] }) {
  const profile = await requireCreatorProfile(user);
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status === 'draft') throw ApiError.notFound('Campaign not found');
  if (campaign.status !== 'open') throw ApiError.conflict('This campaign is no longer accepting applications', 'CAMPAIGN_CLOSED');

  if (await Application.exists({ campaignId, creatorId: profile._id })) {
    throw ApiError.conflict('You have already applied to this campaign', 'ALREADY_APPLIED');
  }
  // Relevant work must be the applicant's own pieces.
  const samples = [...new Set(samplePieceIds.map(String))];
  if (samples.length && (await PortfolioItem.countDocuments({ _id: { $in: samples }, creatorId: profile._id })) !== samples.length) {
    throw ApiError.badRequest('Pick pieces from your own portfolio', [{ location: 'body', field: 'samplePieceIds', message: 'Only your own portfolio pieces can be attached' }]);
  }
  try {
    const application = await Application.create({
      campaignId,
      creatorId: profile._id,
      proposal,
      proposedPrice: proposedPrice ?? undefined,
      samplePieceIds: samples,
      rightsAcceptedAt: new Date(), // validator requires acceptedRights: true

      status: 'pending',
      submittedAt: new Date(),
    });
    return application.toObject();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('You have already applied to this campaign', 'ALREADY_APPLIED');
    throw err;
  }
}

export async function listCreatorApplications(user, q) {
  const profile = await requireCreatorProfile(user);
  const filter = { creatorId: profile._id };
  if (q.status) filter.status = q.status;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Application.find(filter).sort({ submittedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Application.countDocuments(filter),
  ]);
  const campaigns = await mapBy(Campaign, docs.map((d) => d.campaignId));
  const brands = await mapBy(BrandProfile, [...campaigns.values()].map((c) => c.brandId), { key: 'userId' });
  const items = docs.map((d) => {
    const c = campaigns.get(String(d.campaignId));
    return { ...d, campaign: campaignSummary(c), brand: publicBrand(c && brands.get(String(c.brandId))) };
  });
  return pageResult(items, total, pg);
}

export async function withdrawApplication(user, id) {
  const profile = await requireCreatorProfile(user);
  const app = await Application.findOne({ _id: id, creatorId: profile._id });
  if (!app) throw ApiError.notFound('Application not found');
  if (app.status !== 'pending') throw ApiError.invalidTransition(app.status, 'withdrawn');
  app.status = 'withdrawn';
  await app.save();
  return app.toObject();
}

async function withCreators(apps) {
  const creators = await mapBy(CreatorProfile, apps.map((a) => a.creatorId));
  return apps.map((a) => ({ ...a, creator: creatorSummary(creators.get(String(a.creatorId))) }));
}

export async function listCampaignApplications(user, campaignId, q) {
  const campaign = await requireOwnCampaign(user, campaignId);
  const filter = { campaignId: campaign._id };
  if (q.status) filter.status = q.status;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Application.find(filter).sort({ submittedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Application.countDocuments(filter),
  ]);
  // F4: every applicant carries the same explainable match the brand sees on B4.
  const profiles = await CreatorProfile.find({ _id: { $in: docs.map((d) => d.creatorId) } }).lean();
  const matches = await matchesForCampaign(campaign, profiles);
  const byCreator = new Map(profiles.map((p, i) => [String(p._id), matches[i]]));
  const sampleIds = docs.flatMap((d) => d.samplePieceIds ?? []);
  const samples = await mapBy(PortfolioItem, sampleIds, { projection: 'title mediaUrl thumbnailUrl mediaType' });
  const items = (await withCreators(docs)).map((a) => ({
    ...a,
    match: byCreator.get(String(a.creatorId)) ?? null,
    samplePieces: (a.samplePieceIds ?? []).map((id) => samples.get(String(id))).filter(Boolean),
  }));
  return { campaign, ...pageResult(items, total, pg) };
}

/** Every application across the brand's own campaigns (dashboard inbox). */
export async function listBrandApplications(user, q) {
  const campaignIds = await Campaign.find({ brandId: user._id, ...(q.clientId ? { clientId: q.clientId } : {}) }).distinct('_id');
  const filter = { campaignId: { $in: campaignIds } };
  if (q.status) filter.status = q.status;
  const pg = paginate(q);
  const [docs, total] = await Promise.all([
    Application.find(filter).sort({ submittedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Application.countDocuments(filter),
  ]);
  const campaigns = await mapBy(Campaign, docs.map((d) => d.campaignId));
  const items = (await withCreators(docs)).map((a) => ({ ...a, campaign: campaignSummary(campaigns.get(String(a.campaignId))) }));
  return pageResult(items, total, pg);
}

export async function reviewApplication(user, id, status) {
  const existing = await Application.findById(id).lean();
  if (!existing) throw ApiError.notFound('Application not found');
  // Ownership is checked through the campaign: brands only review their own campaigns.
  const campaign = await requireOwnCampaign(user, existing.campaignId).catch(() => {
    throw ApiError.notFound('Application not found');
  });
  if (existing.status !== 'pending') throw ApiError.invalidTransition(existing.status, status);
  // Hiring needs a verified brand. Rejecting an application stays open to everyone.
  if (status === 'accepted') await assertBrandCanHire(user._id);

  return withTransaction(async (session) => {
    // Conditional update guards against two reviewers acting at the same moment.
    const application = await Application.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status } },
      { returnDocument: 'after', session },
    ).lean();
    if (!application) throw ApiError.conflict('This application was already reviewed', 'INVALID_TRANSITION');

    let project = null;
    if (status === 'accepted') {
      project = await createProjectFromSource(
        { campaign, creatorId: application.creatorId, sourceType: 'application', sourceId: application._id },
        session,
      );
    }
    return { application, project };
  });
}
