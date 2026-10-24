process.env.NODE_ENV = 'test';

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

let replSet;

export async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri('unio_test'));
  await mongoose.connection.syncIndexes();
  const { createApp } = await import('../src/app.js');
  return createApp();
}

export async function stopDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}

export async function resetDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/** Test shortcut: put a brand at a verification level without going through a reviewer. */
export async function setBrandLevel(userId, level) {
  const { BrandProfile } = await import('../src/models/index.js');
  await BrandProfile.updateOne({ userId }, { $set: { brandTrustLevel: level } });
}

let counter = 0;

/** Minimum per-role sign-up fields (guide §6.1). `agency` = role brand + accountType agency. */
export function registerFields(kind, n = counter) {
  if (kind === 'creator') return { role: 'creator', category: 'video', city: 'Pune' };
  const brandBase = { role: 'brand', jobTitle: 'Marketing manager', companyName: `Company ${n}` };
  if (kind === 'agency') return { ...brandBase, accountType: 'agency', teamSize: '2-10', websiteUrl: 'https://agency.example.com' };
  return { ...brandBase, accountType: 'brand', industry: 'beauty' };
}

/**
 * Registers a user and returns a supertest agent that carries its session cookie.
 * Brands start verified (domain_verified) so the many tests that hire creators stay about hiring;
 * pass { verified: false } to test the signed_up behaviour of brand verification itself.
 */
export async function signUp(app, role, overrides = {}, { verified = true } = {}) {
  counter += 1;
  const agent = request.agent(app);
  const body = {
    name: `${role} ${counter}`,
    email: `${role}${counter}@example.com`,
    password: 'StrongPass123!',
    ...registerFields(role),
    ...overrides,
  };
  const res = await agent.post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (verified && role !== 'creator') await setBrandLevel(res.body.data.user._id ?? res.body.data.user.id, 'domain_verified');
  return { agent, user: res.body.data.user, profile: res.body.data.profile, body };
}

export const campaignPayload = (overrides = {}) => ({
  title: 'AI Summer Skincare Campaign',
  brief: 'Create a short vertical product advertisement for a summer skincare launch.',
  category: 'beauty',
  budgetMin: 5000,
  budgetMax: 15000,
  deadline: '2026-12-01T00:00:00.000Z',
  requiredSkills: ['edit', 'prompt'],
  requiredTools: ['Kling', 'Runway'],
  deliverables: [{ title: 'Vertical video', description: '15–30 seconds, 9:16', quantity: 2 }],
  contentType: 'ad',
  formats: ['9:16'],
  // F7: open campaigns must answer the rights questions.
  rights: { usage: ['paid_ads', 'organic_social'], region: 'india', durationMonths: 6, exclusive: false },
  status: 'open',
  ...overrides,
});

/** Reviewers can't self-register; tests provision one directly, like the seed/create-reviewer script. */
export async function signInReviewer(app) {
  const { User } = await import('../src/models/index.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  counter += 1;
  const email = `reviewer${counter}@example.com`;
  await User.create({ name: `Reviewer ${counter}`, email, role: 'reviewer', passwordHash: await hashPassword('StrongPass123!') });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: 'StrongPass123!' });
  if (res.status !== 200) throw new Error(`reviewer login failed: ${res.status}`);
  return { agent, user: res.body.data.user };
}
