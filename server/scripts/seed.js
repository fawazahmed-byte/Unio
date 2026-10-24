/**
 * Idempotent demo seed for UNIO.
 *   npm run seed            (uses MONGODB_URI and SEED_DEMO_PASSWORD from server/.env)
 *
 * - Users are keyed by email, profiles by userId, campaigns by (brandId, title),
 *   portfolio items by (creatorId, title), applications/invitations/projects by
 *   (campaignId, creatorId). Running it twice produces no duplicates.
 * - All demo emails use the reserved `.example` domain.
 * - Media URLs point at `media.unio.example/placeholder/...`; the frontend renders
 *   these as labelled placeholders. Replace them with hosted media before a demo.
 * - Team member profiles are DRAFTS: skills, tools and bios are suggestions to be
 *   confirmed by each person. They are not verified facts.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import {
  Application,
  BrandProfile,
  Campaign,
  CreatorProfile,
  Invitation,
  Message,
  PortfolioItem,
  Project,
  User,
  BrandVerification,
  VerificationSubmission,
} from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.service.js';
import { createProjectFromSource, decideVersion, postMessage, submitVersion } from '../src/services/projects.service.js';
import { recomputeCreatorTrust } from '../src/services/trust.service.js';
import { grantLevel } from '../src/services/brandVerification.service.js';
import { createApprovalLink } from '../src/services/approvals.service.js';
import { runChallengeChecks } from '../src/services/precheck.service.js';
import { decide, newChallengeCode } from '../src/services/verification.service.js';
import { demoCreators, team } from './seed-creators.js';

const PASSWORD = process.env.SEED_DEMO_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Set SEED_DEMO_PASSWORD (min 8 chars) in server/.env before seeding.');
  process.exit(1);
}

const media = (slug, ext = 'jpg') => `https://media.unio.example/placeholder/${slug}.${ext}`;
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const inDays = (n) => new Date(Date.now() + n * 86_400_000);

/* Creators (team drafts + v9 demo cast) live in seed-creators.js */

/* ------------------------------------------------------------------ */
/* Fictional demo brands and campaigns                                 */
/* ------------------------------------------------------------------ */
const rights = (usage, region, durationMonths, exclusive, extra = {}) => ({ usage, region, durationMonths, exclusive, portfolioAllowed: 'after_launch', commerciallySafeTools: true, aiLabel: true, likeness: 'none', ...extra });

const brands = [
  {
    name: 'Verdant Skin Co.', email: 'team@verdant.unio.example', industry: 'beauty',
    websiteUrl: 'https://verdant.unio.example',
    description: 'Demo brand. Plant-based skincare made in small batches, sold online across India.',
    brandKit: {
      colors: [{ name: 'Leaf', hex: '#2f5d46' }, { name: 'Sand', hex: '#e8b896' }, { name: 'Cream', hex: '#f4dcc8' }, { name: 'Clay', hex: '#c88a66' }],
      headingFont: 'Fraunces', bodyFont: 'Manrope', tone: ['Fresh', 'Honest', 'Calm'], neverDo: 'No exaggerated skin claims · No before/after shots',
      assetUrls: [],
    },
    campaigns: [
      {
        title: 'Summer SPF launch — vertical ads', category: 'beauty', status: 'open', budgetMin: 8000, budgetMax: 20000, deadline: inDays(30),
        brief: 'We are launching a lightweight SPF 50 gel for humid summers. We need short vertical ads that feel fresh and honest, not glossy. Show texture, absorption and a quick morning routine. No exaggerated skin claims.',
        requiredSkills: ['prompt', 'edit'], requiredTools: ['Kling', 'Runway', 'CapCut'],
        contentType: 'ad', formats: ['9:16', '4:5'], lengthNote: '15–20 s', style: 'Warm, sunny, natural skin texture, no heavy filters.', languages: ['Hindi', 'English'],
        rights: rights(['paid_ads', 'organic_social'], 'india', 6, false),
        deliverables: [{ title: 'Vertical video', description: '9:16 · 15–20 s · Hindi VO', quantity: 2 }, { title: 'Still frames', description: '4:5 + 1:1 crops pulled from the edit', quantity: 3 }],
      },
      {
        title: 'Ingredient explainer series', category: 'beauty', status: 'open', budgetMin: 5000, budgetMax: 12000, deadline: inDays(45),
        brief: 'A short series explaining our five hero ingredients. Calm, educational tone with simple motion graphics. Each episode under 40 seconds.',
        requiredSkills: ['kinetic', 'story'], requiredTools: ['After Effects'],
        contentType: 'motion', formats: ['1:1', '9:16'], lengthNote: 'Under 40 s each', style: 'Calm, flat illustration, botanical greens.', languages: ['English'],
        rights: rights(['organic_social', 'website'], 'india', 12, false),
        deliverables: [{ title: 'Explainer episode', description: 'Under 40 seconds, 1:1 and 9:16 exports', quantity: 5 }],
      },
      {
        title: 'Monsoon gift set stills', category: 'beauty', status: 'closed', budgetMin: 4000, budgetMax: 9000, deadline: inDays(-10),
        brief: 'Product stills for our monsoon gift box: rain-on-glass mood, deep greens, soft reflections.',
        requiredSkills: ['prompt', 'upscale'], requiredTools: ['Midjourney'],
        contentType: 'photo', formats: ['4:5', '16:9'], style: 'Rain-on-glass mood, deep greens, soft reflections.', languages: [],
        rights: rights(['organic_social', 'website'], 'india', 6, false),
        deliverables: [{ title: 'Hero still', description: '4:5 and 16:9', quantity: 4 }],
      },
    ],
  },
  {
    name: 'Northwind Audio', email: 'studio@northwind.unio.example', industry: 'tech',
    websiteUrl: 'https://northwind.unio.example',
    description: 'Demo brand. Independent audio hardware company designing earbuds and studio headphones.',
    brandKit: {
      colors: [{ name: 'Graphite', hex: '#22272b' }, { name: 'Steel', hex: '#8d9399' }, { name: 'Signal', hex: '#e4572e' }],
      headingFont: 'Space Grotesk', bodyFont: 'Inter', tone: ['Precise', 'Minimal'], neverDo: 'No exaggerated sound claims · No cluttered layouts',
      assetUrls: [],
    },
    campaigns: [
      {
        title: 'Wireless earbuds product film', category: 'tech', status: 'open', budgetMin: 15000, budgetMax: 35000, deadline: inDays(40),
        brief: 'A 30-second product film for our new noise-cancelling earbuds. Precise, architectural visuals: the case opening, the fit, sound visualised as space. Must work without voiceover.',
        requiredSkills: ['model3d', 'comp', 'edit'], requiredTools: ['Blender', 'Runway'],
        contentType: 'render3d', formats: ['16:9', '9:16'], lengthNote: '30 s + cut-downs', style: 'Precise, architectural, dark studio light.', languages: [],
        rights: rights(['website', 'paid_ads'], 'worldwide', 12, true),
        deliverables: [{ title: 'Product film', description: '30 seconds, 16:9 and 9:16 cut-downs', quantity: 1 }, { title: 'Exploded-view still', description: 'High-res, transparent background', quantity: 1 }],
      },
      {
        title: 'Studio headphones lookbook', category: 'tech', status: 'open', budgetMin: 8000, budgetMax: 16000, deadline: inDays(25),
        brief: 'Lifestyle imagery of musicians and producers using our studio headphones at home studios. Warm practical lighting, real-feeling spaces.',
        requiredSkills: ['prompt', 'comp'], requiredTools: ['Midjourney', 'Photoshop'],
        contentType: 'photo', formats: ['4:5'], style: 'Warm practical lighting, real-feeling home studios.', languages: [],
        rights: rights(['print', 'website'], 'worldwide', 12, true, { likeness: 'ai_only' }),
        deliverables: [{ title: 'Lifestyle image', description: '4:5, campaign-ready', quantity: 8 }],
      },
      {
        // Draft without rights: shows "Rights missing" on B2 until the brand answers them.
        title: 'Festival sale social pack', category: 'tech', status: 'draft', budgetMin: 5000, budgetMax: 10000, deadline: inDays(60),
        brief: 'Draft: social graphics for the festive sale period. Brief to be finalised.',
        requiredSkills: ['comp'], requiredTools: ['Figma'],
        contentType: 'static', formats: ['1:1', '9:16'], languages: [],
        rights: { usage: [], portfolioAllowed: 'after_launch', commerciallySafeTools: true, aiLabel: true, likeness: 'none' },
        aiFilledFields: ['title', 'contentType', 'formats', 'deliverables'],
        deliverables: [{ title: 'Social post', description: '1:1 and 9:16', quantity: 10 }],
      },
    ],
  },
  {
    name: 'Masala Trail Foods', email: 'hello@masalatrail.unio.example', industry: 'food',
    websiteUrl: 'https://masalatrail.unio.example',
    description: 'Demo brand. Regional spice blends and ready-to-cook kits from across India.',
    brandKit: {
      colors: [{ name: 'Chilli', hex: '#8a3b2e' }, { name: 'Haldi', hex: '#e9b44c' }, { name: 'Rice', hex: '#f6efe3' }, { name: 'Tava', hex: '#2b2420' }],
      headingFont: 'Playfair', bodyFont: 'Manrope', tone: ['Warm', 'Homely', 'Regional'], neverDo: 'No health claims · No alcohol · No real-person likeness without consent',
      assetUrls: [],
    },
    campaigns: [
      {
        title: 'Regional recipe reels', category: 'food', status: 'open', budgetMin: 6000, budgetMax: 14000, deadline: inDays(35),
        brief: 'Short recipe reels for four regional blends. Close-up cooking moments, steam, sizzling tadka. Should feel like a home kitchen, not a studio.',
        requiredSkills: ['prompt', 'edit', 'regional'], requiredTools: ['Kling', 'CapCut'],
        contentType: 'short', formats: ['9:16'], lengthNote: '20–40 s', style: 'Home kitchen, steam, warm close-ups.', languages: ['Hindi', 'Tamil', 'Bengali'],
        rights: rights(['organic_social'], 'india', 3, false),
        deliverables: [{ title: 'Recipe reel', description: '20–40 seconds, 9:16', quantity: 4 }],
      },
      {
        title: 'Packaging hero imagery', category: 'food', status: 'open', budgetMin: 4000, budgetMax: 9000, deadline: inDays(20),
        brief: 'Hero images of our new kraft-paper packaging surrounded by whole spices. Overhead and three-quarter angles.',
        requiredSkills: ['prompt', 'upscale'], requiredTools: ['Midjourney', 'Firefly'],
        contentType: 'photo', formats: ['1:1', '4:5'], style: 'Overhead and three-quarter angles, whole spices, natural light.', languages: [],
        rights: rights(['website', 'paid_ads', 'print'], 'india', 12, false),
        deliverables: [{ title: 'Packaging hero', description: '1:1 and 4:5', quantity: 6 }],
      },
    ],
  },
].map((b) => ({ ...b, isDemo: true }));

/* ------------------------------------------------------------------ */

async function upsertUser({ name, email, role }, passwordHash) {
  return User.findOneAndUpdate(
    { email },
    { $set: { name, role }, $setOnInsert: { email, passwordHash } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function seedCreator(c, passwordHash) {
  const user = await upsertUser({ name: c.name, email: c.email, role: 'creator' }, passwordHash);
  const profile = await CreatorProfile.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        displayName: c.name, bio: c.bio, location: c.location, skills: c.skills, tools: c.tools,
        specialties: c.specialties ?? [], startingPrice: c.startingPrice ?? undefined, availability: c.availability,
        featured: c.featured, isDemo: c.isDemo,
        // Round 2 (taxonomy ids). Trust fields are NOT set here — recomputeCreatorTrust() owns them.
        headline: c.headline ?? '', category: c.category, secondaryCategories: c.secondaryCategories ?? [],
        contentTypes: c.contentTypes ?? [], specializations: c.specializations ?? [], styles: c.styles ?? [],
        formats: c.formats ?? [], languages: c.languages ?? [], workflow: c.workflow ?? [], howIWork: c.howIWork ?? [],
        turnaroundDays: c.turnaroundDays, revisionsIncluded: c.revisionsIncluded ?? 2, commerciallySafe: !!c.commerciallySafe,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();

  for (const item of c.portfolio) {
    const slug = `${slugify(c.name)}-${slugify(item.title)}`;
    // A piece's tools always include the tools named in its workflow (same rule as the API).
    const tools = [...new Set([...(item.tools ?? []), ...(item.workflow ?? []).map((s) => s.tool)])];
    await PortfolioItem.findOneAndUpdate(
      { creatorId: profile._id, title: item.title },
      {
        $set: { ...item, tools, featured: !!item.featured },
        // Media links are only set on first insert so re-seeding never overwrites real uploads.
        $setOnInsert: {
          mediaUrl: media(slug, item.mediaType === 'video' ? 'mp4' : 'jpg'),
          thumbnailUrl: media(`${slug}-thumb`),
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  }
  return profile;
}

/** Demo brands start fully verified (the seeded projects need it); the record says it is demo data. */
const grantDemoLevel = (user) => grantLevel(user._id, 'business_verified', { note: 'Demo seed — not a real check.' });

async function seedBrand(b, passwordHash) {
  const user = await upsertUser({ name: b.name, email: b.email, role: 'brand' }, passwordHash);
  await BrandProfile.findOneAndUpdate(
    { userId: user._id },
    { $set: { companyName: b.name, industry: b.industry, websiteUrl: b.websiteUrl, description: b.description, brandKit: b.brandKit, isDemo: true } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  await grantDemoLevel(user);
  const campaigns = {};
  for (const c of b.campaigns) {
    campaigns[c.title] = await Campaign.findOneAndUpdate(
      { brandId: user._id, title: c.title },
      { $set: { ...c, brandId: user._id } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
  }
  return { user, campaigns };
}

/* ------------------------------------------------------------------ */
/* Demo agency (F2): Pixel & Pine Studio and its four clients           */
/* ------------------------------------------------------------------ */
const agency = {
  name: 'Pixel & Pine Studio', email: 'studio@pixelpine.unio.example',
  clients: [
    { name: 'Verdant Skin Co.', industry: 'beauty', initials: 'VS', color: 'green', approverName: 'Vidya Sharma', approverEmail: 'vidya.sharma@verdant-skin.example' },
    { name: 'Brewhaus Coffee', industry: 'food', initials: 'BH', color: 'sand', approverName: 'Arnav Shah', approverEmail: 'arnav.shah@brewhaus.example' },
    { name: 'Kinetic Shoes', industry: 'fashion', initials: 'KS', color: 'blue', approverName: 'Neha Iyer', approverEmail: 'neha.iyer@kinetic-shoes.example' },
    { name: 'Nimbu Drinks', industry: 'food', initials: 'ND', color: 'olive' },
  ],
  campaigns: [
    {
      client: 'Verdant Skin Co.', title: 'Monsoon glow serum — vertical ads', category: 'beauty', status: 'open', budgetMin: 10000, budgetMax: 24000, deadline: inDays(26),
      brief: 'A dewy, lightweight serum for the monsoon months. Short vertical ads that show the glow on real skin tones without heavy filters or exaggerated claims.',
      requiredSkills: ['prompt', 'edit'], requiredTools: ['Kling', 'Runway'], contentType: 'ad', formats: ['9:16'], lengthNote: '15 s', style: 'Soft daylight, dewy, honest texture.', languages: ['Hindi', 'English'],
      rights: rights(['paid_ads', 'organic_social'], 'india', 6, false), deliverables: [{ title: 'Vertical ad', description: '9:16 · 15 s · Hindi VO', quantity: 1 }],
    },
    {
      client: 'Verdant Skin Co.', title: 'Vitamin C ritual — explainer series', category: 'beauty', status: 'open', budgetMin: 14000, budgetMax: 30000, deadline: inDays(40),
      brief: 'A calm, educational three-part series on a morning vitamin C routine. Clear steps, soft animation, no before/after shots.',
      requiredSkills: ['story', 'edit'], requiredTools: ['Runway', 'CapCut'], contentType: 'short', formats: ['9:16'], lengthNote: '30–45 s each', style: 'Calm, clear, light animation.', languages: ['English'],
      rights: rights(['organic_social', 'website'], 'india', 12, false), deliverables: [{ title: 'Explainer episode', description: '9:16 · 30–45 s · English VO', quantity: 1 }],
    },
    {
      client: 'Brewhaus Coffee', title: 'Cold brew launch teaser', category: 'food', status: 'open', budgetMin: 9000, budgetMax: 18000, deadline: inDays(21),
      brief: 'A moody teaser for a new cold brew can. Condensation, ice, slow pours. Ends on the can and a launch date card.',
      requiredSkills: ['prompt', 'grade'], requiredTools: ['Veo', 'CapCut'], contentType: 'ad', formats: ['9:16', '16:9'], lengthNote: '10 s', style: 'Dark, cold, glossy highlights.', languages: ['English'],
      rights: rights(['paid_ads', 'organic_social'], 'india', 3, true), deliverables: [{ title: 'Teaser film', description: '9:16 + 16:9 · 10 s', quantity: 1 }],
    },
    {
      client: 'Kinetic Shoes', title: 'Spring drop lookbook', category: 'fashion', status: 'closed', budgetMin: 12000, budgetMax: 26000, deadline: inDays(-12),
      brief: 'A styled lookbook for the spring sneaker drop: eight stills with consistent character, light and colour.',
      requiredSkills: ['consist', 'prompt'], requiredTools: ['Midjourney', 'Photoshop'], contentType: 'static', formats: ['4:5'], lengthNote: '8 stills', style: 'Street, bright, saturated.', languages: [],
      rights: rights(['organic_social', 'website'], 'worldwide', 12, false), deliverables: [{ title: 'Lookbook stills', description: '4:5 · 8 images', quantity: 1 }],
    },
    {
      client: 'Kinetic Shoes', title: 'Trail runner launch film', category: 'fashion', status: 'open', budgetMin: 20000, budgetMax: 45000, deadline: inDays(50),
      brief: 'A 20-second launch film for a trail running shoe. Mud, speed, a mountain dawn. Must feel physical, not CGI-clean.',
      requiredSkills: ['story', 'comp'], requiredTools: ['Kling', 'Runway', 'After Effects'], contentType: 'ad', formats: ['16:9', '9:16'], lengthNote: '20 s', style: 'Gritty, cinematic, natural light.', languages: ['English'],
      rights: rights(['paid_ads', 'tv_ott'], 'india', 12, false), deliverables: [{ title: 'Launch film', description: '16:9 + 9:16 · 20 s', quantity: 1 }],
    },
  ],
};

async function seedAgency(a, passwordHash) {
  const user = await upsertUser({ name: a.name, email: a.email, role: 'brand' }, passwordHash);
  // Clients are subdocuments with ids, so they are only written when the profile is first created.
  const profile = await BrandProfile.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        companyName: a.name, accountType: 'agency', contactName: 'Demo agency lead', jobTitle: 'Founder', teamSize: '2-10',
        websiteUrl: 'https://pixelpine.unio.example', description: 'Demo agency. A small creative studio that runs AI-made campaigns for four clients.', isDemo: true,
      },
      $setOnInsert: { clients: a.clients },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  await grantDemoLevel(user);
  const clientOf = (name) => profile.clients.find((c) => c.name === name);
  const campaigns = {};
  for (const { client, ...c } of a.campaigns) {
    const cl = clientOf(client);
    campaigns[c.title] = await Campaign.findOneAndUpdate(
      { brandId: user._id, title: c.title },
      { $set: { ...c, brandId: user._id, clientId: cl._id, clientName: cl.name } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
  }
  return { user, campaigns };
}

async function upsertApplication(campaign, creator, proposal, proposedPrice, status) {
  return Application.findOneAndUpdate(
    { campaignId: campaign._id, creatorId: creator._id },
    { $setOnInsert: { campaignId: campaign._id, creatorId: creator._id, proposal, proposedPrice, status, submittedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
}

async function upsertInvitation(campaign, creator, message, status) {
  return Invitation.findOneAndUpdate(
    { campaignId: campaign._id, creatorId: creator._id },
    { $setOnInsert: { campaignId: campaign._id, creatorId: creator._id, brandId: campaign.brandId, message, status } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
}

async function main() {
  await connectDB();
  await Promise.all([User, CreatorProfile, BrandProfile, PortfolioItem, Campaign, Application, Invitation, Project, Message, VerificationSubmission, BrandVerification].map((m) => m.syncIndexes()));
  console.log(`Seeding database "${mongoose.connection.name}"...`);

  const passwordHash = await hashPassword(PASSWORD);

  const creators = {};
  for (const c of [...team, ...demoCreators]) creators[c.name] = await seedCreator(c, passwordHash);

  const brandData = {};
  for (const b of brands) brandData[b.name] = await seedBrand(b, passwordHash);

  const v = brandData['Verdant Skin Co.'].campaigns;
  const n = brandData['Northwind Audio'].campaigns;
  const m = brandData['Masala Trail Foods'].campaigns;
  const spf = v['Summer SPF launch — vertical ads'];

  // Applications
  const acceptedApp = await upsertApplication(
    spf, creators['Meera Kulkarni'],
    'I would shoot this as two contrasting spots: a slow macro texture film and a fast 15-second routine cut. I can deliver both vertical edits and the three stills within two weeks.',
    16000, 'accepted',
  );
  await upsertApplication(spf, creators['Ananya Rao'], 'I can deliver UGC-style versions with an AI presenter, three hooks per edit so you can test what performs best.', 9000, 'pending');
  await upsertApplication(spf, creators['Arjun Menon'], 'I focus on stills, so I would propose a still-led version with subtle motion added in post.', 8000, 'rejected');
  await upsertApplication(n['Wireless earbuds product film'], creators['Rohan Das'], 'Blender is my main tool for this kind of brief. I would build the case and buds in 3D and texture the environment with diffusion passes for a premium, precise look.', 30000, 'pending');
  await upsertApplication(m['Regional recipe reels'], creators['Ishita Bansal'], 'Food is all I shoot. I would build each reel around one hero moment, the tadka hitting the oil, and keep the colours warm and homely.', 12000, 'pending');
  await upsertApplication(m['Packaging hero imagery'], creators['Fawaz Ahmed'], 'Draft demo application: I can produce overhead and three-quarter hero images of the new packaging with whole spices styled around it.', 7000, 'pending');

  // Invitations
  await upsertInvitation(v['Ingredient explainer series'], creators['Zoya Siddiqui'], 'We loved your fintech explainer. Would you be open to a calm, educational series for our ingredients?', 'pending');
  const acceptedInv = await upsertInvitation(n['Studio headphones lookbook'], creators['Sana Qureshi'], 'Your lookbook styling is exactly the warmth we want for our headphones campaign.', 'accepted');
  await upsertInvitation(n['Wireless earbuds product film'], creators['Kabir Malhotra'], 'Interested in bringing a music-video energy to our earbuds film?', 'declined');
  await upsertInvitation(m['Regional recipe reels'], creators['Meera Kulkarni'], 'Would you consider a food brief? Your product films have the texture we are after.', 'pending');

  // Projects (exactly one per accepted pair)
  const p1 = await createProjectFromSource({ campaign: spf, creatorId: creators['Meera Kulkarni']._id, sourceType: 'application', sourceId: acceptedApp._id });
  const p2 = await createProjectFromSource({
    campaign: n['Studio headphones lookbook'], creatorId: creators['Sana Qureshi']._id, sourceType: 'invitation', sourceId: acceptedInv._id,
  });

  // F6 demo history, written through the same service calls the app uses, and only on untouched
  // projects so reseeding keeps manual changes. Media links are placeholders on the reserved .example domain.
  const asUser = async (email) => User.findOne({ email }).lean();
  const verdant = await asUser('team@verdant.unio.example');
  const northwind = await asUser('studio@northwind.unio.example');
  const meera = await User.findById(creators['Meera Kulkarni'].userId).lean();
  const sana = await User.findById(creators['Sana Qureshi'].userId).lean();

  if (p1.status === 'not_started' && !p1.deliverables[0].currentVersion) {
    const [video, stills] = p1.deliverables;
    const id = p1._id;
    await submitVersion(meera, id, video._id, { mediaUrl: media('verdant-spf-vertical-v1', 'mp4'), changeNote: 'First version', toolsUsed: ['Kling', 'CapCut'] });
    await postMessage(verdant, id, { body: 'Great start! The texture shots are lovely. Can the hook land faster?', about: { deliverableId: String(video._id), versionNumber: 1 } });
    await decideVersion(verdant, id, video._id, 1, { decision: 'changes', note: 'Hook should land in the first 2 seconds — open on the gel, not the bottle.' });
    await submitVersion(meera, id, video._id, { mediaUrl: media('verdant-spf-vertical-v2', 'mp4'), changeNote: 'Opens on the gel texture; hook now lands at 1.5 s', toolsUsed: ['Kling', 'Runway', 'CapCut'] });
    await postMessage(meera, id, { body: 'Moved the gel shot to the open. Also warmed the grade a little — tell me if it’s too much.', about: { deliverableId: String(video._id), versionNumber: 2 } });
    await decideVersion(verdant, id, video._id, 2, { decision: 'changes', note: 'Grade is right. Please add Hindi captions on screen for the voice-over.' });
    await submitVersion(meera, id, video._id, { mediaUrl: media('verdant-spf-vertical-v3', 'mp4'), changeNote: 'Hindi captions added, safe-area checked for Reels', toolsUsed: ['Kling', 'Runway', 'CapCut'] });
    await submitVersion(meera, id, stills._id, { mediaUrl: media('verdant-spf-stills-v1', 'jpg'), changeNote: 'First version', toolsUsed: ['Midjourney', 'Photoshop'] });
    await postMessage(meera, id, { body: 'v3 is up with captions, and the three stills are ready too.' });
  }

  if (p2.status === 'not_started' && !p2.deliverables[0].currentVersion) {
    const [images] = p2.deliverables;
    await submitVersion(sana, p2._id, images._id, { mediaUrl: media('northwind-lookbook-v1', 'jpg'), changeNote: 'First version', toolsUsed: ['Midjourney', 'Photoshop'] });
    await postMessage(northwind, p2._id, { body: 'These feel exactly like real home studios. Approving now — thank you!' });
    await decideVersion(northwind, p2._id, images._id, 1, { decision: 'approve' });
  }

  // Agency demo (F2): four clients, five briefs, four projects at different stages, two approval links.
  // Everything goes through the same service calls the app uses, and only on untouched projects.
  const ag = await seedAgency(agency, passwordHash);
  const agencyUser = ag.user;
  const hire = async (campaignTitle, creatorName, proposal, price) => {
    const campaign = ag.campaigns[campaignTitle];
    const creator = creators[creatorName];
    const application = await upsertApplication(campaign, creator, proposal, price, 'accepted');
    const project = await createProjectFromSource({ campaign, creatorId: creator._id, sourceType: 'application', sourceId: application._id });
    return { project, creatorUser: await User.findById(creator.userId).lean() };
  };
  const untouched = (p) => p.status === 'not_started' && !p.deliverables[0].currentVersion;
  const sentLinks = [];

  const glow = await hire('Monsoon glow serum — vertical ads', 'Meera Kulkarni', 'I would open on a macro of the serum catching window light, then a quick routine on real skin. Hindi VO, 15 seconds, captions for Reels.', 18000);
  if (untouched(glow.project)) {
    const d = glow.project.deliverables[0]._id;
    const id = glow.project._id;
    await submitVersion(glow.creatorUser, id, d, { mediaUrl: media('pixelpine-glow-v1', 'mp4'), changeNote: 'First version', toolsUsed: ['Kling', 'CapCut'] });
    await decideVersion(agencyUser, id, d, 1, { decision: 'changes', note: 'Show the serum in the first 2 seconds, then the routine.' });
    await submitVersion(glow.creatorUser, id, d, { mediaUrl: media('pixelpine-glow-v2', 'mp4'), changeNote: 'Serum now lands at 1.2 s; routine shortened', toolsUsed: ['Kling', 'Runway', 'CapCut'] });
    sentLinks.push(['Verdant', await createApprovalLink(agencyUser, id, { deliverableId: String(d) })]);
  }

  const ritual = await hire('Vitamin C ritual — explainer series', 'Zoya Siddiqui', 'Calm, clean motion graphics with a soft voice-over. Three episodes with one idea each, so the routine is easy to follow.', 24000);
  if (untouched(ritual.project)) {
    const d = ritual.project.deliverables[0]._id;
    await submitVersion(ritual.creatorUser, ritual.project._id, d, { mediaUrl: media('pixelpine-ritual-v1', 'mp4'), changeNote: 'First version', toolsUsed: ['Runway', 'CapCut'] });
    await decideVersion(agencyUser, ritual.project._id, d, 1, { decision: 'changes', note: 'Slow the pacing a little and show the dropper at 0:12.' });
  }

  const coldBrew = await hire('Cold brew launch teaser', 'Vihaan Shah', 'Dark, glossy and slow: ice cracking, a long pour, then the can. I would grade it cold with warm highlights on the label.', 15000);
  if (untouched(coldBrew.project)) {
    const d = coldBrew.project.deliverables[0]._id;
    await submitVersion(coldBrew.creatorUser, coldBrew.project._id, d, { mediaUrl: media('pixelpine-coldbrew-v1', 'mp4'), changeNote: 'First version', toolsUsed: ['Veo', 'CapCut'] });
    sentLinks.push(['Brewhaus', await createApprovalLink(agencyUser, coldBrew.project._id, { deliverableId: String(d) })]);
  }

  const lookbook = await hire('Spring drop lookbook', 'Sana Qureshi', 'Eight stills with one consistent character and a warm street palette. I will lock the character first, then vary the poses.', 22000);
  if (untouched(lookbook.project)) {
    const d = lookbook.project.deliverables[0]._id;
    await submitVersion(lookbook.creatorUser, lookbook.project._id, d, { mediaUrl: media('pixelpine-lookbook-v1', 'jpg'), changeNote: 'First version', toolsUsed: ['Midjourney', 'Photoshop'] });
    await decideVersion(agencyUser, lookbook.project._id, d, 1, { decision: 'approve' });
  }
  // Links are shown once, so print the demo ones when they are created (nothing is stored but their hash).
  for (const [client, link] of sentLinks) console.log(`Demo approval link for ${client} (shown once): ${link.url}`);

  // Reviewer account (operator-provisioned role; cannot be chosen at sign-up).
  const reviewer = await upsertUser({ name: 'UNIO Reviewer', email: 'reviewer@unio.example', role: 'reviewer' }, passwordHash);
  await BrandVerification.updateMany({ reviewNote: /^Demo seed/, reviewerId: { $exists: false } }, { $set: { reviewerId: reviewer._id } });

  // Verification demo. Claims are seeded as PENDING (submitted, with placeholder evidence on the reserved
  // .example domain) or SELF_REPORTED. Demo creators' "v" tools are then APPROVED through the same
  // verification.service.decide() a reviewer uses, by the seeded reviewer, with a "Demo seed" note
  // (guide §9). Nothing is written as VERIFIED directly, and team drafts are never verified.
  const claims = [
    ['Meera Kulkarni', {
      type: 'workflow', subject: 'Storyboard → Kling → CapCut', submit: true,
      description: 'Hand-drawn storyboard, keyframes generated per shot, image-to-video in Kling, then edit, grade and sound design in CapCut.',
    }],
    ['Meera Kulkarni', { type: 'portfolio', portfolioTitle: 'Dewdrop serum — 15s vertical', submit: true }],
  ];
  for (const c of demoCreators) {
    for (const [tool, state] of Object.entries(c.toolStates ?? {})) {
      // One pending claim goes through the real challenge flow (code, recording, screenshots, pre-checks) for the reviewer demo.
      if (state === 'v' || state === 'p') claims.push([c.name, { type: 'tool', subject: tool, submit: true, approve: state === 'v', challenge: state === 'p' && tool === 'Veo' }]);
    }
  }
  const toApprove = [];
  for (const [name, c] of claims) {
    const creator = creators[name];
    let { subject } = c;
    let portfolioItemId;
    if (c.type === 'portfolio') {
      const item = await PortfolioItem.findOne({ creatorId: creator._id, title: c.portfolioTitle }, 'title').lean();
      if (!item) continue;
      subject = item.title;
      portfolioItemId = item._id;
    }
    const key = c.type === 'portfolio' ? `portfolio:${portfolioItemId}` : `${c.type}:${subject.toLowerCase()}`;
    let challenge = {};
    if (c.challenge) {
      const issuedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const base = `${slugify(name)}-${slugify(subject)}`;
      const recordingUrl = media(`${base}-recording`, 'mp4');
      const screenshotUrls = [1, 2].map((n) => media(`${base}-screenshot-${n}`, 'png'));
      const challengeCode = newChallengeCode();
      // Placeholder links on the reserved .example domain: nothing is fetched, so those checks read "unknown".
      const checks = await runChallengeChecks({ creatorId: creator._id, tool: subject, code: challengeCode, issuedAt, recordingUrl, screenshotUrls, skipNetwork: true });
      challenge = {
        method: 'challenge', challengeCode, challengeIssuedAt: issuedAt, challengeExpiresAt: new Date(issuedAt.getTime() + 48 * 60 * 60 * 1000),
        challengeUsedAt: new Date(issuedAt.getTime() + 60 * 60 * 1000), recordingUrl, screenshotUrls, evidenceUrls: [recordingUrl, ...screenshotUrls], checks,
        submittedAt: new Date(issuedAt.getTime() + 60 * 60 * 1000),
      };
    }
    await VerificationSubmission.updateOne(
      { creatorId: creator._id, key },
      {
        $setOnInsert: {
          creatorId: creator._id, type: c.type, key, subject, portfolioItemId, description: c.description ?? '',
          evidenceUrls: c.submit ? [media(`${slugify(name)}-${slugify(subject)}-evidence`, 'html')] : [],
          status: c.submit ? 'PENDING' : 'SELF_REPORTED',
          submittedAt: c.submit ? new Date() : undefined,
          ...challenge,
        },
      },
      { upsert: true },
    );
    if (c.approve) toApprove.push({ creatorId: creator._id, key });
  }

  for (const { creatorId, key } of toApprove) {
    const claim = await VerificationSubmission.findOne({ creatorId, key }, 'status').lean();
    // Idempotent: only claims still waiting are decided; an existing decision is left alone.
    if (claim?.status === 'PENDING') {
      await decide(reviewer, claim._id, { decision: 'VERIFIED', note: 'Demo seed — sample review for demonstration, not a real check.' });
    }
  }

  // Trust fields come only from the recompute (claims, completed projects, feedback).
  for (const creator of Object.values(creators)) await recomputeCreatorTrust(creator._id);

  const counts = {};
  for (const [name, model] of Object.entries({ users: User, creatorProfiles: CreatorProfile, brandProfiles: BrandProfile, portfolioItems: PortfolioItem, campaigns: Campaign, applications: Application, invitations: Invitation, projects: Project, messages: Message, verificationSubmissions: VerificationSubmission, brandVerifications: BrandVerification })) {
    counts[name] = await model.countDocuments();
  }
  console.table(counts);
  console.log(`Demo accounts use password from SEED_DEMO_PASSWORD. Example creator: meera-kulkarni@creators.unio.example · brand: team@verdant.unio.example · reviewer: reviewer@unio.example`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
