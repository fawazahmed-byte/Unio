import crypto from 'node:crypto';
import { BrandProfile, BrandVerification } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { mapBy, withTransaction } from '../utils/db.js';
import { pageResult, paginate } from '../utils/http.js';
import {
  BUSINESS_ID_PATTERNS,
  isSocialUrlFor,
  isValidBusinessId,
  matchEmailToWebsite,
  normalizeBusinessId,
} from './brandDomain.js';
import { normUrl, runDnsCodeCheck } from './precheck.service.js';
import { CHALLENGE_HOURS, CODE_ALPHABET } from './verification.service.js';
import { getOwnBrandProfile } from './profile.service.js';

/**
 * Brand verification (levels): signed_up → domain_verified → business_verified.
 * The brand's level is raised only here, by a reviewer's VERIFIED decision (or by grantLevel for seed data and
 * grandfathered brands). Nothing a brand sends can set a level, a status or a reviewer.
 */

const LEVEL_ORDER = ['signed_up', 'domain_verified', 'business_verified'];
const rank = (level) => Math.max(LEVEL_ORDER.indexOf(level ?? 'signed_up'), 0);
export const levelOf = (profile) => profile?.brandTrustLevel ?? 'signed_up';
/** What visitors see: nothing for signed_up, so there is never a fake badge. */
export const publicTrustLevel = (profile) => (rank(levelOf(profile)) >= 1 ? levelOf(profile) : undefined);

const HOUR = 60 * 60 * 1000;

/** UNIO-B + 4 characters, from a CSPRNG. */
export function newBrandCode() {
  return `UNIO-B${Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('')}`;
}

/* ------------------------------------------------------------------ */
/* Hiring gate                                                         */
/* ------------------------------------------------------------------ */

/**
 * Hiring needs a domain-verified brand. `actor` only changes the wording: the brand is told to verify,
 * a creator accepting an invitation is told the brand has to.
 */
export async function assertBrandCanHire(brandId, { actor = 'brand' } = {}) {
  const profile = await BrandProfile.findOne({ userId: brandId }, 'brandTrustLevel').lean();
  if (rank(levelOf(profile)) >= 1) return;
  throw new ApiError(
    403,
    'BRAND_NOT_VERIFIED',
    actor === 'brand'
      ? 'Verify your brand to hire creators. It only takes a work email on your website domain and a short code. Open Verification in your dashboard.'
      : 'This brand has not finished verification yet, so it cannot start projects. Ask them to verify their brand.',
  );
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

const isActiveCode = (doc, now) => !!doc.challengeCode && !doc.challengeUsedAt && doc.challengeExpiresAt > now;

/** What the brand sees of its own claim: no reviewer id; the code only while it can still be used. */
function ownView(doc, now = new Date()) {
  if (!doc) return null;
  const { reviewerId: _r, ...rest } = doc.toObject ? doc.toObject() : doc;
  const codeActive = isActiveCode(rest, now);
  const codeExpired = !!rest.challengeCode && !rest.challengeUsedAt && rest.challengeExpiresAt <= now;
  return { ...rest, challengeCode: codeActive ? rest.challengeCode : undefined, codeActive, codeExpired };
}

export async function getOwn(user) {
  const profile = await getOwnBrandProfile(user);
  const docs = await BrandVerification.find({ brandId: user._id }).lean();
  const byLevel = Object.fromEntries(docs.map((d) => [d.level, ownView(d)]));
  return {
    level: levelOf(profile),
    accountType: profile.accountType ?? 'brand',
    companyName: profile.companyName,
    websiteUrl: profile.websiteUrl ?? '',
    codeHours: CHALLENGE_HOURS,
    domain: byLevel.domain ?? null,
    business: byLevel.business ?? null,
  };
}

/** Instant feedback for the form: does this work email match this website? Nothing is saved. */
export function checkDomain({ websiteUrl, workEmail }) {
  const { match, emailDomain, websiteDomain, reason } = matchEmailToWebsite(workEmail, websiteUrl);
  return { match, emailDomain, websiteDomain, reason };
}

const mismatch = (reason) => new ApiError(422, 'DOMAIN_MISMATCH', reason, [{ location: 'body', field: 'workEmail', message: reason }]);

/** Step 1 of the domain level: save the website + work email, check they match, issue a fresh 48 h code. */
export async function issueDomainCode(user, { websiteUrl, workEmail }) {
  const profile = await getOwnBrandProfile(user);
  if (rank(levelOf(profile)) >= 1) throw ApiError.conflict('Your domain is already verified.', 'ALREADY_VERIFIED');
  const existing = await BrandVerification.findOne({ brandId: user._id, level: 'domain' }, 'status').lean();
  if (existing?.status === 'PENDING') throw ApiError.conflict('Your domain is already waiting for review.', 'ALREADY_PENDING');

  const site = normUrl(websiteUrl);
  const m = matchEmailToWebsite(workEmail, site);
  if (!m.match) throw mismatch(m.reason);

  const now = new Date();
  // The website is part of the brand's profile, so it is saved there too.
  await BrandProfile.updateOne({ userId: user._id }, { $set: { websiteUrl: site } }, { runValidators: true });
  const doc = await BrandVerification.findOneAndUpdate(
    { brandId: user._id, level: 'domain', status: { $nin: ['PENDING', 'VERIFIED'] } },
    {
      $set: {
        status: 'SELF_REPORTED',
        websiteUrl: site,
        websiteDomain: m.websiteDomain,
        workEmail: workEmail.trim().toLowerCase(),
        emailMatch: true,
        challengeCode: newBrandCode(),
        challengeIssuedAt: now,
        challengeExpiresAt: new Date(now.getTime() + CHALLENGE_HOURS * HOUR),
        reviewNote: '',
        checks: [],
      },
      $unset: { challengeUsedAt: 1, proof: 1, submittedAt: 1, reviewerId: 1, reviewedAt: 1 },
      $setOnInsert: { brandId: user._id, level: 'domain' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return ownView(doc);
}

/** Step 2 of the domain level: the brand says where the code is (DNS or a social bio) and submits for review. */
export async function submitDomain(user, { kind, proofUrl }) {
  const profile = await getOwnBrandProfile(user);
  if (rank(levelOf(profile)) >= 1) throw ApiError.conflict('Your domain is already verified.', 'ALREADY_VERIFIED');
  const doc = await BrandVerification.findOne({ brandId: user._id, level: 'domain' });
  if (doc?.status === 'PENDING') throw ApiError.conflict('Your domain is already waiting for review.', 'ALREADY_PENDING');
  if (!doc || !doc.challengeCode || doc.challengeUsedAt) {
    throw ApiError.conflict('Get a code first. Each code works once.', 'NO_ACTIVE_CHALLENGE');
  }
  const now = new Date();
  if (doc.challengeExpiresAt < now) throw ApiError.conflict('This code has expired. Get a new one and place it again.', 'CHALLENGE_EXPIRED');

  // The website may have changed since the code was issued; the code was for the old one.
  const m = matchEmailToWebsite(doc.workEmail, profile.websiteUrl);
  if (!m.match || m.websiteDomain !== doc.websiteDomain) {
    throw ApiError.conflict('Your website changed after the code was issued. Get a new code.', 'WEBSITE_CHANGED');
  }

  let proof;
  if (kind === 'dns') {
    proof = { kind: 'dns', domain: doc.websiteDomain };
  } else {
    if (!proofUrl || !isSocialUrlFor(kind, proofUrl)) {
      throw ApiError.badRequest(`Add the link to your official ${kind} page`, [{ location: 'body', field: 'proofUrl', message: `Must be a ${kind}.com link` }]);
    }
    proof = { kind, url: normUrl(proofUrl) };
  }

  const minutes = Math.max(0, Math.round((now - new Date(doc.challengeIssuedAt)) / 60000));
  const checks = [
    { id: 'email_match', label: 'Work email matches the website domain', result: 'pass', detail: `${doc.workEmail.split('@')[1]} and ${doc.websiteDomain}` },
    { id: 'window', label: 'Submitted within the 48 h window', result: 'pass', detail: `${minutes} min after the code was issued` },
    kind === 'dns'
      ? await runDnsCodeCheck({ domain: doc.websiteDomain, code: doc.challengeCode })
      : { id: 'proof_host', label: `Proof link is on ${kind}.com`, result: 'pass', detail: 'The reviewer opens the page and looks for the code' },
  ];

  // Atomic: the code is consumed by exactly one submission, and only while it is still valid.
  const updated = await BrandVerification.findOneAndUpdate(
    {
      _id: doc._id, brandId: user._id, challengeCode: doc.challengeCode, challengeUsedAt: { $exists: false },
      challengeExpiresAt: { $gt: new Date() }, status: { $nin: ['PENDING', 'VERIFIED'] },
    },
    {
      $set: { status: 'PENDING', submittedAt: new Date(), challengeUsedAt: new Date(), proof, checks, reviewNote: '' },
      $unset: { reviewerId: 1, reviewedAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw ApiError.conflict('This code was already used or has expired. Get a new one.', 'CODE_USED');
  return ownView(updated);
}

/** The business level: one ID number + legal name, format-checked here and checked by a person on the public portal. */
export async function submitBusiness(user, { idType, idNumber, legalName }) {
  const profile = await getOwnBrandProfile(user);
  const level = levelOf(profile);
  if (rank(level) < 1) throw ApiError.conflict('Verify your domain first. Business verification comes after it.', 'DOMAIN_VERIFICATION_REQUIRED');
  if (rank(level) >= 2) throw ApiError.conflict('Your business is already verified.', 'ALREADY_VERIFIED');

  const number = normalizeBusinessId(idNumber);
  if (!isValidBusinessId(idType, number)) {
    const hint = BUSINESS_ID_PATTERNS[idType]?.hint ?? 'Check the number.';
    throw ApiError.badRequest(`That ${idType} number does not look right. ${hint}`, [{ location: 'body', field: 'idNumber', message: hint }]);
  }
  const doc = await BrandVerification.findOneAndUpdate(
    { brandId: user._id, level: 'business', status: { $ne: 'PENDING' } },
    {
      $set: {
        status: 'PENDING',
        submittedAt: new Date(),
        business: { idType, idNumber: number, legalName: legalName.trim() },
        checks: [{ id: 'format', label: `${idType} format is valid`, result: 'pass', detail: 'Format only. Check the number on the public portal.' }],
        reviewNote: '',
      },
      $unset: { reviewerId: 1, reviewedAt: 1 },
      $setOnInsert: { brandId: user._id, level: 'business' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).catch((err) => {
    if (err?.code === 11000) throw ApiError.conflict('Your business is already waiting for review.', 'ALREADY_PENDING');
    throw err;
  });
  return ownView(doc);
}

/* ------------------------------------------------------------------ */
/* Reviewer                                                            */
/* ------------------------------------------------------------------ */

async function hydrateForReview(docs) {
  const brands = await mapBy(BrandProfile, docs.map((d) => d.brandId), { key: 'userId', projection: 'userId companyName websiteUrl accountType brandTrustLevel isDemo' });
  return docs.map((d) => {
    const b = brands.get(String(d.brandId));
    return {
      ...d,
      brand: b ? { _id: b._id, companyName: b.companyName, websiteUrl: b.websiteUrl, accountType: b.accountType ?? 'brand', level: levelOf(b), isDemo: !!b.isDemo } : null,
    };
  });
}

export async function listForReview(q) {
  const filter = { status: q.status ?? 'PENDING' };
  if (q.tab) filter.level = q.tab;
  const pg = paginate(q);
  const sort = filter.status === 'PENDING' ? { submittedAt: 1 } : { reviewedAt: -1 };
  const [docs, total, domain, business, counts] = await Promise.all([
    BrandVerification.find(filter).sort(sort).skip(pg.skip).limit(pg.limit).lean(),
    BrandVerification.countDocuments(filter),
    BrandVerification.countDocuments({ status: 'PENDING', level: 'domain' }),
    BrandVerification.countDocuments({ status: 'PENDING', level: 'business' }),
    BrandVerification.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return {
    ...pageResult(await hydrateForReview(docs), total, pg),
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    tabs: { domain, business, all: domain + business },
  };
}

const TARGET_LEVEL = { domain: 'domain_verified', business: 'business_verified' };

/** Raise (never lower) a brand's level. */
async function raiseLevel(brandId, target, session) {
  const lower = LEVEL_ORDER.slice(0, rank(target));
  await BrandProfile.updateOne(
    { userId: brandId, $or: [{ brandTrustLevel: { $in: lower } }, { brandTrustLevel: { $exists: false } }] },
    { $set: { brandTrustLevel: target } },
    { session },
  );
}

export async function decide(reviewer, id, { decision, note }) {
  const now = new Date();
  const current = await BrandVerification.findById(id, 'level status brandId').lean();
  if (!current) throw ApiError.notFound('Submission not found');
  if (decision === 'VERIFIED' && current.level === 'business') {
    const profile = await BrandProfile.findOne({ userId: current.brandId }, 'brandTrustLevel').lean();
    if (rank(levelOf(profile)) < 1) throw ApiError.conflict('Approve this brand\'s domain first.', 'DOMAIN_VERIFICATION_REQUIRED');
  }
  // ASK_MORE sends the claim back to the brand (self-reported, with the reviewer's note) instead of deciding it.
  const set = { status: decision === 'ASK_MORE' ? 'SELF_REPORTED' : decision, reviewNote: note ?? '', reviewerId: reviewer._id, reviewedAt: now };
  const update = { $set: set };
  if (decision === 'ASK_MORE') update.$unset = { submittedAt: 1 };

  const doc = await withTransaction(async (session) => {
    // Conditional update: only PENDING submissions can be decided, and only once.
    const updated = await BrandVerification.findOneAndUpdate({ _id: id, status: 'PENDING' }, update, { returnDocument: 'after', session }).lean();
    if (updated && decision === 'VERIFIED') await raiseLevel(updated.brandId, TARGET_LEVEL[updated.level], session);
    return updated;
  });
  if (!doc) {
    const exists = await BrandVerification.findById(id, 'status').lean();
    if (!exists) throw ApiError.notFound('Submission not found');
    throw ApiError.invalidTransition(exists.status, decision === 'ASK_MORE' ? 'SELF_REPORTED' : decision);
  }
  const [hydrated] = await hydrateForReview([doc]);
  return hydrated;
}

/* ------------------------------------------------------------------ */
/* Seed data and grandfathered brands                                   */
/* ------------------------------------------------------------------ */

/**
 * Give a brand a level directly, with an approved record that says why (demo seed, grandfathered).
 * Idempotent: it never lowers a level and never overwrites a real reviewer's decision.
 */
export async function grantLevel(brandId, target, { note, reviewerId } = {}) {
  const levels = rank(target) >= 2 ? ['domain', 'business'] : ['domain'];
  const now = new Date();
  for (const level of levels) {
    await BrandVerification.updateOne(
      { brandId, level },
      { $setOnInsert: { brandId, level, status: 'VERIFIED', submittedAt: now, reviewedAt: now, reviewNote: note ?? '', ...(reviewerId ? { reviewerId } : {}) } },
      { upsert: true },
    );
  }
  await raiseLevel(brandId, target, null);
}
