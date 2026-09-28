import { readFile } from 'node:fs/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { openDatabase, SESSION_MAX_AGE } from './database.js'

const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const statuses = ['已投递', '笔试', 'AI面试', '面试', '流程结束']
const endStages = statuses.slice(0, -1)
const recordFields = ['stage', 'dates', 'updatedAt', 'endStage', 'endDate']
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const username = 'XiaoLv'
const credentialsHash = createHash('sha256').update(`${username}\0XiaoLvBaoBei`).digest()
const sessionCookieName = 'qiuzhao_session'

function sessionToken(request) {
  const cookie = request.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`))
  const token = cookie?.slice(sessionCookieName.length + 1)
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}

function cookieOptions(request) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: request.secure || request.get('x-forwarded-proto')?.split(',')[0].trim() === 'https',
  }
}

function validDate(value, allowEmpty = false) {
  if (allowEmpty && value === '') return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function normalizeRecord(value) {
  if (value === null) return null
  if (!isObject(value) || Object.keys(value).length !== recordFields.length ||
    !recordFields.every((field) => Object.hasOwn(value, field)) ||
    (value.stage !== '' && !statuses.includes(value.stage)) ||
    !isObject(value.dates) ||
    !Object.entries(value.dates).every(([stage, date]) => statuses.includes(stage) && validDate(date)) ||
    !validDate(value.updatedAt, true) ||
    (value.endStage !== '' && !endStages.includes(value.endStage)) ||
    !validDate(value.endDate, true) ||
    (value.endStage === '' && value.endDate !== '')) {
    throw new Error('INVALID_CHANGES')
  }
  return {
    stage: value.stage,
    dates: Object.fromEntries(statuses.filter((stage) => Object.hasOwn(value.dates, stage)).map((stage) => [stage, value.dates[stage]])),
    updatedAt: value.updatedAt,
    endStage: value.endStage,
    endDate: value.endDate,
  }
}

function validateChanges(body) {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.changes) || body.changes.length > 5000) {
    throw new Error('INVALID_CHANGES')
  }
  const companies = new Set()
  return body.changes.map((change) => {
    if (!isObject(change) || Object.keys(change).length !== 3 ||
      !Object.hasOwn(change, 'record') ||
      typeof change.company !== 'string' || change.company.length > 300 ||
      !change.company.trim() || /[\u0000-\u001f\u007f]/.test(change.company) ||
      companies.has(change.company) ||
      !Number.isSafeInteger(change.baseVersion) || change.baseVersion < 0) {
      throw new Error('INVALID_CHANGES')
    }
    companies.add(change.company)
    return { company: change.company, record: normalizeRecord(change.record), baseVersion: change.baseVersion }
  })
}

function isSameOrigin(request) {
  if (request.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.get('origin')
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.get('host')
  } catch {
    return false
  }
}

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? resolve(rootDirectory, 'storage/qiuzhao.sqlite')
  const dataPath = options.dataPath ?? resolve(rootDirectory, 'data.json')
  const distPath = options.distPath ?? resolve(rootDirectory, 'dist')
  const logger = options.logger ?? console
  const now = options.now ?? Date.now
  const loginFailures = new Map()
  const store = openDatabase(databasePath)
  if (store.retainedWorkspaces) {
    logger.warn?.(`已固定采用记录数最多的旧同步空间；其余 ${store.retainedWorkspaces} 个空间仍完整保留在 SQLite 中，可备份后手动合并。`)
  }
  const app = express()
  app.disable('x-powered-by')
  app.disable('etag')

  app.use((request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff')
    response.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })

  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store')
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      if (!isSameOrigin(request)) return response.status(403).json({ error: '同步请求必须来自同一站点。' })
      if (!request.is('application/json')) return response.status(415).json({ error: '请求内容必须为 JSON。' })
    }
    next()
  }, express.json({ limit: '2mb' }))

  app.post('/api/auth/login', (request, response) => {
    const timestamp = now()
    for (const [address, failure] of loginFailures) {
      if (failure.expiresAt <= timestamp) loginFailures.delete(address)
    }
    const address = request.ip
    const failure = loginFailures.get(address)
    if (failure?.count >= 10) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((failure.expiresAt - timestamp) / 1000))))
      return response.status(429).json({ error: '登录失败次数过多，请一分钟后重试。' })
    }
    if (!isObject(request.body) || Object.keys(request.body).length !== 2 ||
      typeof request.body.username !== 'string' || request.body.username.length > 128 ||
      typeof request.body.password !== 'string' || request.body.password.length > 256) {
      return response.status(400).json({ error: '请输入有效的用户名和密码。' })
    }
    const candidate = createHash('sha256').update(`${request.body.username}\0${request.body.password}`).digest()
    if (!timingSafeEqual(candidate, credentialsHash)) {
      if (!failure && loginFailures.size >= 10_000) loginFailures.delete(loginFailures.keys().next().value)
      loginFailures.set(address, { count: (failure?.count ?? 0) + 1, expiresAt: failure?.expiresAt ?? timestamp + 60_000 })
      return response.status(401).json({ error: '用户名或密码不正确。' })
    }
    loginFailures.delete(address)
    store.revokeSession(sessionToken(request))
    const token = store.createSession(timestamp)
    response.cookie(sessionCookieName, token, { ...cookieOptions(request), maxAge: SESSION_MAX_AGE })
    response.json({ user: { username } })
  })

  function requireSession(request, response, next) {
    if (!store.authenticateSession(sessionToken(request), now())) {
      return response.status(401).json({ error: '请先登录，登录失效时请重新登录。' })
    }
    next()
  }

  app.get('/api/auth/session', requireSession, (request, response) => {
    response.json({ user: { username } })
  })

  app.post('/api/auth/logout', (request, response) => {
    if (!isObject(request.body) || Object.keys(request.body).length !== 0) {
      return response.status(400).json({ error: '退出登录时请发送空 JSON 对象。' })
    }
    store.revokeSession(sessionToken(request))
    response.clearCookie(sessionCookieName, cookieOptions(request))
    response.json({ ok: true })
  })

  app.get('/api/sync', requireSession, (request, response) => {
    response.json({ records: store.getRecords() })
  })

  app.patch('/api/sync', requireSession, (request, response) => {
    let changes
    try {
      changes = validateChanges(request.body)
    } catch {
      return response.status(400).json({ error: '进度数据格式不正确，请检查公司、阶段、日期与版本。' })
    }
    response.json(store.applyChanges(changes))
  })

  app.use('/api', (request, response) => response.status(404).json({ error: '接口不存在。' }))

  app.get('/data.json', async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      const content = await readFile(dataPath, 'utf8')
      response.json(JSON.parse(content))
    } catch (error) {
      logger.error('Unable to read company data:', error.message)
      response.status(503).json({ error: '公司数据暂时不可用，请稍后重试。' })
    }
  })

  app.use(express.static(distPath, { index: false, maxAge: '1h' }))
  app.get('/{*path}', (request, response, next) => {
    response.set('Cache-Control', 'no-cache')
    response.sendFile(resolve(distPath, 'index.html'), (error) => {
      if (!error) return
      if (error.code === 'ENOENT') {
        response.status(503).type('text').send('未找到前端构建文件，请先运行 npm run build。')
        return
      }
      next(error)
    })
  })

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (error.type === 'entity.too.large') return response.status(413).json({ error: '请求内容超过 2 MB 限制。' })
    if (error.type === 'entity.parse.failed') return response.status(400).json({ error: '请求不是有效的 JSON。' })
    if (error.status === 415) return response.status(415).json({ error: '请求编码不受支持。' })
    logger.error('Server request failed:', error.message)
    response.status(500).json({ error: '服务器暂时不可用，请稍后重试。' })
  })

  return { app, close: () => store.close() }
}
