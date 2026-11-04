// Run with node --test tests/ai-fallback.test.cjs. No credentials or network calls.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { NextResponse } = require('next/server')

function load(file, mocks, env = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    process: { env }, console: { warn() {} }, Date, URL,
  }, { filename: file })
  return exports
}
function sdk(result, error) {
  const calls = [], options = []
  class Client {
    static APIError = class extends Error {}
    constructor(opts) {
      options.push(opts)
      this.messages = { create: async input => {
        calls.push(input)
        if (error) throw error
        return result
      } }
    }
  }
  return { Client, calls, options }
}
const submission = { title: 'Test', category: 'events', subcategory: 'social-party', address: 'Davis', external_link: 'https://example.com' }
const verdict = { safety_level: 'safe', confidence: 0, risk_score: 0, category_match: true, reason: 'No concerns' }
const message = (data, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(data) }] })
function moderation(provider, env = { DEEPSEEK_API_KEY: 'test-only' }) {
  return load('lib/moderation.ts', { '@anthropic-ai/sdk': provider.Client }, env).moderateSubmission
}
function assertUnavailable(result) {
  assert.equal(result.status, 'unavailable')
  for (const key of ['safety_level', 'confidence', 'risk_score', 'category_match']) assert.equal(result[key], null)
  assert.equal(result.auto_flag, false)
  assert.match(result.reason, /manual review/)
}
test('missing key and kill switch never call a provider', async () => {
  for (const env of [{}, { DEEPSEEK_API_KEY: 'test-only', AI_FEATURES_ENABLED: 'false' }]) {
    const provider = sdk(message(verdict))
    assertUnavailable(await moderation(provider, env)(submission))
    assert.equal(provider.calls.length, 0)
    assert.equal(provider.options.length, 0)
  }
})
test('provider errors including credit exhaustion and timeout require manual review', async () => {
  for (const status of [400, 401, 403, 429, 500, undefined]) {
    const error = Object.assign(new Error('private provider payload'), { status })
    const provider = sdk(null, error)
    assertUnavailable(await moderation(provider)(submission))
    assert.equal(provider.calls.length, 1)
    assert.equal(provider.options[0].timeout, 8000)
    assert.equal(provider.options[0].maxRetries, 0)
    assert.equal(provider.options[0].baseURL, 'https://api.deepseek.com/anthropic')
    assert.equal(provider.options[0].authToken, null)
    assert.equal(provider.calls[0].model, 'deepseek-flash')
    assert.equal(provider.calls[0].thinking.type, 'disabled')
  }
})
test('malformed, incomplete, inconsistent and truncated verdicts are unavailable', async () => {
  for (const data of [{}, { ...verdict, confidence: '1' }, { ...verdict, risk_score: -1 },
    { ...verdict, category_match: null }, { ...verdict, safety_level: 'high' }, null]) {
    assertUnavailable(await moderation(sdk(message(data)))(submission))
  }
  assertUnavailable(await moderation(sdk(message(verdict, 'max_tokens')))(submission))
  assertUnavailable(await moderation(sdk({ stop_reason: 'end_turn', content: [] }))(submission))
})
test('valid zero values stay zero; high-risk verdict flags', async () => {
  const safe = await moderation(sdk(message(verdict)))(submission)
  assert.equal(safe.status, 'completed')
  assert.equal(safe.risk_score, 0)
  assert.equal(safe.confidence, 0)
  const high = await moderation(sdk(message({ ...verdict, safety_level: 'high', risk_score: 80 })))(submission)
  assert.equal(high.auto_flag, true)
})
function flyer(provider, { user = { id: 'test' }, env = { DEEPSEEK_API_KEY: 'test-only' }, limited = false, sizeError = null } = {}) {
  return load('app/api/analyze-flyer/route.ts', {
    'next/server': { NextResponse }, '@anthropic-ai/sdk': provider.Client,
    '@/lib/auth-helper': { getSessionUser: async () => user },
    '@/lib/rate-limit': {
      limiters: { analyzeFlyer: { check: () => ({ limited }) } }, getRequestKey: () => 'test',
      rateLimitResponse: () => NextResponse.json({}, { status: 429 }), guardBodySize: () => sizeError,
    },
  }, env).POST
}
const request = body => ({ json: async () => body })
test('flyer route initializes without credentials and returns actionable 503', async () => {
  const provider = sdk(null)
  const response = await flyer(provider, { env: {} })(request({ imageBase64: 'test' }))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'AI_UNAVAILABLE')
  assert.equal(provider.options.length, 0)
})
test('flyer auth, size and rate guards remain effective', async () => {
  const provider = sdk(null)
  assert.equal((await flyer(provider, { user: null })(request({}))).status, 401)
  assert.equal((await flyer(provider, { limited: true })(request({}))).status, 429)
  assert.equal((await flyer(provider, { sizeError: NextResponse.json({}, { status: 413 }) })(request({}))).status, 413)
  assert.equal(provider.calls.length, 0)
})
test('flyer provider errors and invalid output return 503 without private error content', async () => {
  for (const provider of [sdk(null, new Error('private provider payload')), sdk(message({})), sdk({ content: [], stop_reason: 'end_turn' })]) {
    const response = await flyer(provider)(request({ imageBase64: 'test' }))
    assert.equal(response.status, 503)
    assert.doesNotMatch(JSON.stringify(await response.json()), /private provider payload/)
    assert.equal(provider.options[0].maxRetries, 0)
    assert.equal(provider.options[0].baseURL, 'https://api.deepseek.com/anthropic')
    assert.equal(provider.options[0].authToken, null)
    assert.equal(provider.calls[0].model, 'deepseek-flash')
    assert.equal(provider.calls[0].thinking.type, 'disabled')
    assert.equal(provider.options[0].timeout, 8000)
  }
})
test('flyer invalid input returns 400; valid output retains success response shape', async () => {
  const data = { title: 'Event', description: 'Test', category: 'events', subcategory: 'social-party', tags: [], start_time: null, end_time: null, location_name: null, address: null }
  const provider = sdk(message(data))
  assert.equal((await flyer(provider)(request({ imageUrl: 'http://localhost' }))).status, 400)
  const response = await flyer(provider)(request({ imageBase64: 'test' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), data)
})
test('manual submission persists as pending with null risk during provider outage', async () => {
  let inserted
  const supabase = { from: table => ({ insert: data => {
    if (table === 'items') inserted = data
    return { select: () => ({ single: async () => ({ data: { id: 'test', ...data }, error: null }) }) }
  } }) }
  const moderateSubmission = moderation(sdk(null, new Error('out of credits')))
  const { POST } = load('app/api/submit/route.ts', {
    'next/server': { NextResponse }, '@/lib/supabase-server': { getServerSupabase: () => supabase },
    '@/lib/moderation': { moderateSubmission }, '@supabase/ssr': { createServerClient: () => { throw new Error('anonymous') } },
  }, { NODE_ENV: 'development' })
  const response = await POST({ ...request(submission), headers: new Headers(), cookies: { getAll: () => [] } })
  assert.equal(response.status, 201)
  assert.equal(inserted.status, 'pending')
  assert.equal(inserted.risk_score, null)
  assert.match(inserted.moderation_reason, /unavailable/)
})
test('legacy Anthropic key alone cannot enable DeepSeek or leak to its API', async () => {
  const provider = sdk(message(verdict))
  assertUnavailable(await moderation(provider, { ANTHROPIC_API_KEY: 'old-provider-only' })(submission))
  assert.equal(provider.options.length, 0)
  assert.equal((await flyer(provider, { env: { ANTHROPIC_API_KEY: 'old-provider-only' } })(request({}))).status, 503)
})
test('real SDK sends text and images only to DeepSeek with its explicit credential', async () => {
  const RealClient = require('@anthropic-ai/sdk').default
  const captured = []
  const data = { title: 'Event', description: 'Test', category: 'events', subcategory: 'social-party', tags: [], start_time: null, end_time: null, location_name: null, address: null }
  class DeepSeekClient extends RealClient {
    constructor(opts) {
      super({ ...opts, fetch: async (url, init) => {
        captured.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
        const result = captured.length === 1 ? verdict : data
        return new Response(JSON.stringify({ id: 'mock', type: 'message', role: 'assistant', model: 'deepseek-flash', ...message(result), usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
      } })
    }
  }
  const provider = { Client: DeepSeekClient }
  assert.equal((await moderation(provider)(submission)).status, 'completed')
  assert.equal((await flyer(provider)(request({ imageBase64: 'test', mediaType: 'image/png' }))).status, 200)
  assert.equal((await flyer(provider)(request({ imageUrl: 'https://example.com/flyer.png' }))).status, 200)
  for (const call of captured) {
    assert.equal(call.url, 'https://api.deepseek.com/anthropic/v1/messages')
    assert.equal(call.headers.get('x-api-key'), 'test-only')
    assert.equal(call.headers.has('authorization'), false)
    assert.equal(call.body.model, 'deepseek-flash')
    assert.equal(call.body.thinking.type, 'disabled')
  }
  assert.equal(captured[1].body.messages[0].content[0].source.type, 'base64')
  assert.equal(captured[1].body.messages[0].content[0].source.media_type, 'image/png')
  assert.equal(captured[2].body.messages[0].content[0].source.url, 'https://example.com/flyer.png')
})
