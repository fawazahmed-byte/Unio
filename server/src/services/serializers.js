import { RIGHTS_DURATIONS, RIGHTS_REGIONS, RIGHTS_USAGE } from '../models/taxonomy.js';

/** Public-safe shapes. Never include emails, password hashes or internal user ids. */

export function publicUser(user) {
  if (!user) return null;
  return { _id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

/** Server-computed trust fields (services/trust.service.js). Read-only for every client. */
export function trustFields(p) {
  return {
    verifiedTools: p.verifiedTools ?? [],
    certifiedTools: p.certifiedTools ?? [],
    pendingTools: p.pendingTools ?? [],
    madeOnUnioCount: p.madeOnUnioCount ?? 0,
    ratingAvg: p.ratingCount ? p.ratingAvg : null,
    ratingCount: p.ratingCount ?? 0,
    trustLevel: p.trustLevel ?? 1,
  };
}

/**
 * Public creator. `skillCounts` (skill id → pieces proving it) decides which skills are shown:
 * a skill only appears when at least one portfolio piece backs it (guide §5.3).
 */
export function publicCreator(p, skillCounts = {}) {
  if (!p) return null;
  const backedSkills = (p.skills ?? []).filter((id) => skillCounts[id] > 0).map((id) => ({ id, pieces: skillCounts[id] }));
  return {
    _id: p._id,
    displayName: p.displayName,
    headline: p.headline ?? '',
    bio: p.bio,
    photoUrl: p.photoUrl,
    location: p.location,
    category: p.category ?? null,
    secondaryCategories: p.secondaryCategories ?? [],
    contentTypes: p.contentTypes ?? [],
    specializations: p.specializations ?? [],
    styles: p.styles ?? [],
    formats: p.formats ?? [],
    languages: p.languages ?? [],
    skills: backedSkills.map((s) => s.id),
    backedSkills,
    tools: p.tools,
    workflow: p.workflow ?? [],
    howIWork: p.howIWork ?? [],
    startingPrice: p.startingPrice,
    turnaroundDays: p.turnaroundDays ?? null,
    revisionsIncluded: p.revisionsIncluded ?? null,
    commerciallySafe: !!p.commerciallySafe,
    availability: p.availability,
    featured: p.featured,
    isDemo: p.isDemo,
    createdAt: p.createdAt,
    ...trustFields(p),
  };
}

export function creatorSummary(p) {
  if (!p) return null;
  return {
    _id: p._id,
    displayName: p.displayName,
    photoUrl: p.photoUrl,
    location: p.location,
    category: p.category ?? null,
    headline: p.headline ?? '',
    skills: p.skills,
    tools: p.tools,
    startingPrice: p.startingPrice,
    availability: p.availability,
    isDemo: p.isDemo,
    specializations: p.specializations ?? [],
    ...trustFields(p),
  };
}

export function publicBrand(b) {
  if (!b) return null;
  return {
    _id: b._id,
    companyName: b.companyName,
    accountType: b.accountType ?? 'brand',
    logoUrl: b.logoUrl,
    websiteUrl: b.websiteUrl,
    industry: b.industry,
    description: b.description,
    // Colours only: shown as swatches on briefs. The rest of the kit stays with the brand and the brief builder.
    kitColors: (b.brandKit?.colors ?? []).map(({ name, hex }) => ({ name, hex })),
    isDemo: b.isDemo,
    // "domain_verified" | "business_verified"; absent for signed_up, so there is no badge to fake.
    trustLevel: b.brandTrustLevel === 'domain_verified' || b.brandTrustLevel === 'business_verified' ? b.brandTrustLevel : undefined,
  };
}

/* ---------- Rights & usage (F7) ---------- */

const label = (list, id) => list.find((o) => o.id === id)?.label;

/** Fields a brief must answer before it can be opened. */
export function missingRights(rights = {}) {
  const missing = [];
  if (!rights.usage?.length) missing.push('usage');
  if (!rights.region) missing.push('region');
  if (rights.durationMonths == null) missing.push('durationMonths');
  if (rights.exclusive == null) missing.push('exclusive');
  return missing;
}

/** One-line summary used everywhere a brief appears: "Paid ads + Organic social · India · 6 months · Non-exclusive". */
export function rightsSummary(rights = {}) {
  if (missingRights(rights).length) return null;
  const usage = rights.usage.map((u) => label(RIGHTS_USAGE, u)).join(' + ');
  const region = rights.region === 'custom' ? rights.regionNote || 'Custom region' : label(RIGHTS_REGIONS, rights.region);
  const duration = label(RIGHTS_DURATIONS, rights.durationMonths);
  return [usage, region, duration, rights.exclusive ? 'Exclusive' : 'Non-exclusive'].join(' · ');
}

/** Adds rightsSummary + rightsComplete to any campaign object. */
export function withRights(c) {
  return c ? { ...c, rightsSummary: rightsSummary(c.rights), rightsComplete: missingRights(c.rights).length === 0 } : c;
}

export function campaignSummary(c) {
  if (!c) return null;
  return {
    _id: c._id,
    title: c.title,
    category: c.category,
    status: c.status,
    deadline: c.deadline,
    budgetMin: c.budgetMin,
    budgetMax: c.budgetMax,
    contentType: c.contentType,
    rightsSummary: rightsSummary(c.rights),
  };
}
