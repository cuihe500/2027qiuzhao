import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApp } from './app.js'
import { SESSION_MAX_AGE } from './database.js'

const credentials = { username: 'XiaoLv', password: 'XiaoLvBaoBei' }

function progress(stage = '已投递') {
  return { stage, dates: { [stage]: '2026-09-28' }, updatedAt: '2026-09-28', endStage: '', endDate: '' }
}

async function fixture(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'qiuzhao-api-'))
  const databasePath = join(directory, 'progress.sqlite')
  const dataPath = join(directory, 'data.json')
  const distPath = join(directory, 'dist')
  const warnings = []
  await mkdir(distPath)
  await writeFile(join(distPath, 'index.html'), '<!doctype html><title>秋招</title><div id="app"></div>')
  await writeFile(join(distPath, 'asset.js'), 'window.applicationLoaded = true')
  await writeFile(dataPath, JSON.stringify({ rev: 'same-revision', data: [{ company: '公司一' }] }))
  options.seedDatabase?.(databasePath)
  let application
  let server
  let address

  async function start() {
    application = createApp({ databasePath, dataPath, distPath, now: options.now, logger: { error() {}, warn: (message) => warnings.push(message) } })
    server = await new Promise((resolveServer, reject) => {
      const instance = application.app.listen(0, '127.0.0.1', () => resolveServer(instance))
      instance.once('error', reject)
    })
    address = `http://127.0.0.1:${server.address().port}`
  }

  async function stop() {
    if (!server) return
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    application.close()
    server = null
  }

  context.after(async () => {
    await stop()
    await rm(directory, { recursive: true, force: true })
  })
  await start()

  async function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
    const response = await fetch(`${address}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
    const content = await response.text()
    return {
      status: response.status,
      headers: response.headers,
      body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content) : content,
    }
  }

  async function login() {
    const response = await request('/api/auth/login', { method: 'POST', body: credentials })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { user: { username: 'XiaoLv' } })
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    assert.match(cookie, /^qiuzhao_session=[A-Za-z0-9_-]{43}$/)
    return cookie
  }

  return {
    request, login, databasePath, dataPath, warnings,
    get address() { return address },
    async restart() { await stop(); await start() },
  }
}

function seedLegacy(databasePath, workspaces) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      CREATE TABLE workspaces (key_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE progress (workspace_hash TEXT NOT NULL REFERENCES workspaces(key_hash), company TEXT NOT NULL,
        record TEXT, version INTEGER NOT NULL, PRIMARY KEY (workspace_hash, company));
    `)
    for (const workspace of workspaces) {
      database.prepare('INSERT INTO workspaces (key_hash, created_at) VALUES (?, ?)').run(workspace.hash, workspace.createdAt)
      for (const [company, entry] of Object.entries(workspace.records)) {
        database.prepare('INSERT INTO progress VALUES (?, ?, ?, ?)').run(workspace.hash, company, entry.record === null ? null : JSON.stringify(entry.record), entry.version)
      }
    }
  } finally {
    database.close()
  }
}

test('fixed credentials create separate hashed sessions with shared single-user progress', async (context) => {
  const service = await fixture(context)
  assert.equal((await service.request('/api/auth/session')).status, 401)
  assert.equal((await service.request('/api/sync')).status, 401)
  assert.equal((await service.request('/api/sync', { method: 'PATCH', body: { changes: [] } })).status, 401)
  const wrongPassword = await service.request('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'incorrect' } })
  const wrongUsername = await service.request('/api/auth/login', { method: 'POST', body: { ...credentials, username: 'someone-else' } })
  assert.equal(wrongPassword.status, 401)
  assert.deepEqual(wrongUsername.body, wrongPassword.body)
  const firstCookie = await service.login()
  const secondCookie = await service.login()
  assert.notEqual(firstCookie, secondCookie)
  assert.deepEqual((await service.request('/api/auth/session', { cookie: secondCookie })).body, { user: { username: 'XiaoLv' } })
  const saved = await service.request('/api/sync', {
    method: 'PATCH', cookie: firstCookie, body: { changes: [{ company: '公司一', record: progress(), baseVersion: 0 }] },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await service.request('/api/sync', { cookie: secondCookie })).body.records['公司一'], { record: progress(), version: 1 })
  const database = new DatabaseSync(service.databasePath, { readOnly: true })
  try {
    const token = firstCookie.split('=')[1]
    const hashes = database.prepare('SELECT token_hash FROM sessions').all().map((row) => row.token_hash)
    assert.ok(hashes.includes(createHash('sha256').update(token).digest('hex')))
    assert.ok(hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)))
    assert.ok(!hashes.includes(token))
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 1)
  } finally {
    database.close()
  }
})

test('session cookies use HttpOnly, SameSite and HTTPS security attributes', async (context) => {
  const service = await fixture(context)
  const login = (headers = {}) => service.request('/api/auth/login', { method: 'POST', body: credentials, headers })
  const ordinary = await login()
  const ordinaryCookie = ordinary.headers.get('set-cookie')
  assert.match(ordinaryCookie, /; HttpOnly/)
  assert.match(ordinaryCookie, /; SameSite=Lax/)
  assert.match(ordinaryCookie, /; Path=\//)
  assert.match(ordinaryCookie, /; Max-Age=2592000/)
  assert.doesNotMatch(ordinaryCookie, /; Secure/)
  assert.equal(ordinary.headers.get('cache-control'), 'no-store')
  assert.match((await login({ 'X-Forwarded-Proto': 'https' })).headers.get('set-cookie'), /; Secure/)
  assert.match((await login({ 'X-Forwarded-Proto': 'https, http' })).headers.get('set-cookie'), /; Secure/)
})

test('sessions and progress persist across restart and expire after thirty days', async (context) => {
  let currentTime = Date.now()
  const service = await fixture(context, { now: () => currentTime })
  const cookie = await service.login()
  await service.request('/api/sync', {
    method: 'PATCH', cookie, body: { changes: [{ company: '持久化公司', record: progress('笔试'), baseVersion: 0 }] },
  })
  await service.restart()
  const loaded = await service.request('/api/sync', { cookie })
  assert.equal(loaded.status, 200)
  assert.deepEqual(loaded.body.records['持久化公司'], { record: progress('笔试'), version: 1 })
  currentTime += SESSION_MAX_AGE
  assert.equal((await service.request('/api/auth/session', { cookie })).status, 401)
  assert.equal((await service.request('/api/sync', { cookie })).status, 401)
  const newCookie = await service.login()
  assert.deepEqual((await service.request('/api/sync', { cookie: newCookie })).body.records['持久化公司'], loaded.body.records['持久化公司'])
})

test('logout revokes only the current device and removes its cookie', async (context) => {
  const service = await fixture(context)
  const cookie = await service.login()
  const otherCookie = await service.login()
  const loggedOut = await service.request('/api/auth/logout', { method: 'POST', cookie, body: {} })
  assert.equal(loggedOut.status, 200)
  assert.deepEqual(loggedOut.body, { ok: true })
  assert.match(loggedOut.headers.get('set-cookie'), /^qiuzhao_session=;/)
  assert.match(loggedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/)
  assert.equal((await service.request('/api/sync', { cookie })).status, 401)
  assert.equal((await service.request('/api/auth/session', { cookie: otherCookie })).status, 200)
  assert.equal((await service.request('/api/auth/logout', { method: 'POST', body: {} })).status, 200)
})

test('login rate limiting blocks repeated failures and expires without sleeping', async (context) => {
  let currentTime = Date.now()
  const service = await fixture(context, { now: () => currentTime })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await service.request('/api/auth/login', {
      method: 'POST', body: { ...credentials, password: 'wrong' }, headers: { 'X-Forwarded-For': `192.0.2.${attempt}` },
    })).status, 401)
  }
  const blocked = await service.request('/api/auth/login', { method: 'POST', body: credentials })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('retry-after'), '60')
  currentTime += 60_001
  assert.ok(await service.login())
})

test('old bearer codes and workspace creation no longer authorize access', async (context) => {
  const service = await fixture(context)
  assert.equal((await service.request('/api/sync', { headers: { Authorization: `Bearer ${'A'.repeat(43)}` } })).status, 401)
  assert.equal((await service.request('/api/sync/workspaces', { method: 'POST', body: {} })).status, 404)
  const cookie = await service.login()
  assert.equal((await service.request('/api/sync/workspaces', { method: 'POST', cookie, body: {} })).status, 404)
})

test('a lone legacy workspace is adopted without changing progress or tombstones', async (context) => {
  const oldKey = 'A'.repeat(43)
  const oldHash = createHash('sha256').update(oldKey).digest('hex')
  const records = { 历史公司: { record: progress('面试'), version: 7 }, 删除公司: { record: null, version: 3 } }
  const service = await fixture(context, {
    seedDatabase: (path) => seedLegacy(path, [{ hash: oldHash, createdAt: '2026-09-01', records }]),
  })
  const cookie = await service.login()
  assert.deepEqual((await service.request('/api/sync', { cookie })).body.records, records)
  assert.equal((await service.request('/api/sync', { headers: { Authorization: `Bearer ${oldKey}` } })).status, 401)
  const database = new DatabaseSync(service.databasePath, { readOnly: true })
  try {
    assert.equal(database.prepare("SELECT value FROM settings WHERE name = 'single_user_workspace'").get().value, oldHash)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 1)
  } finally {
    database.close()
  }
})

test('legacy migration chooses the most populated workspace once and retains other data', async (context) => {
  const service = await fixture(context, {
    seedDatabase: (path) => seedLegacy(path, [
      { hash: 'empty', createdAt: '2026-01-01', records: {} },
      { hash: 'selected', createdAt: '2026-02-01', records: { 公司一: { record: progress(), version: 1 }, 公司二: { record: null, version: 2 } } },
      { hash: 'retained', createdAt: '2026-03-01', records: { 公司三: { record: progress('面试'), version: 4 } } },
    ]),
  })
  const cookie = await service.login()
  assert.deepEqual(Object.keys((await service.request('/api/sync', { cookie })).body.records), ['公司一', '公司二'])
  assert.match(service.warnings[0], /其余 2 个空间仍完整保留/)
  const database = new DatabaseSync(service.databasePath)
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 3)
    assert.equal(database.prepare("SELECT version FROM progress WHERE workspace_hash = 'retained'").get().version, 4)
    for (const company of ['新公司一', '新公司二', '新公司三']) {
      database.prepare("INSERT INTO progress VALUES ('retained', ?, ?, 1)").run(company, JSON.stringify(progress()))
    }
  } finally {
    database.close()
  }
  await service.restart()
  assert.deepEqual(Object.keys((await service.request('/api/sync', { cookie })).body.records), ['公司一', '公司二'])
})

test('compare-and-swap accepts unrelated records, detects conflicts and allows equivalent retries', async (context) => {
  const service = await fixture(context)
  const cookie = await service.login()
  const patch = (changes) => service.request('/api/sync', { method: 'PATCH', cookie, body: { changes } })
  await patch([{ company: '公司一', record: progress(), baseVersion: 0 }])
  const conflicted = await patch([
    { company: '公司一', record: progress('笔试'), baseVersion: 0 },
    { company: '公司二', record: progress('面试'), baseVersion: 0 },
  ])
  assert.deepEqual(conflicted.body.conflicts, ['公司一'])
  assert.deepEqual(conflicted.body.records['公司一'], { record: progress(), version: 1 })
  assert.deepEqual(conflicted.body.records['公司二'], { record: progress('面试'), version: 1 })
  const retried = await patch([{ company: '公司一', record: progress(), baseVersion: 0 }])
  assert.deepEqual(retried.body.conflicts, [])
  assert.equal(retried.body.records['公司一'].version, 1)
  assert.equal((await patch([{ company: '公司一', record: progress('笔试'), baseVersion: 1 }])).body.records['公司一'].version, 2)
})

test('deletion tombstones persist and stale devices cannot resurrect records', async (context) => {
  const service = await fixture(context)
  const cookie = await service.login()
  const patch = (record, baseVersion) => service.request('/api/sync', { method: 'PATCH', cookie, body: { changes: [{ company: '公司一', record, baseVersion }] } })
  await patch(progress(), 0)
  assert.deepEqual((await patch(null, 1)).body.records['公司一'], { record: null, version: 2 })
  const retry = await patch(null, 1)
  assert.equal(retry.body.records['公司一'].version, 2)
  assert.deepEqual(retry.body.conflicts, [])
  await service.restart()
  const stale = await patch(progress('面试'), 1)
  assert.deepEqual(stale.body.conflicts, ['公司一'])
  assert.deepEqual(stale.body.records['公司一'], { record: null, version: 2 })
  assert.deepEqual((await patch(progress('面试'), 2)).body.records['公司一'], { record: progress('面试'), version: 3 })
})

test('simultaneous edits from two logged-in devices produce one winner', async (context) => {
  const service = await fixture(context)
  const firstCookie = await service.login()
  const secondCookie = await service.login()
  const results = await Promise.all([[firstCookie, '笔试'], [secondCookie, '面试']].map(([cookie, stage]) => service.request('/api/sync', {
    method: 'PATCH', cookie, body: { changes: [{ company: '竞争公司', record: progress(stage), baseVersion: 0 }] },
  })))
  assert.equal(results.filter((result) => result.body.conflicts.length === 0).length, 1)
  assert.equal(results.filter((result) => result.body.conflicts.includes('竞争公司')).length, 1)
})

test('public data.json always reads the latest file even with an unchanged revision', async (context) => {
  const service = await fixture(context)
  const first = await service.request('/data.json')
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal(first.headers.get('etag'), null)
  assert.equal(first.body.data[0].company, '公司一')
  await writeFile(service.dataPath, JSON.stringify({ rev: 'same-revision', data: [{ company: '最新公司' }] }))
  const second = await service.request('/data.json', { headers: { 'If-None-Match': '*' } })
  assert.equal(second.status, 200)
  assert.equal(second.body.data[0].company, '最新公司')
  await writeFile(service.dataPath, '{invalid json')
  const unavailable = await service.request('/data.json')
  assert.equal(unavailable.status, 503)
  assert.ok(!JSON.stringify(unavailable.body).includes(service.dataPath))
})

test('invalid changes reject the full batch while blank stages retain historical dates', async (context) => {
  const service = await fixture(context)
  const cookie = await service.login()
  const invalidChanges = [
    { company: '', record: progress(), baseVersion: 0 },
    { company: '公司'.repeat(151), record: progress(), baseVersion: 0 },
    { company: '公司\u0000', record: progress(), baseVersion: 0 },
    { company: '公司一', record: progress(), baseVersion: -1 },
    { company: '公司一', record: progress(), baseVersion: 1.5 },
    { company: '公司一', record: { ...progress(), stage: '非法阶段' }, baseVersion: 0 },
    { company: '公司一', record: { ...progress(), dates: { 已投递: '2026-02-30' } }, baseVersion: 0 },
    { company: '公司一', record: { ...progress(), dates: { 未知: '2026-09-28' } }, baseVersion: 0 },
    { company: '公司一', record: { ...progress(), endStage: '流程结束' }, baseVersion: 0 },
    { company: '公司一', record: { ...progress(), endDate: '2026-09-28' }, baseVersion: 0 },
    { company: '公司一', record: { stage: '已投递' }, baseVersion: 0 },
  ]
  for (const change of invalidChanges) {
    assert.equal((await service.request('/api/sync', {
      method: 'PATCH', cookie, body: { changes: [{ company: '不能部分写入', record: progress(), baseVersion: 0 }, change] },
    })).status, 400)
  }
  const duplicate = { company: '公司一', record: progress(), baseVersion: 0 }
  assert.equal((await service.request('/api/sync', { method: 'PATCH', cookie, body: { changes: [duplicate, duplicate] } })).status, 400)
  assert.deepEqual((await service.request('/api/sync', { cookie })).body.records, {})
  const blankRecord = { ...progress(), stage: '' }
  const valid = await service.request('/api/sync', {
    method: 'PATCH', cookie, body: { changes: [{ company: '__proto__', record: blankRecord, baseVersion: 0 }] },
  })
  assert.deepEqual(valid.body.records.__proto__, { record: blankRecord, version: 1 })
})

test('login, logout and sync enforce same-origin JSON writes and body limits', async (context) => {
  const service = await fixture(context)
  const cookie = await service.login()
  for (const [path, method, body] of [['/api/auth/login', 'POST', credentials], ['/api/auth/logout', 'POST', {}], ['/api/sync', 'PATCH', { changes: [] }]]) {
    const crossOrigin = await service.request(path, { method, cookie, body, headers: { Origin: 'https://another-site.example' } })
    assert.equal(crossOrigin.status, 403)
    assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null)
  }
  assert.equal((await service.request('/api/auth/login', { method: 'POST', body: credentials, headers: { Origin: service.address } })).status, 200)
  assert.equal((await service.request('/api/auth/logout', { method: 'POST', cookie, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await service.request('/api/auth/login', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await service.request('/api/auth/login', { method: 'POST', body: {} })).status, 400)
  assert.equal((await service.request('/api/auth/logout', { method: 'POST', cookie, body: { extra: true } })).status, 400)
  assert.equal((await service.request('/api/sync', { method: 'PATCH', cookie, body: '{broken' })).status, 400)
  assert.equal((await service.request('/api/sync', { method: 'PATCH', cookie, body: { changes: [], oversized: 'a'.repeat(2 * 1024 * 1024) } })).status, 413)
})

test('production serves built assets and SPA routes without exposing server credentials', async (context) => {
  const service = await fixture(context)
  const page = await service.request('/nested/route')
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('<div id="app">'))
  assert.equal(page.headers.get('cache-control'), 'no-cache')
  assert.equal((await service.request('/asset.js')).body, 'window.applicationLoaded = true')
  assert.equal((await service.request('/api/missing')).status, 404)
  const source = await service.request('/server/app.js')
  assert.ok(!source.body.includes('openDatabase'))
  assert.ok(!source.body.includes(credentials.password))
})
