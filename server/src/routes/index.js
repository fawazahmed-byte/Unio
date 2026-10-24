import { Router } from 'express';
import { z } from 'zod';
import * as agency from '../controllers/agency.controller.js';
import * as authCtrl from '../controllers/auth.controller.js';
import * as brand from '../controllers/brand.controller.js';
import * as brandVerify from '../controllers/brandVerification.controller.js';
import * as creator from '../controllers/creator.controller.js';
import * as project from '../controllers/project.controller.js';
import * as pub from '../controllers/public.controller.js';
import * as upload from '../controllers/upload.controller.js';
import * as verify from '../controllers/verification.controller.js';
import { dbState } from '../config/db.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { approvalLimiter, authLimiter, briefDraftLimiter, messageLimiter, uploadLimiter, verifySubmitLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
  APPLICATION_STATUS,
  INVITATION_STATUS,
  PROJECT_STATUS,
} from '../models/enums.js';
import { TAXONOMY } from '../models/taxonomy.js';
import { idParams, objectId } from '../validators/common.js';
import * as v from '../validators/index.js';
import { ok } from '../utils/http.js';

const router = Router();

router.get('/health', (_req, res) => ok(res, { status: 'ok', db: dbState(), time: new Date().toISOString() }));

/* ---------- Controlled lists (static; cached by browsers for an hour) ---------- */
router.get('/taxonomy', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  ok(res, TAXONOMY);
});

/* ---------- Uploads (Azure Blob; the file itself never touches this server) ---------- */
router.get('/uploads/config', upload.config);
router.post('/uploads/sas', requireAuth, uploadLimiter, validate({ body: v.uploadSasBody }), upload.sas);

/* ---------- Auth ---------- */
router.post('/auth/register', authLimiter, validate({ body: v.registerBody }), authCtrl.register);
router.post('/auth/login', authLimiter, validate({ body: v.loginBody }), authCtrl.login);
router.post('/auth/logout', authCtrl.logout);
router.get('/auth/me', requireAuth, authCtrl.me);

/* ---------- Public discovery ---------- */
router.get('/creators', validate({ query: v.creatorListQuery }), pub.listCreators);
router.get('/creators/:id', optionalAuth, validate({ params: idParams }), pub.getCreator);
router.get('/portfolio/:id', validate({ params: idParams }), pub.getPortfolioPiece);
router.get('/campaigns', optionalAuth, validate({ query: v.campaignListQuery }), pub.listCampaigns);
router.get('/campaigns/categories', pub.listCategories);
router.get('/campaigns/:id', optionalAuth, validate({ params: idParams }), pub.getCampaign);
router.post(
  '/campaigns/:id/applications',
  requireAuth,
  requireRole('creator'),
  validate({ params: idParams, body: v.applicationBody }),
  pub.apply,
);

/* ---------- Creator ---------- */
const asCreator = [requireAuth, requireRole('creator')];
router.get('/creator/profile', asCreator, creator.getProfile);
router.put('/creator/profile', asCreator, validate({ body: v.creatorProfileBody }), creator.updateProfile);
router.get('/creator/portfolio', asCreator, creator.listPortfolio);
router.post('/creator/portfolio', asCreator, validate({ body: v.portfolioBody }), creator.addPortfolio);
router.put('/creator/portfolio/:id', asCreator, validate({ params: idParams, body: v.portfolioBody }), creator.updatePortfolio);
router.delete('/creator/portfolio/:id', asCreator, validate({ params: idParams }), creator.deletePortfolio);
router.get('/creator/applications', asCreator, validate({ query: v.statusListQuery(APPLICATION_STATUS) }), creator.listApplications);
router.patch('/creator/applications/:id/withdraw', asCreator, validate({ params: idParams }), creator.withdrawApplication);
router.get('/creator/invitations', asCreator, validate({ query: v.statusListQuery(INVITATION_STATUS) }), creator.listInvitations);
router.patch(
  '/creator/invitations/:id/respond',
  asCreator,
  validate({ params: idParams, body: v.invitationRespondBody }),
  creator.respondInvitation,
);
router.get('/creator/projects', asCreator, validate({ query: v.statusListQuery(PROJECT_STATUS) }), creator.listProjects);

/* ---------- Brand ---------- */
const asBrand = [requireAuth, requireRole('brand')];
router.get('/brand/profile', asBrand, brand.getProfile);
router.put('/brand/profile', asBrand, validate({ body: v.brandProfileBody }), brand.updateProfile);
router.get('/brand/campaigns', asBrand, validate({ query: v.brandListQuery }), brand.listCampaigns);
router.post('/brand/briefs/draft', asBrand, briefDraftLimiter, validate({ body: v.briefDraftBody }), brand.draftBrief);
router.post('/brand/campaigns', asBrand, validate({ body: v.campaignBody }), brand.createCampaign);
router.get('/brand/campaigns/:id', asBrand, validate({ params: idParams }), brand.getCampaign);
router.put('/brand/campaigns/:id', asBrand, validate({ params: idParams, body: v.campaignBody }), brand.updateCampaign);
router.patch(
  '/brand/campaigns/:id/status',
  asBrand,
  validate({ params: idParams, body: v.campaignStatusBody }),
  brand.setCampaignStatus,
);
router.get(
  '/brand/campaigns/:id/applications',
  asBrand,
  validate({ params: idParams, query: v.statusListQuery(APPLICATION_STATUS) }),
  brand.listCampaignApplications,
);
router.get('/brand/campaigns/:id/recommendations', asBrand, validate({ params: idParams }), brand.recommendations);
router.post(
  '/brand/campaigns/:campaignId/invitations',
  asBrand,
  validate({ params: z.object({ campaignId: objectId }), body: v.invitationBody }),
  brand.invite,
);
router.get('/brand/applications', asBrand, validate({ query: v.brandScopedListQuery(APPLICATION_STATUS) }), brand.listApplications);
router.patch(
  '/brand/applications/:id/status',
  asBrand,
  validate({ params: idParams, body: v.applicationReviewBody }),
  brand.reviewApplication,
);
router.get('/brand/invitations', asBrand, validate({ query: v.statusListQuery(INVITATION_STATUS) }), brand.listInvitations);
router.patch('/brand/invitations/:id/cancel', asBrand, validate({ params: idParams }), brand.cancelInvitation);
router.get('/brand/projects', asBrand, validate({ query: v.brandScopedListQuery(PROJECT_STATUS) }), brand.listProjects);

/* ---------- Agency: clients and approval links (agencies are brand accounts; the services check) ---------- */
router.get('/brand/clients', asBrand, agency.listClients);
router.post('/brand/clients', asBrand, validate({ body: v.clientBody }), agency.createClient);
router.put('/brand/clients/:clientId', asBrand, validate({ params: v.clientParams, body: v.clientBody }), agency.updateClient);
router.delete('/brand/clients/:clientId', asBrand, validate({ params: v.clientParams }), agency.archiveClient);
router.get('/brand/approvals', asBrand, validate({ query: v.approvalsQuery }), agency.listApprovals);
router.post(
  '/projects/:id/approval-links',
  requireAuth,
  requireRole('brand'),
  validate({ params: idParams, body: v.approvalLinkBody }),
  agency.createApprovalLink,
);
// No login: the long random token is the credential (rate-limited, never cached, never leaked as a referrer).
const privateResponse = (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
};
router.get('/approve/:token', approvalLimiter, privateResponse, validate({ params: v.approvalTokenParams }), agency.getApproval);
router.post('/approve/:token', approvalLimiter, privateResponse, validate({ params: v.approvalTokenParams, body: v.approvalDecisionBody }), agency.decideApproval);

/* ---------- Verification ---------- */
router.get('/creator/verifications', asCreator, verify.listOwn);
router.post('/creator/verifications', asCreator, validate({ body: v.verificationCreateBody }), verify.create);
router.post('/creator/verifications/challenge', asCreator, verifySubmitLimiter, validate({ body: v.challengeBody }), verify.challenge);
router.post(
  '/creator/verifications/:id/submit',
  asCreator,
  verifySubmitLimiter,
  validate({ params: idParams, body: v.verificationSubmitBody }),
  verify.submit,
);
router.put('/creator/verifications/:id', asCreator, validate({ params: idParams, body: v.verificationUpdateBody }), verify.update);
router.delete('/creator/verifications/:id', asCreator, validate({ params: idParams }), verify.remove);

/* ---------- Brand verification (domain + business levels; agencies verify themselves the same way) ---------- */
router.get('/brand/verification', asBrand, brandVerify.getOwn);
router.post('/brand/verification/domain/check', asBrand, validate({ body: v.brandDomainBody }), brandVerify.checkDomain);
router.post('/brand/verification/domain/code', asBrand, verifySubmitLimiter, validate({ body: v.brandDomainBody }), brandVerify.issueDomainCode);
router.post('/brand/verification/domain/submit', asBrand, verifySubmitLimiter, validate({ body: v.brandDomainSubmitBody }), brandVerify.submitDomain);
router.post('/brand/verification/business', asBrand, verifySubmitLimiter, validate({ body: v.brandBusinessBody }), brandVerify.submitBusiness);

const asReviewer = [requireAuth, requireRole('reviewer')];
router.get('/review/brand-verifications', asReviewer, validate({ query: v.brandReviewListQuery }), brandVerify.listForReview);
router.patch('/review/brand-verifications/:id', asReviewer, validate({ params: idParams, body: v.reviewDecisionBody }), brandVerify.decide);
router.get('/review/verifications', asReviewer, validate({ query: v.reviewListQuery }), verify.listForReview);
router.patch('/review/verifications/:id', asReviewer, validate({ params: idParams, body: v.reviewDecisionBody }), verify.decide);

/* ---------- Projects (participants only) ---------- */
router.get('/projects/:id', requireAuth, validate({ params: idParams }), project.getProject);
router.patch('/projects/:id/status', requireAuth, validate({ params: idParams, body: v.projectStatusBody }), project.updateStatus);
router.patch(
  '/projects/:id/deliverables/:deliverableId',
  requireAuth,
  validate({ params: v.deliverableParams, body: v.deliverableBody }),
  project.updateDeliverable,
);
router.post(
  '/projects/:id/deliverables/:deliverableId/versions',
  requireAuth,
  validate({ params: v.deliverableParams, body: v.versionBody }),
  project.submitVersion,
);
router.post(
  '/projects/:id/deliverables/:deliverableId/versions/:n/decision',
  requireAuth,
  validate({ params: v.versionParams, body: v.decisionBody }),
  project.decideVersion,
);
router.get('/projects/:id/messages', requireAuth, validate({ params: idParams, query: v.messagesQuery }), project.listMessages);
router.post('/projects/:id/messages', requireAuth, messageLimiter, validate({ params: idParams, body: v.messageBody }), project.postMessage);
router.post('/projects/:id/read', requireAuth, validate({ params: idParams }), project.markRead);
router.get('/projects/:id/rights-card', requireAuth, validate({ params: idParams }), project.rightsCard);
router.get('/me/unread', requireAuth, project.unread);
router.post('/projects/:id/feedback', requireAuth, requireRole('brand'), validate({ params: idParams, body: v.feedbackBody }), project.addFeedback);

export default router;
