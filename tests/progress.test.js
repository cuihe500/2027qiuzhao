import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgressStore, ACCOUNT_PROGRESS_KEY } from '../src/composables/useProgress.js'
import { emptyRecord, normalizeRecord, normalizeRecords, recordsEqual, todayStr } from '../src/lib/progress.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    dump: () => JSON.stringify(Object.fromEntries(values)),
  }
}

function record(stage, date = '2026-09-28') {
  return { ...emptyRecord(), stage, dates: { [stage]: date }, updatedAt: date }
}

function syncServer() {
  let heldRequest
  const server = {
    records: Object.create(null),
    calls: [],
    session: false,
    holdNextSync(method = 'PATCH') {
      let resume
      const gate = new Promise((resolve) => { resume = resolve })
      let receive
      const received = new Promise((resolve) => { receive = resolve })
      heldRequest = { gate, receive, method }
      return { received, resume }
    },
    async fetch(path, options) {
      server.calls.push({ path, ...options })
      const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload })
      if (path === '/api/auth/login') {
        const credentials = JSON.parse(options.body)
        if (credentials.username !== 'XiaoLv' || credentials.password !== 'XiaoLvBaoBei') return response({ error: 'Invalid credentials' }, 401)
        server.session = true
        return response({ user: { username: 'XiaoLv' } })
      }
      if (path === '/api/auth/logout') {
        server.session = false
        return response({ ok: true })
      }
      if (!server.session) return response({ error: 'Unauthorized' }, 401)
      if (path === '/api/auth/session') return response({ user: { username: 'XiaoLv' } })
      assert.equal(path, '/api/sync')
      const conflicts = []
      if (options.method === 'PATCH') {
        for (const change of JSON.parse(options.body).changes) {
          const current = server.records[change.company] || { record: null, version: 0 }
          if (recordsEqual(current.record, change.record)) continue
          if (change.baseVersion !== current.version) conflicts.push(change.company)
          else server.records[change.company] = { record: normalizeRecord(change.record), version: current.version + 1 }
        }
      }
      const payload = JSON.parse(JSON.stringify({ records: server.records, conflicts }))
      if (options.method === heldRequest?.method) {
        const held = heldRequest
        heldRequest = null
        held.receive()
        await held.gate
      }
      return response(payload)
    },
  }
  return server
}

function setup(context, server = syncServer(), storage = memoryStorage(), extra = {}) {
  const store = createProgressStore({ storage, fetch: server.fetch, ...extra })
  context.after(store.stop)
  return { store, server, storage }
}

async function signIn(store) {
  assert.equal(await store.login('XiaoLv', 'XiaoLvBaoBei'), true)
}

test('normalization retains cleared stage history and rejects invalid names and objects', () => {
  assert.deepEqual(normalizeRecord({ stage: '', dates: { 面试: '2026-09-28', 笔试: '2026-02-30' } }), {
    ...emptyRecord(), dates: { 面试: '2026-09-28' },
  })
  assert.equal(normalizeRecord({ unrelated: true }), null)
  assert.equal(normalizeRecord('已投递').dates.已投递, todayStr())
  assert.deepEqual(Object.keys(normalizeRecords({ ['a'.repeat(301)]: record('笔试'), ['换\n行']: record('面试'), 正常公司: record('已投递') })), ['正常公司'])
})

test('logged-out state hides cached progress and cannot be edited', async (context) => {
  const storage = memoryStorage({ [ACCOUNT_PROGRESS_KEY]: JSON.stringify({ records: { 公司: record('笔试') } }) })
  const { store } = setup(context, undefined, storage)
  assert.equal(store.authLoading.value, true)
  assert.equal(store.authenticated.value, false)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.equal(store.setRecord('公司', record('面试')), false)
  assert.equal(await store.start(), false)
  assert.equal(store.authLoading.value, false)
  assert.equal(store.status.value, 'signed-out')
})

test('login validates credentials and never persists a password or bearer token', async (context) => {
  const { store, storage, server } = setup(context)
  assert.equal(await store.login('XiaoLv', 'wrong'), false)
  assert.match(store.authError.value, /用户名或密码错误/)
  assert.equal(store.user.value, null)
  await signIn(store)
  assert.equal(store.user.value.username, 'XiaoLv')
  assert.equal(storage.dump().includes('XiaoLvBaoBei'), false)
  assert.ok(server.calls.every((call) => call.credentials === 'same-origin' && !call.headers.Authorization))
  assert.equal(store.createWorkspace, undefined)
  assert.equal(store.syncKey, undefined)
})

test('an existing cookie resumes the same account and fetches current records', async (context) => {
  const { store, server, storage } = setup(context)
  await signIn(store)
  store.setRecord('公司', record('面试'))
  await store.syncNow()
  store.stop()
  const next = setup(context, server, storage).store
  assert.equal(await next.start(), true)
  assert.equal(next.user.value.username, 'XiaoLv')
  assert.equal(next.progress.value.公司.stage, '面试')
})

test('a network failure during session validation never unlocks cached records', async (context) => {
  const storage = memoryStorage({ [ACCOUNT_PROGRESS_KEY]: JSON.stringify({ records: { 公司: record('笔试') } }) })
  const { store } = setup(context, undefined, storage, { fetch: async () => { throw new TypeError('offline') } })
  assert.equal(await store.start(), false)
  assert.equal(store.authenticated.value, false)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.ok(store.authError.value)
})

test('old local and active workspace records migrate once with account versions reset', async (context) => {
  const storage = memoryStorage({
    qiuzhao2027_progress_v2: JSON.stringify({ 本地: record('已投递'), 已删除: record('笔试') }),
    qiuzhao2027_sync_active_v1: 'old-space',
    'qiuzhao2027_sync_workspace_v1:old-space': JSON.stringify({
      records: { 旧云端: { ...record('面试'), stage: '' } },
      versions: { 旧云端: 9, 已删除: 4 },
      pending: { 旧云端: { record: { ...record('面试'), stage: '' }, baseVersion: 9 } },
    }),
  })
  const { store, server } = setup(context, undefined, storage)
  await signIn(store)
  assert.equal(server.records.本地.record.stage, '已投递')
  assert.equal(server.records.旧云端.version, 1)
  assert.equal(store.progress.value.旧云端.dates.面试, '2026-09-28')
  assert.equal(store.progress.value.已删除, undefined)
  store.setRecord('本地', null)
  await store.syncNow()
  await store.logout()
  await signIn(store)
  assert.equal(store.progress.value.本地, undefined)
  assert.equal(server.records.本地.record, null)
})

test('existing server records and tombstones prevent implicit legacy imports', async (context) => {
  const storage = memoryStorage({ qiuzhao2027_progress_v1: JSON.stringify({ 本地: '笔试', 已删除: '已投递' }) })
  const { store, server } = setup(context, undefined, storage)
  server.records.已删除 = { record: null, version: 1 }
  await signIn(store)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.equal(store.importLocalRecords(), 2)
  await store.syncNow()
  assert.equal(server.records.本地.record.stage, '笔试')
})

test('401 hides progress but preserves pending edits through a new login', async (context) => {
  const { store, server, storage } = setup(context)
  await signIn(store)
  store.setRecord('公司', record('AI面试'))
  server.session = false
  assert.equal(await store.syncNow(), false)
  assert.equal(store.user.value, null)
  assert.equal(store.pendingCount.value, 1)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.match(store.authError.value, /登录已失效/)
  assert.equal(JSON.parse(storage.getItem(ACCOUNT_PROGRESS_KEY)).pending.公司.record.stage, 'AI面试')
  await signIn(store)
  assert.equal(server.records.公司.record.stage, 'AI面试')
  assert.equal(store.pendingCount.value, 0)
})

test('logout retains the queue and prevents in-flight responses repopulating the UI', async (context) => {
  const { store, server } = setup(context)
  await signIn(store)
  const held = server.holdNextSync()
  store.setRecord('公司', record('面试'))
  const syncing = store.syncNow()
  await held.received
  const loggingOut = store.logout()
  assert.equal(store.user.value, null)
  assert.deepEqual(Object.keys(store.progress.value), [])
  held.resume()
  await syncing
  assert.equal(await loggingOut, true)
  assert.equal(server.session, false)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.equal(store.pendingCount.value, 1)
  await signIn(store)
  assert.equal(store.progress.value.公司.stage, '面试')
  assert.equal(store.pendingCount.value, 0)
})

test('edits made while PATCH is in flight stay queued and reach server', async (context) => {
  const { store, server } = setup(context)
  await signIn(store)
  const held = server.holdNextSync()
  store.setRecord('公司', record('已投递'))
  const syncing = store.syncNow()
  await held.received
  store.setRecord('公司', record('面试'))
  held.resume()
  await syncing
  assert.equal(server.records.公司.record.stage, '面试')
  assert.equal(store.pendingCount.value, 0)
})

test('offline queue survives reload and session resumption', async (context) => {
  const server = syncServer()
  const storage = memoryStorage()
  let online = true
  const first = setup(context, server, storage, { isOnline: () => online }).store
  await signIn(first)
  online = false
  first.setRecord('离线', record('面试'))
  assert.equal(await first.syncNow(), false)
  first.stop()
  const next = setup(context, server, storage).store
  await next.start()
  assert.equal(next.progress.value.离线.stage, '面试')
  assert.equal(server.records.离线.record.stage, '面试')
})

test('server deletions conflict with pending edits and require explicit resolution', async (context) => {
  const { store, server } = setup(context)
  await signIn(store)
  store.setRecord('公司', record('笔试'))
  await store.syncNow()
  server.records.公司 = { record: null, version: 2 }
  store.setRecord('公司', record('面试'))
  await store.syncNow()
  assert.equal(store.status.value, 'conflict')
  assert.equal(store.conflicts.value.公司.remote, null)
  store.resolveConflict('公司', 'remote')
  await store.syncNow()
  assert.equal(store.progress.value.公司, undefined)
  assert.equal(store.pendingCount.value, 0)
})

test('choosing local conflict resolution rebases onto the current server version', async (context) => {
  const { store, server } = setup(context)
  await signIn(store)
  store.setRecord('公司', record('笔试'))
  await store.syncNow()
  server.records.公司 = { record: record('AI面试'), version: 2 }
  store.setRecord('公司', record('面试'))
  await store.syncNow()
  store.resolveConflict('公司', 'local')
  await store.syncNow()
  assert.equal(server.records.公司.version, 3)
  assert.equal(server.records.公司.record.stage, '面试')
})

test('different-company offline changes in two tabs both survive reopening', async (context) => {
  const server = syncServer()
  const storage = memoryStorage()
  const first = setup(context, server, storage).store
  await signIn(first)
  const second = setup(context, server, storage, { isOnline: () => false }).store
  await signIn(second)
  first.setRecord('第一家', record('已投递'))
  second.setRecord('第二家', record('笔试'))
  first.stop()
  second.stop()
  const next = setup(context, server, storage).store
  await next.start()
  assert.equal(next.progress.value.第一家.stage, '已投递')
  assert.equal(next.progress.value.第二家.stage, '笔试')
  assert.equal(Object.keys(server.records).length, 2)
})

test('a pending reply retains a newer same-company edit from another tab', async (context) => {
  const server = syncServer()
  const storage = memoryStorage()
  const first = setup(context, server, storage).store
  await signIn(first)
  const second = setup(context, server, storage, { isOnline: () => false }).store
  await signIn(second)
  const held = server.holdNextSync()
  first.setRecord('公司', record('已投递'))
  const syncing = first.syncNow()
  await held.received
  second.setRecord('公司', record('面试'))
  held.resume()
  await syncing
  assert.equal(server.records.公司.record.stage, '面试')
})

test('a stale GET cannot resurrect another tab’s confirmed deletion', async (context) => {
  const server = syncServer()
  const storage = memoryStorage()
  const first = setup(context, server, storage).store
  await signIn(first)
  first.setRecord('公司', record('笔试'))
  await first.syncNow()
  const second = setup(context, server, storage).store
  await signIn(second)
  const held = server.holdNextSync('GET')
  const stale = first.syncNow()
  await held.received
  second.setRecord('公司', null)
  await second.syncNow()
  held.resume()
  await stale
  assert.equal(first.progress.value.公司, undefined)
})

test('imports batch storage updates and reject invalid entries', async (context) => {
  const { store, storage } = setup(context)
  await signIn(store)
  let writes = 0
  const save = storage.setItem
  storage.setItem = (key, value) => { writes += 1; save(key, value) }
  const records = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`公司${index}`, record('笔试')]))
  assert.equal(store.importRecords(records), 100)
  assert.equal(writes, 101)
  assert.throws(() => store.importRecords({ 无效: { unrelated: true } }), /没有可导入/)
  assert.equal(store.setRecord('a'.repeat(301), record('笔试')), false)
})

test('storage failure warnings survive unrelated successful writes and recover', async (context) => {
  const { store, storage } = setup(context)
  await signIn(store)
  const save = storage.setItem
  let failure = true
  storage.setItem = (key, value) => {
    if (failure && key.includes(':company:')) throw new Error('quota')
    save(key, value)
  }
  store.setRecord('公司', record('笔试'))
  assert.match(store.storageError.value, /存储空间不足/)
  failure = false
  await store.syncNow()
  assert.equal(store.storageError.value, '')
  assert.equal(store.progress.value.公司.stage, '笔试')
})

test('storage events refresh tabs and cleanup removes every subscription', async (context) => {
  const server = syncServer()
  const storage = memoryStorage()
  const listeners = new Map()
  const browser = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  }
  const first = setup(context, server, storage).store
  await signIn(first)
  const second = setup(context, server, storage, { window: browser, isOnline: () => false }).store
  await second.start()
  first.setRecord('新公司', record('面试'))
  listeners.get('storage')({ key: `${ACCOUNT_PROGRESS_KEY}:company:${encodeURIComponent('新公司')}` })
  assert.equal(second.progress.value.新公司.stage, '面试')
  second.stop()
  assert.equal(listeners.size, 0)
})

test('logout failure still hides progress and retains the unsent queue', async (context) => {
  const server = syncServer()
  const { store } = setup(context, server, undefined, {
    fetch: (path, options) => {
      if (path === '/api/auth/logout') throw new TypeError('offline')
      return server.fetch(path, options)
    },
  })
  await signIn(store)
  store.setRecord('公司', record('面试'))
  assert.equal(await store.logout(), false)
  assert.equal(store.authenticated.value, false)
  assert.equal(store.pendingCount.value, 1)
  assert.deepEqual(Object.keys(store.progress.value), [])
  assert.match(store.authError.value, /服务器会话未能注销/)
})

test('a login response arriving after logout cannot authenticate the page', async (context) => {
  const server = syncServer()
  let resume
  let receive
  const gate = new Promise((resolve) => { resume = resolve })
  const received = new Promise((resolve) => { receive = resolve })
  const { store } = setup(context, server, undefined, {
    fetch: async (path, options) => {
      const response = await server.fetch(path, options)
      if (path === '/api/auth/login') {
        receive()
        await gate
      }
      return response
    },
  })
  const loggingIn = store.login('XiaoLv', 'XiaoLvBaoBei')
  await received
  const loggingOut = store.logout()
  resume()
  assert.equal(await loggingIn, false)
  assert.equal(await loggingOut, true)
  assert.equal(store.authenticated.value, false)
  assert.equal(server.session, false)
})
