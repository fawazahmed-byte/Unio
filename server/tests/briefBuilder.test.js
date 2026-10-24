import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { campaignPayload, resetDb, signUp, startDb, stopDb } from './helpers.js';
import { __setClientForTests, __setFetchForTests, normalizeDraft, templateDraft } from '../src/services/briefBuilder.service.js';

/** Build an SDK error instance without depending on constructor signatures. */
const sdkError = (Cls, props = {}) => Object.assign(Object.create(Cls.prototype), { message: 'mock', ...props });

const GOOD_DRAFT = {
  title: 'Monsoon SPF gel launch',
  category: 'beauty',
  objective: 'Launch a lightweight SPF gel for humid weather and drive first purchases.',
  targetAudience: 'Women and men 20–35 in Indian metros who commute daily.',
  creativeStyle: 'Fresh, honest, close-up textures; no exaggerated skin claims.',
  deliverables: [
    { title: 'Vertical video', description: '15–30s, 9:16', quantity: 2 },
    { title: '', description: 'dropped: no title', quantity: 1 },
  ],
  requiredSkills: ['Video editing', 'video editing', 'prompt'],
  requiredTools: ['Kling', 'Runway'],
  budgetMin: 20000,
  budgetMax: 8000,
  deadlineDays: 21,
  notes: '',
  contentType: 'Video ad',
  formats: ['9:16', '1:1', '21:9'],
  lengthNote: '15–20 s',
  style: 'Golden-hour light, natural skin texture',
  languages: ['hindi', 'English'],
  rights: { usage: ['Paid ads', 'organic_social'], region: 'india', durationMonths: 5, exclusive: false, portfolioAllowed: 'after_launch', aiLabel: true, likeness: 'none' },
  questions: [],
  warnings: [],
};

function fakeClient(impl) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return impl(params);
        },
      },
    },
  };
}

describe('normalizeDraft', () => {
  test('cleans, dedupes, swaps inverted budget, composes brief, drops empty deliverables', () => {
    const now = new Date('2026-10-11T00:00:00Z');
    const { fields, warnings } = normalizeDraft(GOOD_DRAFT, { now });
    assert.equal(fields.category, 'beauty');
    assert.deepEqual(fields.requiredSkills, ['edit', 'prompt'], 'labels and ids map onto skill ids, deduped');
    assert.equal(fields.budgetMin, 8000);
    assert.equal(fields.budgetMax, 20000);
    assert.equal(fields.deadline, '2026-11-01');
    assert.equal(fields.deliverables.length, 1);
    assert.match(fields.brief, /^Objective\n/);
    assert.match(fields.brief, /Target audience\n/);
    assert.equal(fields.status, 'draft');
    assert.deepEqual(warnings, []);
  });

  test('survives malformed input with safe defaults and warnings', () => {
    for (const junk of [null, 'not json', 42, { deliverables: 'x', requiredSkills: 'y', budgetMin: 'abc', deadlineDays: 9999 }]) {
      const { fields, warnings } = normalizeDraft(junk);
      assert.ok(fields.title.length >= 4);
      assert.ok(fields.brief.length >= 20);
      assert.equal(fields.deliverables.length, 1);
      assert.match(fields.deadline, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(warnings.length > 0);
    }
  });

  test('output always satisfies the campaign create validator', async () => {
    const { campaignBody } = await import('../src/validators/index.js');
    for (const input of [GOOD_DRAFT, null, templateDraft('Short reels for our new masala chai, budget 15k, in 2 weeks')]) {
      const { fields } = normalizeDraft(input);
      const result = campaignBody.safeParse(fields);
      assert.ok(result.success, JSON.stringify(result.error?.issues));
    }
  });
});

describe('Round 2 brief fields (F3 + F7)', () => {
  const now = new Date('2026-10-11T00:00:00Z');

  test('maps content type, formats, languages and rights onto the controlled lists', () => {
    const { fields, warnings } = normalizeDraft(GOOD_DRAFT, { now });
    assert.equal(fields.contentType, 'ad');
    assert.deepEqual(fields.formats, ['9:16', '1:1'], 'unknown format 21:9 dropped');
    assert.deepEqual(fields.languages, ['Hindi', 'English']);
    assert.equal(fields.lengthNote, '15–20 s');
    assert.deepEqual(fields.rights.usage, ['paid_ads', 'organic_social']);
    assert.equal(fields.rights.region, 'india');
    assert.equal(fields.rights.durationMonths, 6, '5 months snaps to the nearest allowed duration');
    assert.equal(fields.rights.exclusive, false);
    assert.ok(fields.aiFilledFields.includes('rights'));
    assert.ok(fields.aiFilledFields.includes('contentType'));
    assert.deepEqual(warnings, []);
  });

  test('drops unknown skills/tools/content types with a warning (no free text)', () => {
    const { fields, warnings } = normalizeDraft({ ...GOOD_DRAFT, contentType: 'hologram', requiredSkills: ['Juggling', 'prompt'], requiredTools: ['MadeUpAI', 'Kling'] }, { now });
    assert.equal(fields.contentType, null);
    assert.deepEqual(fields.requiredSkills, ['prompt']);
    assert.deepEqual(fields.requiredTools, ['Kling']);
    assert.ok(warnings.some((w) => /hologram/.test(w)));
    assert.ok(warnings.some((w) => /Juggling/.test(w) && /MadeUpAI/.test(w)));
  });

  test('likeness rule: people mentioned and unanswered → none + warning; a "real actors" answer wins', () => {
    const idea = 'Diwali reel for our mithai box, a family opening the box, Hindi voice-over';
    const raw = { ...GOOD_DRAFT, rights: { ...GOOD_DRAFT.rights, likeness: 'real_with_consent' } };
    const a = normalizeDraft(raw, { now, idea });
    assert.equal(a.fields.rights.likeness, 'none');
    assert.ok(a.warnings.some((w) => /mentions “family”/.test(w) && /Real likeness is set to none/.test(w)));
    const b = normalizeDraft(raw, { now, idea, answers: [{ id: 'likeness', answer: 'Real actors' }] });
    assert.equal(b.fields.rights.likeness, 'real_with_consent');
    assert.ok(!b.warnings.some((w) => /likeness/i.test(w)));
  });

  test('at most 3 clarifying questions, answered ones removed, malformed ones dropped', () => {
    const questions = [
      { id: 'likeness', question: 'Real or AI people?', options: ['AI-generated', 'Real actors'] },
      { id: 'region', question: 'Where will it run?', options: ['India', 'Worldwide'] },
      { id: 'portfolio', question: 'Portfolio?', options: ['Yes', 'No'] },
      { id: 'extra', question: 'A fourth question', options: ['A', 'B'] },
      { id: 'bad', question: 'No options', options: [] },
    ];
    const { questions: out, fields } = normalizeDraft({ ...GOOD_DRAFT, questions }, { now, answers: [{ id: 'region', answer: 'Worldwide' }] });
    assert.deepEqual(out.map((q) => q.id), ['likeness', 'portfolio', 'extra']);
    assert.equal(fields.rights.region, 'worldwide', 'answer applied to rights');
  });

  test('template asks the right questions and fills rights from the idea', () => {
    const d = templateDraft('Diwali reel for our mithai box, a family opening it, Instagram ads, budget 15k');
    assert.deepEqual(d.questions.map((q) => q.id), ['likeness', 'portfolio'], 'region known (Diwali → India), so not asked');
    assert.equal(d.rights.region, 'india');
    assert.ok(d.rights.usage.includes('paid_ads') && d.rights.usage.includes('organic_social'));
    const worldwide = templateDraft('Product stills for our headphones, sold worldwide');
    assert.equal(worldwide.rights.region, 'worldwide');
    assert.ok(!worldwide.questions.some((q) => q.id === 'likeness'));
  });

  test('a short deadline adds a rush warning', () => {
    const { warnings } = normalizeDraft({ ...GOOD_DRAFT, deadlineDays: 4 }, { now });
    assert.ok(warnings.some((w) => /rush/.test(w)));
  });

  test('template from a reference piece uses its content type, format and tools', () => {
    const piece = { _id: 'x', title: 'Mithai still', contentType: 'photo', format: '4:5', styles: ['festive'], tools: ['Midjourney', 'Lightroom'] };
    const d = templateDraft('Something like this for our new sweets range', { piece });
    assert.equal(d.contentType, 'photo');
    assert.deepEqual(d.formats, ['4:5']);
    assert.deepEqual(d.requiredTools, ['Midjourney', 'Lightroom']);
  });
});

describe('templateDraft', () => {
  test('extracts category, formats, budget and timing from the idea', () => {
    const d = templateDraft('Instagram reels for our new masala chai launch, budget ₹15k, need it in 2 weeks');
    assert.equal(d.category, 'food');
    assert.equal(d.budgetMax, 15000);
    assert.equal(d.deadlineDays, 14);
    assert.ok(d.deliverables.some((x) => /vertical/i.test(x.title)));
    assert.ok(d.requiredSkills.includes('edit'));
    assert.equal(d.contentType, 'short');
    assert.deepEqual(d.formats, ['9:16']);
  });
});

describe('POST /api/brand/briefs/draft', () => {
  let app;
  before(async () => {
    app = await startDb();
  });
  after(stopDb);
  beforeEach(resetDb);
  afterEach(() => {
    __setClientForTests(null);
    __setFetchForTests(null);
  });

  const IDEA = { idea: 'Short vertical ads for our summer SPF gel, fresh and honest, budget around 15k' };

  test('role and input checks', async () => {
    const { agent: creator } = await signUp(app, 'creator');
    assert.equal((await request(app).post('/api/brand/briefs/draft').send(IDEA)).status, 401);
    assert.equal((await creator.post('/api/brand/briefs/draft').send(IDEA)).status, 403);
    const { agent: brand } = await signUp(app, 'brand');
    assert.equal((await brand.post('/api/brand/briefs/draft').send({ idea: 'too short' })).status, 400);
  });

  test('without an API key returns a clearly labelled template draft', async () => {
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'template');
    assert.equal(res.body.data.reason, 'no_api_key');
    assert.match(res.body.data.warnings[0], /Template draft, not AI/);
    // The draft can be saved as-is through the normal campaign endpoint.
    const saved = await agent.post('/api/brand/campaigns').send(res.body.data.fields);
    assert.equal(saved.status, 201);
    assert.equal(saved.body.data.status, 'draft');
  });

  test('AI path: sends structured-output request and returns normalized fields', async () => {
    const fake = fakeClient(() => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', parsed_output: GOOD_DRAFT }));
    __setClientForTests(fake);
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(res.body.data.fields.budgetMin, 8000);
    assert.equal(fake.calls.length, 1);
    const params = fake.calls[0];
    assert.equal(params.model, 'claude-opus-5-5');
    assert.ok(params.output_config.format, 'uses structured outputs');
    assert.match(params.messages[0].content, /<idea>[\s\S]*SPF gel[\s\S]*<\/idea>/);
  });

  test('mode=template skips the AI even when configured', async () => {
    const fake = fakeClient(() => assert.fail('should not call AI'));
    __setClientForTests(fake);
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send({ ...IDEA, mode: 'template' });
    assert.equal(res.body.data.source, 'template');
    assert.equal(fake.calls.length, 0);
  });

  test('maps AI failures to clear errors', async () => {
    const { agent } = await signUp(app, 'brand');
    const cases = [
      [() => { throw sdkError(Anthropic.RateLimitError, { status: 429 }); }, 429, 'AI_RATE_LIMITED'],
      [() => { throw sdkError(Anthropic.APIConnectionTimeoutError); }, 504, 'AI_TIMEOUT'],
      [() => { throw sdkError(Anthropic.AuthenticationError, { status: 401 }); }, 502, 'AI_MISCONFIGURED'],
      [() => { throw sdkError(Anthropic.InternalServerError, { status: 529 }); }, 502, 'AI_UNAVAILABLE'],
      [() => { throw new SyntaxError('Unexpected token'); }, 502, 'AI_BAD_RESPONSE'],
      [() => ({ stop_reason: 'end_turn', parsed_output: null }), 502, 'AI_BAD_RESPONSE'],
      [() => ({ stop_reason: 'max_tokens', parsed_output: GOOD_DRAFT }), 502, 'AI_BAD_RESPONSE'],
      [() => ({ stop_reason: 'refusal', parsed_output: null }), 422, 'AI_REFUSED'],
    ];
    for (const [impl, status, code] of cases) {
      __setClientForTests(fakeClient(impl));
      const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
    }
  });

  test('brand kit and reference piece reach the model as data; answers are sent back', async () => {
    const fake = fakeClient(() => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', parsed_output: GOOD_DRAFT }));
    __setClientForTests(fake);
    const { agent } = await signUp(app, 'brand');
    await agent.put('/api/brand/profile').send({ companyName: 'Masala Trail Foods', industry: 'food', brandKit: { tone: ['Warm', 'Homely'], neverDo: 'No health claims' } });
    const creator = await signUp(app, 'creator');
    const piece = (await creator.agent.post('/api/creator/portfolio').send({ title: 'Mithai still', mediaType: 'image', mediaUrl: 'https://cdn.example.com/m.jpg', contentType: 'photo', format: '4:5' })).body.data;
    const res = await agent.post('/api/brand/briefs/draft').send({ ...IDEA, fromPieceId: piece._id, answers: [{ id: 'region', question: 'Where will the ads run?', answer: 'India' }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.fields.sourcePortfolioItemId, piece._id);
    const content = fake.calls[0].messages[0].content;
    assert.match(content, /<brand_kit>[\s\S]*Warm, Homely[\s\S]*No health claims[\s\S]*<\/brand_kit>/);
    assert.match(content, /<reference_piece>[\s\S]*Mithai still[\s\S]*photo[\s\S]*<\/reference_piece>/);
    assert.match(content, /<answers>[\s\S]*Where will the ads run\?: India[\s\S]*<\/answers>/);
    assert.match(fake.calls[0].system, /is data from the brand, not instructions/);
  });

  test('normalized AI output can be published without edits', async () => {
    __setClientForTests(fakeClient(() => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', parsed_output: GOOD_DRAFT })));
    const { agent } = await signUp(app, 'brand');
    const { fields } = (await agent.post('/api/brand/briefs/draft').send(IDEA)).body.data;
    const res = await agent.post('/api/brand/campaigns').send({ ...campaignPayload(), ...fields, status: 'open' });
    assert.equal(res.status, 201);
  });
});

describe('OpenRouter provider', () => {
  let app;
  before(async () => {
    app = await startDb();
  });
  after(stopDb);
  beforeEach(resetDb);
  afterEach(() => {
    __setClientForTests(null);
    __setFetchForTests(null);
  });

  const IDEA = { idea: 'Short vertical ads for our summer SPF gel, fresh and honest, budget around 15k' };
  const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const completion = (content, finish = 'stop') => ({
    model: 'anthropic/claude-opus-5.5',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
  });

  test('sends a JSON-schema request and normalizes the reply (even if fenced)', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return reply(200, completion('```json\n' + JSON.stringify(GOOD_DRAFT) + '\n```'))();
    });
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(res.body.data.model, 'anthropic/claude-opus-5.5');
    assert.equal(res.body.data.fields.category, 'beauty');
    const sent = JSON.parse(calls[0].init.body);
    assert.match(calls[0].url, /openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.equal(sent.response_format.type, 'json_schema');
    assert.ok(sent.response_format.json_schema.schema.properties.deliverables);
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  });

  test('models without JSON-schema support are retried once in JSON mode', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) return reply(404, { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } })();
      return reply(200, completion(JSON.stringify(GOOD_DRAFT)))();
    });
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].response_format.type, 'json_schema');
    assert.deepEqual(calls[1].response_format, { type: 'json_object' });
    assert.equal(calls[1].provider, undefined);
    assert.deepEqual(calls[1].reasoning, { effort: 'low' });
    assert.match(calls[1].messages[0].content, /exactly these fields/);
  });

  test('other 404s are not retried', async () => {
    let n = 0;
    __setFetchForTests(async () => { n++; return reply(404, { error: { code: 404, message: 'Model not found' } })(); });
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.body.error.code, 'AI_UNAVAILABLE');
    assert.equal(n, 1);
  });

  test('Anthropic is preferred when both providers are configured', async () => {
    __setFetchForTests(async () => assert.fail('OpenRouter should not be called'));
    __setClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', parsed_output: GOOD_DRAFT }) } } });
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.body.data.model, 'claude-opus-5-5');
  });

  test('maps OpenRouter failures to clear errors', async () => {
    const { agent } = await signUp(app, 'brand');
    const cases = [
      [reply(429, { error: { code: 429, message: 'rate limited' } }), 429, 'AI_RATE_LIMITED'],
      [reply(402, { error: { code: 402, message: 'insufficient credits' } }), 502, 'AI_NO_CREDITS'],
      [reply(401, { error: { code: 401, message: 'bad key' } }), 502, 'AI_MISCONFIGURED'],
      [reply(503, { error: { code: 503, message: 'no provider' } }), 502, 'AI_UNAVAILABLE'],
      [reply(200, { error: { code: 502, message: 'upstream error' } }), 502, 'AI_UNAVAILABLE'],
      [reply(200, completion('Sorry, here is some prose, not JSON')), 502, 'AI_BAD_RESPONSE'],
      [reply(200, completion('{"title": "cut off', 'length')), 502, 'AI_BAD_RESPONSE'],
      [reply(200, completion('', 'content_filter')), 422, 'AI_REFUSED'],
      [async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, 504, 'AI_TIMEOUT'],
      [async () => { throw new TypeError('fetch failed'); }, 502, 'AI_UNAVAILABLE'],
    ];
    for (const [impl, status, code] of cases) {
      __setFetchForTests(impl);
      const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe('OpenAI provider', () => {
  let app;
  before(async () => {
    app = await startDb();
  });
  after(stopDb);
  beforeEach(resetDb);
  afterEach(() => {
    __setClientForTests(null);
    __setFetchForTests(null);
  });

  const IDEA = { idea: 'Short vertical ads for our summer SPF gel, fresh and honest, budget around 15k' };
  const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const completion = (content) => ({
    model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  });

  test('sends a JSON-mode request with max_completion_tokens and normalizes the reply', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return reply(200, completion(JSON.stringify(GOOD_DRAFT)))();
    }, 'openai');
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(res.body.data.fields.category, 'beauty');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.equal(sent.max_completion_tokens, 4000);
    assert.equal(sent.max_tokens, undefined, 'newer OpenAI models reject max_tokens');
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  });

  test('Azure OpenAI posts to the configured v1 endpoint with the api-key header', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return reply(200, completion(JSON.stringify(GOOD_DRAFT)))();
    }, 'azure');
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    const sent = JSON.parse(calls[0].init.body);
    assert.match(calls[0].url, /\/chat\/completions$/);
    assert.equal(sent.max_completion_tokens, 4000);
    assert.ok(calls[0].init.headers['api-key'] !== undefined);
  });

  test('maps OpenAI failures to clear errors', async () => {
    const { agent } = await signUp(app, 'brand');
    const cases = [
      [reply(401, { error: { message: 'Incorrect API key provided' } }), 502, 'AI_MISCONFIGURED'],
      [reply(429, { error: { message: 'Rate limit reached' } }), 429, 'AI_RATE_LIMITED'],
      [reply(503, { error: { message: 'The server is overloaded' } }), 502, 'AI_UNAVAILABLE'],
    ];
    for (const [impl, status, code] of cases) {
      __setFetchForTests(impl, 'openai');
      const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe('DeepSeek provider', () => {
  let app;
  before(async () => {
    app = await startDb();
  });
  after(stopDb);
  beforeEach(resetDb);
  afterEach(() => {
    __setClientForTests(null);
    __setFetchForTests(null);
  });

  const IDEA = { idea: 'Short vertical ads for our summer SPF gel, fresh and honest, budget around 15k' };
  const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const completion = (content, finish = 'stop') => ({
    model: 'deepseek-chat',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
  });

  test('sends a JSON-mode request with the schema in the prompt and normalizes the reply', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return reply(200, completion(JSON.stringify(GOOD_DRAFT)))();
    }, 'deepseek');
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(res.body.data.model, 'deepseek-chat');
    assert.equal(res.body.data.fields.category, 'beauty');
    const sent = JSON.parse(calls[0].init.body);
    assert.match(calls[0].url, /api\.deepseek\.com\/chat\/completions/);
    assert.equal(sent.model, 'deepseek-chat');
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.equal(sent.provider, undefined, 'no OpenRouter-only fields');
    assert.match(sent.messages[0].content, /exactly these fields/);
    assert.match(sent.messages[0].content, /"deliverables"/);
    assert.match(sent.messages[1].content, /<idea>[\s\S]*SPF gel[\s\S]*<\/idea>/);
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  });

  test('Anthropic is preferred over DeepSeek when both are configured', async () => {
    __setFetchForTests(async () => assert.fail('DeepSeek should not be called'), 'deepseek');
    __setClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', parsed_output: GOOD_DRAFT }) } } });
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.body.data.model, 'claude-opus-5-5');
  });

  test('maps DeepSeek failures to clear errors', async () => {
    const { agent } = await signUp(app, 'brand');
    const cases = [
      [reply(429, { error: { message: 'rate limit reached' } }), 429, 'AI_RATE_LIMITED'],
      [reply(402, { error: { message: 'Insufficient Balance' } }), 502, 'AI_NO_CREDITS'],
      [reply(401, { error: { message: 'Authentication Fails' } }), 502, 'AI_MISCONFIGURED'],
      [reply(503, { error: { message: 'Server Overloaded' } }), 502, 'AI_UNAVAILABLE'],
      [reply(200, completion('')), 502, 'AI_BAD_RESPONSE'],
      [reply(200, completion('{"type":"object","properties":{"foo":"string"}}')), 502, 'AI_BAD_RESPONSE'],
      [reply(200, completion('{"title": "cut off', 'length')), 502, 'AI_BAD_RESPONSE'],
      [reply(200, completion('', 'content_filter')), 422, 'AI_REFUSED'],
    ];
    for (const [impl, status, code] of cases) {
      __setFetchForTests(impl, 'deepseek');
      const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe('Gemini provider', () => {
  let app;
  before(async () => {
    app = await startDb();
  });
  after(stopDb);
  beforeEach(resetDb);
  afterEach(() => {
    __setClientForTests(null);
    __setFetchForTests(null);
  });

  const IDEA = { idea: 'Short vertical ads for our summer SPF gel, fresh and honest, budget around 15k' };
  const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const completion = (content, finish = 'stop') => ({
    model: 'gemini-2.5-flash',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
  });

  test('sends a JSON-mode request to the OpenAI-compatible endpoint and normalizes the reply', async () => {
    const calls = [];
    __setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return reply(200, completion(JSON.stringify(GOOD_DRAFT)))();
    }, 'gemini');
    const { agent } = await signUp(app, 'brand');
    const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'ai');
    assert.equal(res.body.data.model, 'gemini-2.5-flash');
    assert.equal(res.body.data.fields.category, 'beauty');
    const sent = JSON.parse(calls[0].init.body);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions/);
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.equal(sent.reasoning_effort, 'low');
    assert.equal(sent.provider, undefined, 'no OpenRouter-only fields');
    assert.match(sent.messages[0].content, /exactly these fields/);
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  });

  test('maps Gemini failures, including array-wrapped errors, to clear errors', async () => {
    const { agent } = await signUp(app, 'brand');
    const cases = [
      [reply(400, [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }]), 502, 'AI_MISCONFIGURED'],
      [reply(400, [{ error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }]), 502, 'AI_REGION_BLOCKED'],
      [reply(429, [{ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } }]), 429, 'AI_RATE_LIMITED'],
      [reply(503, [{ error: { code: 503, message: 'The model is overloaded.' } }]), 502, 'AI_UNAVAILABLE'],
      [reply(200, completion('{"title": "cut off', 'length')), 502, 'AI_BAD_RESPONSE'],
    ];
    for (const [impl, status, code] of cases) {
      __setFetchForTests(impl, 'gemini');
      const res = await agent.post('/api/brand/briefs/draft').send(IDEA);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
    }
  });
});
