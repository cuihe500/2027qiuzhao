import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isValidCompany, normalizeRecord, normalizeRecords, recordsEqual } from '../lib/progress.js'

const ACTIVE_SYNC_KEY = 'qiuzhao2027_sync_active_v1'
export const LOCAL_PROGRESS_KEY = 'qiuzhao2027_progress_local_v3'
const WORKSPACE_PREFIX = 'qiuzhao2027_sync_workspace_v1:'
export const ACCOUNT_PROGRESS_KEY = 'qiuzhao2027_account_XiaoLv_v1'
const ACCOUNT_KEY = 'XiaoLv'

function newState() {
  return {
    records: Object.create(null),
    versions: Object.create(null),
    pending: Object.create(null),
    conflicts: Object.create(null),
    legacyImported: false,
  }
}

function isMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function parseRemote(payload) {
  if (!isMap(payload?.records)) throw new Error('同步服务返回了无效数据，现有进度已保留。')
  const records = Object.create(null)
  for (const [company, entry] of Object.entries(payload.records)) {
    if (!isValidCompany(company) || !isMap(entry) || !Number.isSafeInteger(entry.version) || entry.version < 1) {
      throw new Error('同步服务返回了无效记录，现有进度已保留。')
    }
    const record = normalizeRecord(entry.record)
    if (entry.record !== null && !record) throw new Error('同步记录格式错误，现有进度已保留。')
    records[company] = { record, version: entry.version }
  }
  return records
}

function setVisibleRecord(state, company, record) {
  if (record === null) delete state.records[company]
  else state.records[company] = normalizeRecord(record)
}

function mergeRemote(state, remoteRecords, sent = Object.create(null), rejected = []) {
  const companies = new Set([
    ...Object.keys(state.records),
    ...Object.keys(state.versions),
    ...Object.keys(state.pending),
    ...Object.keys(remoteRecords),
  ])
  for (const company of companies) {
    const remote = remoteRecords[company] || { record: null, version: 0 }
    if (remote.version < (state.versions[company] ?? 0)) continue
    const pending = state.pending[company]
    state.versions[company] = remote.version
    if (!pending || recordsEqual(pending.record, remote.record)) {
      setVisibleRecord(state, company, remote.record)
      delete state.pending[company]
      delete state.conflicts[company]
      continue
    }
    const submitted = sent[company]
    if (submitted && !rejected.includes(company) && recordsEqual(submitted.record, remote.record)) {
      pending.baseVersion = remote.version
      delete state.conflicts[company]
      continue
    }
    if (pending.baseVersion !== remote.version || state.conflicts[company]) {
      state.conflicts[company] = {
        local: normalizeRecord(pending.record),
        remote: normalizeRecord(remote.record),
        version: remote.version,
      }
    }
  }
}

export function createProgressStore(options = {}) {
  const browser = options.window ?? globalThis.window
  const request = options.fetch ?? globalThis.fetch?.bind(globalThis)
  const checkOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false)
  const user = ref(null)
  const authLoading = ref(true)
  const authError = ref('')
  const progress = ref(Object.create(null))
  const conflicts = ref(Object.create(null))
  const error = ref('')
  const storageError = ref('')
  const pendingCount = ref(0)
  const busy = ref(false)
  const online = ref(checkOnline())
  const states = new Map()
  const persistedSnapshots = new WeakMap()
  const activeRequests = new Set()
  const failedStorageKeys = new Set()
  let storage
  let activeState
  let queue = Promise.resolve()
  let authEpoch = 0
  let syncPromise
  let sessionPromise
  let resumeSession = true
  let syncTimer
  let pollTimer
  let started = false
  let stopped = false

  try {
    storage = options.storage ?? globalThis.localStorage
    if (!storage) throw new Error('unavailable')
  } catch {
    storageError.value = '浏览器存储不可用，进度暂时只保存在当前页面，请及时导出备份。'
  }

  function readStorage(key) {
    try {
      return storage?.getItem(key) ?? null
    } catch {
      storageError.value = '无法读取浏览器存储，请保留当前页面并导出备份。'
      return null
    }
  }

  function writeStorage(key, value) {
    try {
      if (!storage) return false
      storage.setItem(key, value)
      failedStorageKeys.delete(key)
      if (!failedStorageKeys.size) storageError.value = ''
      return true
    } catch {
      failedStorageKeys.add(key)
      storageError.value = '浏览器存储空间不足或不可用，离线修改可能无法保留，请导出备份。'
      return false
    }
  }

  function readJson(key) {
    const value = readStorage(key)
    if (value === null) return null
    try {
      return JSON.parse(value)
    } catch {
      error.value = '部分本地进度数据无法读取，原始存储已保留。'
      return null
    }
  }

  function stateStorageKey(key) {
    return key === ACCOUNT_KEY ? ACCOUNT_PROGRESS_KEY : key ? `${WORKSPACE_PREFIX}${key}` : LOCAL_PROGRESS_KEY
  }

  function companyPrefix(key) {
    return `${stateStorageKey(key)}:company:`
  }

  function snapshotsOf(state) {
    const companies = new Set([...Object.keys(state.records), ...Object.keys(state.versions), ...Object.keys(state.pending)])
    return new Map([...companies].map((company) => [company, JSON.stringify({
      record: state.records[company] ?? null,
      version: state.versions[company] ?? 0,
      pending: state.pending[company] ?? null,
      conflict: state.conflicts[company] ?? null,
    })]))
  }

  function readCompanySnapshots(key) {
    const snapshots = new Map()
    const prefix = companyPrefix(key)
    try {
      for (let index = 0; index < (storage?.length ?? 0); index += 1) {
        const storageKey = storage.key(index)
        if (!storageKey?.startsWith(prefix)) continue
        const company = decodeURIComponent(storageKey.slice(prefix.length))
        if (!isValidCompany(company)) continue
        const snapshot = readJson(storageKey)
        if (!isMap(snapshot) || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0) continue
        const record = normalizeRecord(snapshot.record)
        if (snapshot.record !== null && !record) continue
        const pending = snapshot.pending
        if (pending && (!isMap(pending) || !Number.isSafeInteger(pending.baseVersion) || pending.baseVersion < 0 ||
          (pending.record !== null && !normalizeRecord(pending.record)))) continue
        snapshots.set(company, {
          record,
          version: snapshot.version,
          pending: pending ? { record: normalizeRecord(pending.record), baseVersion: pending.baseVersion } : null,
          conflict: pending && isMap(snapshot.conflict) && Number.isSafeInteger(snapshot.conflict.version) ? {
            local: normalizeRecord(pending.record),
            remote: normalizeRecord(snapshot.conflict.remote),
            version: snapshot.conflict.version,
          } : null,
        })
      }
    } catch {
      storageError.value = '无法读取其他标签页的修改，请导出备份后重试。'
    }
    return snapshots
  }

  function refreshSharedState(state, key, response) {
    const baseline = persistedSnapshots.get(state) || new Map()
    const current = snapshotsOf(state)
    const changed = new Set([...new Set([...baseline.keys(), ...current.keys()])]
      .filter((company) => baseline.get(company) !== current.get(company)))
    const stored = readCompanySnapshots(key)
    for (const [company, snapshot] of stored) {
      if (changed.has(company) && (!response || JSON.stringify(snapshot) === baseline.get(company))) continue
      setVisibleRecord(state, company, snapshot.record)
      state.versions[company] = snapshot.version
      if (snapshot.pending) {
        state.pending[company] = snapshot.pending
        setVisibleRecord(state, company, snapshot.pending.record)
      } else delete state.pending[company]
      if (snapshot.conflict) state.conflicts[company] = snapshot.conflict
      else delete state.conflicts[company]
      baseline.set(company, JSON.stringify(snapshot))
    }
    if (response) mergeRemote(state, response.remote, response.sent, response.rejected)
    persistedSnapshots.set(state, baseline)
    const refreshed = snapshotsOf(state)
    const outstanding = new Set([...new Set([...baseline.keys(), ...refreshed.keys()])]
      .filter((company) => baseline.get(company) !== refreshed.get(company)))
    return { changed: outstanding, stored }
  }

  function persist(state, key, response) {
    const { changed, stored } = refreshSharedState(state, key, response)
    const previous = persistedSnapshots.get(state) || new Map()
    const snapshots = snapshotsOf(state)
    const saved = new Map(snapshots)
    const companies = new Set([...snapshots.keys(), ...changed])
    for (const company of companies) {
      const storageKey = `${companyPrefix(key)}${encodeURIComponent(company)}`
      if (changed.has(company) || !stored.has(company) || failedStorageKeys.has(storageKey)) {
        const successful = writeStorage(storageKey, snapshots.get(company) || JSON.stringify({ record: null, version: 0, pending: null, conflict: null }))
        if (!successful) {
          if (previous.has(company)) saved.set(company, previous.get(company))
          else saved.delete(company)
        }
      }
    }
    writeStorage(stateStorageKey(key), JSON.stringify(state))
    persistedSnapshots.set(state, saved)
  }

  function loadState(key) {
    if (states.has(key)) return states.get(key)
    const state = newState()
    let migrated = false
    const saved = readJson(stateStorageKey(key))
    if (isMap(saved)) {
      state.legacyImported = saved.legacyImported === true
      state.records = normalizeRecords(saved.records)
      for (const [company, version] of Object.entries(saved.versions || {})) {
        if (isValidCompany(company) && Number.isSafeInteger(version) && version >= 0) state.versions[company] = version
      }
      for (const [company, pending] of Object.entries(saved.pending || {})) {
        if (!isValidCompany(company) || !isMap(pending) || !Number.isSafeInteger(pending.baseVersion) || pending.baseVersion < 0) continue
        const record = normalizeRecord(pending.record)
        if (pending.record !== null && !record) continue
        state.pending[company] = { record, baseVersion: pending.baseVersion }
        setVisibleRecord(state, company, record)
      }
      for (const [company, conflict] of Object.entries(saved.conflicts || {})) {
        if (!state.pending[company] || !isMap(conflict) || !Number.isSafeInteger(conflict.version)) continue
        state.conflicts[company] = {
          local: normalizeRecord(state.pending[company].record),
          remote: normalizeRecord(conflict.remote),
          version: conflict.version,
        }
      }
    } else if (!key) {
      const previous = readJson('qiuzhao2027_progress_v2') ?? readJson('qiuzhao2027_progress_v1')
      state.records = normalizeRecords(previous)
      migrated = previous !== null
    }
    persistedSnapshots.set(state, snapshotsOf(state))
    refreshSharedState(state, key)
    states.set(key, state)
    if (migrated) persist(state, key)
    return state
  }

  function publish(state = activeState) {
    if (state !== activeState) return
    progress.value = user.value ? normalizeRecords(state.records) : Object.create(null)
    conflicts.value = Object.fromEntries(Object.entries(user.value ? state.conflicts : {}).map(([company, conflict]) => [
      company,
      { local: normalizeRecord(conflict.local), remote: normalizeRecord(conflict.remote), version: conflict.version },
    ]))
    pendingCount.value = Object.keys(state.pending).length
  }

  activeState = loadState(ACCOUNT_KEY)
  publish()

  const authenticated = computed(() => user.value !== null)
  const status = computed(() => {
    if (storageError.value) return 'error'
    if (!authenticated.value) return 'signed-out'
    if (busy.value) return 'syncing'
    if (Object.keys(conflicts.value).length) return 'conflict'
    if (!online.value) return 'offline'
    if (error.value) return 'error'
    return pendingCount.value ? 'pending' : 'synced'
  })

  function enqueue(task) {
    const run = () => stopped ? false : task()
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }

  async function api(path, body) {
    if (!request) throw new Error('当前浏览器无法访问同步服务。')
    const controller = new AbortController()
    activeRequests.add(controller)
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await request(path, {
        method: body ? (path.startsWith('/api/auth/') ? 'POST' : 'PATCH') : 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const failure = new Error(typeof payload?.error === 'string' ? payload.error : `服务暂时不可用（${response.status}）。`)
        failure.status = response.status
        throw failure
      }
      return payload
    } catch (failure) {
      if (failure.name === 'AbortError') throw new Error('同步请求超时，修改已保留，将在联网后重试。')
      if (failure instanceof TypeError) throw new Error('暂时无法连接同步服务，修改已保留，将在联网后重试。')
      throw failure
    } finally {
      clearTimeout(timeout)
      activeRequests.delete(controller)
    }
  }

  function scheduleSync() {
    if (stopped || !authenticated.value) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => { void syncNow() }, 250)
  }

  function expireSession(message = '登录已失效，请重新登录。未同步修改已保留。') {
    authEpoch += 1
    resumeSession = false
    user.value = null
    authLoading.value = false
    authError.value = message
    busy.value = false
    clearTimeout(syncTimer)
    publish()
  }

  async function synchronize(state = activeState, epoch = authEpoch) {
    if (stopped || !authenticated.value || epoch !== authEpoch) return false
    const key = ACCOUNT_KEY
    online.value = checkOnline()
    if (!online.value) return false
    if (state === activeState) {
      busy.value = true
      error.value = ''
    }
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        refreshSharedState(state, key)
        const sent = Object.fromEntries(Object.entries(state.pending)
          .filter(([company]) => !state.conflicts[company])
          .slice(0, 500)
          .map(([company, pending]) => [company, { ...pending, record: normalizeRecord(pending.record) }]))
        const changes = Object.entries(sent).map(([company, pending]) => ({
          company, record: pending.record, baseVersion: pending.baseVersion,
        }))
        const payload = await api('/api/sync', changes.length ? { changes } : undefined)
        if (stopped || epoch !== authEpoch || !authenticated.value) return false
        const remote = parseRemote(payload)
        refreshSharedState(state, key)
        const rejected = Array.isArray(payload.conflicts) ? payload.conflicts : []
        mergeRemote(state, remote, sent, rejected)
        persist(state, key, { remote, sent, rejected })
        publish(state)
        if (epoch !== authEpoch || !authenticated.value) return false
        if (!Object.keys(state.pending).some((company) => !state.conflicts[company])) return true
      }
      if (state === activeState) scheduleSync()
      return true
    } catch (failure) {
      if (epoch === authEpoch) {
        if (failure.status === 401) expireSession()
        else error.value = failure.message || '同步失败，修改已保留。'
      }
      return false
    } finally {
      if (epoch === authEpoch) busy.value = false
    }
  }

  function syncNow() {
    if (!authenticated.value || stopped) return Promise.resolve(false)
    if (syncPromise) return syncPromise
    const epoch = authEpoch
    const operation = enqueue(() => synchronize(activeState, epoch))
    syncPromise = operation
    void operation.finally(() => { if (syncPromise === operation) syncPromise = undefined })
    return operation
  }

  function changeRecord(company, value) {
    if (!isValidCompany(company)) return false
    const record = normalizeRecord(value)
    if (value !== null && !record) {
      error.value = '进度记录格式无效。'
      return false
    }
    if (recordsEqual(activeState.records[company], record)) return true
    setVisibleRecord(activeState, company, record)
    activeState.pending[company] = {
      record,
      baseVersion: activeState.pending[company]?.baseVersion ?? activeState.versions[company] ?? 0,
    }
    if (activeState.conflicts[company]) activeState.conflicts[company].local = record
    return true
  }

  function setRecord(company, value) {
    if (!authenticated.value) return false
    refreshSharedState(activeState, ACCOUNT_KEY)
    if (!changeRecord(company, value)) return false
    persist(activeState, ACCOUNT_KEY)
    publish()
    scheduleSync()
    return true
  }

  function importRecords(records) {
    if (!authenticated.value) throw new Error('请先登录后再导入进度。')
    if (!isMap(records)) throw new Error('备份应为按公司名称保存的进度对象。')
    refreshSharedState(activeState, ACCOUNT_KEY)
    let count = 0
    for (const [company, record] of Object.entries(records)) {
      if (record !== null && !normalizeRecord(record)) continue
      if (changeRecord(company, record)) count += 1
    }
    if (!count) throw new Error('备份中没有可导入的有效进度记录。')
    persist(activeState, ACCOUNT_KEY)
    publish()
    scheduleSync()
    return count
  }

  function importLocalRecords() {
    return importRecords(legacyRecords())
  }

  function legacyRecords() {
    const records = normalizeRecords(loadState('').records)
    const oldKey = readStorage(ACTIVE_SYNC_KEY)?.trim()
    if (!oldKey || oldKey === ACCOUNT_KEY) return records
    const previous = loadState(oldKey)
    for (const company of Object.keys(previous.versions)) {
      if (!previous.records[company]) delete records[company]
    }
    for (const [company, record] of Object.entries(previous.records)) records[company] = normalizeRecord(record)
    for (const [company, pending] of Object.entries(previous.pending)) {
      if (pending.record === null) delete records[company]
    }
    return records
  }

  async function initializeAccount(epoch) {
    if (!activeState.legacyImported) {
      const remote = parseRemote(await api('/api/sync'))
      if (epoch !== authEpoch || stopped || !authenticated.value) return false
      refreshSharedState(activeState, ACCOUNT_KEY)
      if (!Object.keys(remote).length && !Object.keys(activeState.versions).length && !Object.keys(activeState.pending).length) {
        for (const [company, record] of Object.entries(legacyRecords())) changeRecord(company, record)
      }
      activeState.legacyImported = true
      mergeRemote(activeState, remote)
      persist(activeState, ACCOUNT_KEY, { remote })
      publish()
      if (!Object.keys(activeState.pending).length) return true
    }
    return synchronize(activeState, epoch)
  }

  function validateUser(payload) {
    if (payload?.user?.username !== ACCOUNT_KEY) throw new Error('服务器未返回有效的登录信息。')
    return { username: ACCOUNT_KEY }
  }

  function authenticate(path, credentials) {
    const epoch = ++authEpoch
    authLoading.value = true
    authError.value = ''
    resumeSession = true
    return enqueue(async () => {
      try {
        const account = validateUser(await api(path, credentials))
        if (epoch !== authEpoch || stopped) return false
        user.value = account
        error.value = ''
        publish()
        try {
          await initializeAccount(epoch)
        } catch (failure) {
          if (epoch === authEpoch) {
            if (failure.status === 401) expireSession()
            else error.value = failure.message || '登录成功，但暂时无法同步进度。'
          }
        }
        return epoch === authEpoch && authenticated.value
      } catch (failure) {
        if (epoch === authEpoch) {
          user.value = null
          if (failure.status === 401) resumeSession = false
          authError.value = failure.status === 401
            ? (path.endsWith('/login') ? '用户名或密码错误。' : '')
            : failure.message || '暂时无法验证登录状态，请检查网络后重试。'
          publish()
        }
        return false
      } finally {
        if (epoch === authEpoch) authLoading.value = false
      }
    })
  }

  function login(username, password) {
    return authenticate('/api/auth/login', { username, password })
  }

  function restoreSession() {
    if (!resumeSession || stopped) return Promise.resolve(false)
    if (sessionPromise) return sessionPromise
    const operation = authenticate('/api/auth/session')
    sessionPromise = operation
    void operation.finally(() => { if (sessionPromise === operation) sessionPromise = undefined })
    return operation
  }

  function logout() {
    const epoch = ++authEpoch
    resumeSession = false
    user.value = null
    authLoading.value = true
    authError.value = ''
    busy.value = false
    clearTimeout(syncTimer)
    for (const controller of activeRequests) controller.abort()
    publish()
    return enqueue(async () => {
      try {
        await api('/api/auth/logout', {})
        return epoch === authEpoch
      } catch {
        if (epoch === authEpoch) authError.value = '当前页面已退出，但服务器会话未能注销，请联网后重试。'
        return false
      } finally {
        if (epoch === authEpoch) authLoading.value = false
      }
    })
  }

  function resolveConflict(company, choice) {
    if (!authenticated.value) return false
    refreshSharedState(activeState, ACCOUNT_KEY)
    const conflict = activeState.conflicts[company]
    if (!conflict || !['local', 'remote'].includes(choice)) return false
    if (choice === 'remote') {
      setVisibleRecord(activeState, company, conflict.remote)
      delete activeState.pending[company]
    } else {
      activeState.pending[company] = {
        record: normalizeRecord(conflict.local),
        baseVersion: conflict.version,
      }
    }
    activeState.versions[company] = conflict.version
    delete activeState.conflicts[company]
    persist(activeState, ACCOUNT_KEY)
    publish()
    scheduleSync()
    return true
  }

  function onReconnect() {
    online.value = checkOnline()
    if (authenticated.value) void syncNow()
    else if (!authLoading.value && resumeSession) void restoreSession()
  }

  function onOffline() {
    online.value = false
  }

  function onStorage(event) {
    if (!event.key?.startsWith(companyPrefix(ACCOUNT_KEY))) return
    refreshSharedState(activeState, ACCOUNT_KEY)
    publish()
    scheduleSync()
  }

  function start() {
    if (started) return sessionPromise || Promise.resolve(authenticated.value)
    started = true
    stopped = false
    pollTimer = setInterval(onReconnect, 15000)
    browser?.addEventListener('focus', onReconnect)
    browser?.addEventListener('online', onReconnect)
    browser?.addEventListener('offline', onOffline)
    browser?.addEventListener('storage', onStorage)
    return restoreSession()
  }

  function stop() {
    stopped = true
    started = false
    authEpoch += 1
    clearTimeout(syncTimer)
    clearInterval(pollTimer)
    for (const controller of activeRequests) controller.abort()
    browser?.removeEventListener('focus', onReconnect)
    browser?.removeEventListener('online', onReconnect)
    browser?.removeEventListener('offline', onOffline)
    browser?.removeEventListener('storage', onStorage)
  }

  return {
    user, authenticated, authLoading, authError,
    progress, records: progress, status, error, storageError, conflicts, pendingCount,
    login, logout, setRecord, syncNow, resolveConflict,
    importRecords, importLocalRecords, start, stop,
  }
}

export function useProgress(options) {
  const store = createProgressStore(options)
  onMounted(store.start)
  onUnmounted(store.stop)
  return store
}
