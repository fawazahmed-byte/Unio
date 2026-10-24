import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { campaignPayload, resetDb, setBrandLevel, signInReviewer, signUp, startDb, stopDb } from './helpers.js';
import { BrandProfile, BrandVerification } from '../src/models/index.js';
import { domainOfEmail, domainOfUrl, isSocialUrlFor, isValidBusinessId, matchEmailToWebsite } from '../src/services/brandDomain.js';
import { grantLevel } from '../src/services/brandVerification.service.js';
import { __setNetworkForTests } from '../src/services/precheck.service.js';

let app;
before(async () => {
  app = await startDb();
});
after(stopDb);
beforeEach(resetDb);
afterEach(() => __setNetworkForTests(null));

const HOUR = 60 * 60 * 1000;
const SITE = 'https://www.acme.com';
const WORK = 'priya@acme.com';
const GSTIN = '22AAAAA0000A1Z5';
const PROPOSAL = { proposal: 'I can produce two polished vertical ads using AI-assisted product visuals.', proposedPrice: 8000, acceptedRights: true };

/** A brand that signed up with a normal (Gmail) address and has not verified anything. */
const newBrand = (overrides = {}) => signUp(app, 'brand', { email: `brand${Math.random().toString(36).slice(2, 8)}@gmail.com`, ...overrides }, { verified: false });

const getCode = (agent, body = { websiteUrl: SITE, workEmail: WORK }) => agent.post('/api/brand/verification/domain/code').send(body);
const submitDns = (agent) => agent.post('/api/brand/verification/domain/submit').send({ kind: 'dns' });
const txt = (code) => ({ resolveTxt: async () => [['v=spf1 -all'], [`unio-verify=${code}`]] });

/** Walks a brand through domain submission and a reviewer's approval. */
async function domainVerified(brand, reviewer) {
  __setNetworkForTests({ fetch: async () => ({}) });
  const code = (await getCode(brand.agent)).body.data;
  const sub = await submitDns(brand.agent);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const res = await reviewer.agent.patch(`/api/review/brand-verifications/${sub.body.data._id}`).send({ decision: 'VERIFIED' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { code, id: sub.body.data._id };
}

describe('domain matching rules', () => {
  test('same domain, www, and subdomains in either direction match', () => {
    assert.equal(matchEmailToWebsite('a@acme.com', 'https://acme.com').match, true);
    assert.equal(matchEmailToWebsite('a@acme.com', 'https://www.acme.com/about').match, true);
    assert.equal(matchEmailToWebsite('a@mail.acme.com', 'https://acme.com').match, true);
    assert.equal(matchEmailToWebsite('a@acme.com', 'https://shop.acme.com').match, true);
    assert.equal(matchEmailToWebsite('A@ACME.COM', 'https://Acme.com').match, true);
  });

  test('lookalikes and other domains never match', () => {
    assert.equal(matchEmailToWebsite('a@evilacme.com', 'https://acme.com').match, false);
    assert.equal(matchEmailToWebsite('a@acme.com.evil.io', 'https://acme.com').match, false);
    assert.equal(matchEmailToWebsite('a@other.com', 'https://acme.com').match, false);
  });

  test('free mailbox providers never match, even when the website is on one', () => {
    for (const d of ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me']) {
      const r = matchEmailToWebsite(`a@${d}`, `https://${d}`);
      assert.equal(r.match, false, d);
      assert.match(r.reason, /free mailbox/);
    }
  });

  test('a missing website or a bad email explains what to fix', () => {
    assert.match(matchEmailToWebsite('a@acme.com', '').reason, /website/i);
    assert.match(matchEmailToWebsite('not-an-email', 'https://acme.com').reason, /valid work email/i);
    assert.equal(domainOfUrl('not a url'), '');
    assert.equal(domainOfEmail('x'), '');
  });

  test('ID formats: GSTIN, CIN and Udyam', () => {
    assert.equal(isValidBusinessId('GSTIN', GSTIN), true);
    assert.equal(isValidBusinessId('GSTIN', '22AAAAA0000A1Z'), false);
    assert.equal(isValidBusinessId('CIN', 'U12345MH2020PTC123456'), true);
    assert.equal(isValidBusinessId('CIN', 'U12345MH2020PTC12345'), false);
    assert.equal(isValidBusinessId('UDYAM', 'udyam-mh-12-1234567'), true);
    assert.equal(isValidBusinessId('UDYAM', 'UDYAM-MH-12-123'), false);
  });

  test('social proof must be on the matching site', () => {
    assert.equal(isSocialUrlFor('instagram', 'https://www.instagram.com/acme'), true);
    assert.equal(isSocialUrlFor('instagram', 'https://evilinstagram.com/acme'), false);
    assert.equal(isSocialUrlFor('youtube', 'https://youtu.be/abc'), true);
    assert.equal(isSocialUrlFor('linkedin', 'https://instagram.com/acme'), false);
  });
});

describe('domain verification (brand side)', () => {
  test('anyone can sign up with a normal email; the Verification page starts at signed_up', async () => {
    const brand = await newBrand();
    const res = await brand.agent.get('/api/brand/verification');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.level, 'signed_up');
    assert.equal(res.body.data.domain, null);
    assert.equal(res.body.data.business, null);
    assert.equal(res.body.data.codeHours, 48);
  });

  test('instant check explains a mismatch without saving anything', async () => {
    const brand = await newBrand();
    const bad = await brand.agent.post('/api/brand/verification/domain/check').send({ websiteUrl: SITE, workEmail: 'priya@gmail.com' });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.data.match, false);
    assert.match(bad.body.data.reason, /free mailbox/);
    const good = await brand.agent.post('/api/brand/verification/domain/check').send({ websiteUrl: SITE, workEmail: WORK });
    assert.equal(good.body.data.match, true);
    assert.equal(await BrandVerification.countDocuments(), 0);
  });

  test('a work email that does not match the website gets 422 DOMAIN_MISMATCH and no code', async () => {
    const brand = await newBrand();
    const res = await getCode(brand.agent, { websiteUrl: SITE, workEmail: 'priya@gmail.com' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'DOMAIN_MISMATCH');
    assert.equal(await BrandVerification.countDocuments(), 0);
  });

  test('issues UNIO-B + 4 characters valid for 48 h, saves the website, and a new code replaces the old one', async () => {
    const brand = await newBrand();
    const res = await getCode(brand.agent);
    assert.equal(res.status, 201);
    const c = res.body.data;
    assert.match(c.challengeCode, /^UNIO-B[A-HJ-NP-Z2-9]{4}$/);
    const hours = (new Date(c.challengeExpiresAt) - new Date(c.challengeIssuedAt)) / HOUR;
    assert.equal(Math.round(hours), 48);
    assert.equal(c.workEmail, WORK);
    assert.equal((await BrandProfile.findOne({ userId: brand.user._id })).websiteUrl, 'https://www.acme.com');

    const again = await getCode(brand.agent);
    assert.equal(again.status, 201);
    assert.equal(await BrandVerification.countDocuments({ brandId: brand.user._id, level: 'domain' }), 1, 'one active code per brand');
    assert.notEqual(again.body.data.challengeCode, undefined);
  });

  test('an expired code is 409 CHALLENGE_EXPIRED and is no longer shown', async () => {
    const brand = await newBrand();
    await getCode(brand.agent);
    await BrandVerification.updateOne({ brandId: brand.user._id }, { $set: { challengeExpiresAt: new Date(Date.now() - HOUR) } });
    const res = await submitDns(brand.agent);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CHALLENGE_EXPIRED');
    const own = (await brand.agent.get('/api/brand/verification')).body.data.domain;
    assert.equal(own.codeExpired, true);
    assert.equal(own.challengeCode, undefined);
  });

  test('submitting without a code is 409 NO_ACTIVE_CHALLENGE', async () => {
    const brand = await newBrand();
    const res = await submitDns(brand.agent);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NO_ACTIVE_CHALLENGE');
  });

  test('DNS: the code is looked up in the domain\'s TXT records as a hint; the code works once', async () => {
    const brand = await newBrand();
    const code = (await getCode(brand.agent)).body.data.challengeCode;
    __setNetworkForTests({ fetch: async () => ({}), ...txt(code) });
    const res = await submitDns(brand.agent);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.status, 'PENDING');
    assert.equal(d.proof.kind, 'dns');
    assert.equal(d.proof.domain, 'acme.com');
    assert.equal(d.checks.find((c) => c.id === 'dns_txt').result, 'pass');
    assert.equal(d.checks.find((c) => c.id === 'email_match').result, 'pass');
    assert.equal(d.reviewerId, undefined, 'brands never see the reviewer id');

    assert.equal((await submitDns(brand.agent)).body.error.code, 'ALREADY_PENDING');
    assert.equal((await getCode(brand.agent)).body.error.code, 'ALREADY_PENDING');
  });

  test('DNS: a missing record is a failed hint, not a block (the reviewer decides); a lookup problem is unknown', async () => {
    const brand = await newBrand();
    await getCode(brand.agent);
    __setNetworkForTests({ fetch: async () => ({}), resolveTxt: async () => [['v=spf1 -all']] });
    const missing = await submitDns(brand.agent);
    assert.equal(missing.status, 200);
    assert.equal(missing.body.data.checks.find((c) => c.id === 'dns_txt').result, 'fail');

    const other = await newBrand();
    await getCode(other.agent, { websiteUrl: 'https://beta.io', workEmail: 'a@beta.io' });
    __setNetworkForTests({ fetch: async () => ({}), resolveTxt: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); } });
    const unknown = await submitDns(other.agent);
    assert.equal(unknown.body.data.checks.find((c) => c.id === 'dns_txt').result, 'unknown');
  });

  test('social proof needs a link on the right site', async () => {
    const brand = await newBrand();
    await getCode(brand.agent);
    const none = await brand.agent.post('/api/brand/verification/domain/submit').send({ kind: 'instagram' });
    assert.equal(none.status, 400);
    const wrong = await brand.agent.post('/api/brand/verification/domain/submit').send({ kind: 'instagram', proofUrl: 'https://evil.example.com/acme' });
    assert.equal(wrong.status, 400);
    const good = await brand.agent.post('/api/brand/verification/domain/submit').send({ kind: 'instagram', proofUrl: 'https://www.instagram.com/acme' });
    assert.equal(good.status, 200);
    assert.equal(good.body.data.status, 'PENDING');
    assert.equal(good.body.data.proof.url, 'https://www.instagram.com/acme');
  });

  test('a brand cannot set its own level, status or reviewer', async () => {
    const brand = await newBrand();
    await brand.agent.put('/api/brand/profile').send({ companyName: 'Acme', brandTrustLevel: 'business_verified' });
    assert.equal((await BrandProfile.findOne({ userId: brand.user._id })).brandTrustLevel, 'signed_up');
    const res = await brand.agent.post('/api/brand/verification/domain/code').send({ websiteUrl: SITE, workEmail: WORK, status: 'VERIFIED' });
    assert.equal(res.status, 400);
  });

  test('creators and visitors cannot use the brand verification routes', async () => {
    const creator = await signUp(app, 'creator');
    assert.equal((await creator.agent.get('/api/brand/verification')).status, 403);
    assert.equal((await creator.agent.post('/api/brand/verification/domain/code').send({ websiteUrl: SITE, workEmail: WORK })).status, 403);
  });
});

describe('business verification', () => {
  test('needs the domain first, checks the ID format, then waits for a reviewer', async () => {
    const brand = await newBrand();
    const reviewer = await signInReviewer(app);
    const early = await brand.agent.post('/api/brand/verification/business').send({ idType: 'GSTIN', idNumber: GSTIN, legalName: 'Acme Private Limited' });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'DOMAIN_VERIFICATION_REQUIRED');

    await domainVerified(brand, reviewer);
    const bad = await brand.agent.post('/api/brand/verification/business').send({ idType: 'GSTIN', idNumber: '123', legalName: 'Acme Private Limited' });
    assert.equal(bad.status, 400);
    const noName = await brand.agent.post('/api/brand/verification/business').send({ idType: 'GSTIN', idNumber: GSTIN, legalName: '' });
    assert.equal(noName.status, 400);

    const ok = await brand.agent.post('/api/brand/verification/business').send({ idType: 'GSTIN', idNumber: GSTIN.toLowerCase(), legalName: 'Acme Private Limited' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'PENDING');
    assert.equal(ok.body.data.business.idNumber, GSTIN, 'stored upper-case');
    const again = await brand.agent.post('/api/brand/verification/business').send({ idType: 'CIN', idNumber: 'U12345MH2020PTC123456', legalName: 'Acme Private Limited' });
    assert.equal(again.body.error.code, 'ALREADY_PENDING');

    const approve = await reviewer.agent.patch(`/api/review/brand-verifications/${ok.body.data._id}`).send({ decision: 'VERIFIED' });
    assert.equal(approve.status, 200);
    assert.equal((await brand.agent.get('/api/brand/verification')).body.data.level, 'business_verified');
  });
});

describe('reviewer', () => {
  test('lists brand claims with brand, website, email match, code, proof and ID; tabs count them', async () => {
    const brand = await newBrand({ companyName: 'Acme Studio' });
    const reviewer = await signInReviewer(app);
    const code = (await getCode(brand.agent)).body.data.challengeCode;
    __setNetworkForTests({ fetch: async () => ({}), ...txt(code) });
    await submitDns(brand.agent);

    const res = await reviewer.agent.get('/api/review/brand-verifications');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.total, 1);
    assert.deepEqual(res.body.data.tabs, { domain: 1, business: 0, all: 1 });
    const item = res.body.data.items[0];
    assert.equal(item.brand.companyName, 'Acme Studio');
    assert.equal(item.websiteUrl, 'https://www.acme.com');
    assert.equal(item.workEmail, WORK);
    assert.equal(item.emailMatch, true);
    assert.equal(item.challengeCode, code);
    assert.equal(item.proof.kind, 'dns');
    assert.ok(item.checks.length >= 3);

    assert.equal((await reviewer.agent.get('/api/review/brand-verifications?tab=business')).body.data.total, 0);
  });

  test('approve raises the level and records the reviewer and time; it cannot be decided twice', async () => {
    const brand = await newBrand();
    const reviewer = await signInReviewer(app);
    const { id } = await domainVerified(brand, reviewer);
    const doc = await BrandVerification.findById(id).lean();
    assert.equal(doc.status, 'VERIFIED');
    assert.equal(String(doc.reviewerId), String(reviewer.user._id));
    assert.ok(doc.reviewedAt);
    assert.equal((await brand.agent.get('/api/brand/verification')).body.data.level, 'domain_verified');
    const twice = await reviewer.agent.patch(`/api/review/brand-verifications/${id}`).send({ decision: 'REJECTED', note: 'Changed my mind about this one.' });
    assert.equal(twice.status, 409);
  });

  test('reject needs a reason; the level stays; the brand sees the reason and can start again', async () => {
    const brand = await newBrand();
    const reviewer = await signInReviewer(app);
    await getCode(brand.agent);
    __setNetworkForTests({ fetch: async () => ({}) });
    const sub = (await submitDns(brand.agent)).body.data;

    const noReason = await reviewer.agent.patch(`/api/review/brand-verifications/${sub._id}`).send({ decision: 'REJECTED' });
    assert.equal(noReason.status, 400);
    const rej = await reviewer.agent.patch(`/api/review/brand-verifications/${sub._id}`).send({ decision: 'REJECTED', note: 'The code is not on that DNS record.' });
    assert.equal(rej.status, 200);
    assert.equal(rej.body.data.status, 'REJECTED');

    const own = (await brand.agent.get('/api/brand/verification')).body.data;
    assert.equal(own.level, 'signed_up');
    assert.equal(own.domain.status, 'REJECTED');
    assert.equal(own.domain.reviewNote, 'The code is not on that DNS record.');
    assert.equal(own.domain.reviewerId, undefined);

    const retry = await getCode(brand.agent);
    assert.equal(retry.status, 201);
    assert.equal(retry.body.data.status, 'SELF_REPORTED');
  });

  test('ask for more sends the claim back with a note', async () => {
    const brand = await newBrand();
    const reviewer = await signInReviewer(app);
    await getCode(brand.agent);
    __setNetworkForTests({ fetch: async () => ({}) });
    const sub = (await submitDns(brand.agent)).body.data;
    const res = await reviewer.agent.patch(`/api/review/brand-verifications/${sub._id}`).send({ decision: 'ASK_MORE', note: 'Please use the company Instagram, not a personal one.' });
    assert.equal(res.body.data.status, 'SELF_REPORTED');
    const own = (await brand.agent.get('/api/brand/verification')).body.data.domain;
    assert.equal(own.status, 'SELF_REPORTED');
    assert.match(own.reviewNote, /company Instagram/);
  });

  test('business approval needs the domain approved first', async () => {
    const brand = await newBrand();
    const reviewer = await signInReviewer(app);
    const doc = await BrandVerification.create({
      brandId: brand.user._id, level: 'business', status: 'PENDING', submittedAt: new Date(),
      business: { idType: 'GSTIN', idNumber: GSTIN, legalName: 'Acme' },
    });
    const res = await reviewer.agent.patch(`/api/review/brand-verifications/${doc._id}`).send({ decision: 'VERIFIED' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DOMAIN_VERIFICATION_REQUIRED');
  });

  test('only reviewers can list or decide', async () => {
    const brand = await newBrand();
    const creator = await signUp(app, 'creator');
    assert.equal((await brand.agent.get('/api/review/brand-verifications')).status, 403);
    assert.equal((await creator.agent.get('/api/review/brand-verifications')).status, 403);
    assert.equal((await brand.agent.patch('/api/review/brand-verifications/64b000000000000000000000').send({ decision: 'VERIFIED' })).status, 403);
  });

  test('a brand only ever sees its own claims', async () => {
    const a = await newBrand();
    const b = await newBrand();
    await getCode(a.agent);
    const own = (await b.agent.get('/api/brand/verification')).body.data;
    assert.equal(own.domain, null);
  });
});

describe('hiring needs a verified brand', () => {
  async function setup(verified) {
    const brand = await signUp(app, 'brand', {}, { verified });
    const creator = await signUp(app, 'creator');
    const campaign = (await brand.agent.post('/api/brand/campaigns').send(campaignPayload())).body.data;
    return { brand, creator, campaign };
  }

  test('accepting an application is 403 BRAND_NOT_VERIFIED until the domain is verified; rejecting stays open', async () => {
    const { brand, creator, campaign } = await setup(false);
    const app1 = (await creator.agent.post(`/api/campaigns/${campaign._id}/applications`).send(PROPOSAL)).body.data;
    const blocked = await brand.agent.patch(`/api/brand/applications/${app1._id}/status`).send({ status: 'accepted' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'BRAND_NOT_VERIFIED');
    assert.match(blocked.body.error.message, /Verif/);

    await setBrandLevel(brand.user._id, 'domain_verified');
    const ok = await brand.agent.patch(`/api/brand/applications/${app1._id}/status`).send({ status: 'accepted' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.data.project);
  });

  test('a signed_up brand can still browse, draft and publish briefs, and reject applications', async () => {
    const { brand, creator, campaign } = await setup(false);
    assert.equal(campaign.status, 'open');
    const app1 = (await creator.agent.post(`/api/campaigns/${campaign._id}/applications`).send(PROPOSAL)).body.data;
    const rej = await brand.agent.patch(`/api/brand/applications/${app1._id}/status`).send({ status: 'rejected' });
    assert.equal(rej.status, 200);
    assert.equal((await brand.agent.get('/api/creators')).status, 200);
  });

  test('inviting a creator needs a verified brand', async () => {
    const { brand, creator, campaign } = await setup(false);
    const blocked = await brand.agent.post(`/api/brand/campaigns/${campaign._id}/invitations`).send({ creatorId: creator.profile._id });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'BRAND_NOT_VERIFIED');
    await setBrandLevel(brand.user._id, 'domain_verified');
    assert.equal((await brand.agent.post(`/api/brand/campaigns/${campaign._id}/invitations`).send({ creatorId: creator.profile._id })).status, 201);
  });

  test('safety net: if the brand is not verified when a creator accepts an invitation, no project is made', async () => {
    const { brand, creator, campaign } = await setup(true);
    const inv = (await brand.agent.post(`/api/brand/campaigns/${campaign._id}/invitations`).send({ creatorId: creator.profile._id })).body.data;
    await setBrandLevel(brand.user._id, 'signed_up');
    const res = await creator.agent.patch(`/api/creator/invitations/${inv._id}/respond`).send({ status: 'accepted' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'BRAND_NOT_VERIFIED');
    assert.match(res.body.error.message, /brand/i);
    assert.equal((await creator.agent.get('/api/creator/projects')).body.data.total, 0);
  });

  test('agencies verify themselves with the same flow and level', async () => {
    const agency = await signUp(app, 'agency', {}, { verified: false });
    const res = await agency.agent.get('/api/brand/verification');
    assert.equal(res.body.data.accountType, 'agency');
    assert.equal(res.body.data.level, 'signed_up');
    const creator = await signUp(app, 'creator');
    const client = (await agency.agent.post('/api/brand/clients').send({ name: 'Verdant Skin Co.', industry: 'beauty' })).body.data;
    const campaign = (await agency.agent.post('/api/brand/campaigns').send(campaignPayload({ clientId: client._id }))).body.data;
    const blocked = await agency.agent.post(`/api/brand/campaigns/${campaign._id}/invitations`).send({ creatorId: creator.profile._id });
    assert.equal(blocked.body.error.code, 'BRAND_NOT_VERIFIED');
  });
});

describe('badges and seed data', () => {
  test('a verified brand shows a badge on its campaign; signed_up shows nothing', async () => {
    const brand = await signUp(app, 'brand', {}, { verified: false });
    const campaign = (await brand.agent.post('/api/brand/campaigns').send(campaignPayload())).body.data;
    const detail = async () => (await brand.agent.get(`/api/campaigns/${campaign._id}`)).body.data.campaign.brand;
    assert.equal((await detail()).trustLevel, undefined);
    await setBrandLevel(brand.user._id, 'domain_verified');
    assert.equal((await detail()).trustLevel, 'domain_verified');
    await setBrandLevel(brand.user._id, 'business_verified');
    const list = (await brand.agent.get('/api/campaigns')).body.data.items.find((c) => c._id === campaign._id);
    assert.equal(list.brand.trustLevel, 'business_verified');
  });

  test('the work email and ID numbers are never in public brand data', async () => {
    const brand = await newBrand();
    await getCode(brand.agent);
    await setBrandLevel(brand.user._id, 'domain_verified');
    await brand.agent.put('/api/brand/profile').send({ companyName: 'Acme' });
    const campaign = (await brand.agent.post('/api/brand/campaigns').send(campaignPayload())).body.data;
    const pub = JSON.stringify([(await brand.agent.get(`/api/campaigns/${campaign._id}`)).body, (await request(app).get('/api/campaigns')).body]);
    assert.ok(!pub.includes(WORK));
    assert.ok(!pub.includes('UNIO-B'));
  });

  test('grantLevel records an approved note, never lowers a level and is safe to repeat', async () => {
    const brand = await newBrand();
    await grantLevel(brand.user._id, 'business_verified', { note: 'Demo seed — not a real check.' });
    await grantLevel(brand.user._id, 'domain_verified', { note: 'Grandfathered' });
    await grantLevel(brand.user._id, 'business_verified', { note: 'Demo seed — not a real check.' });
    assert.equal((await BrandProfile.findOne({ userId: brand.user._id })).brandTrustLevel, 'business_verified');
    const docs = await BrandVerification.find({ brandId: brand.user._id }).lean();
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.status === 'VERIFIED' && d.reviewNote.startsWith('Demo seed')));
  });
});
