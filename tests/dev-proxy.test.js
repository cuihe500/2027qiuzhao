import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer, loadConfigFromFile } from 'vite'
import { createApp } from '../server/app.js'

const rootDirectory = fileURLToPath(new URL('../', import.meta.url))

test('Vite proxies browser-origin sync requests and current data using the project configuration', { timeout: 15_000 }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'qiuzhao-dev-proxy-'))
  const dataPath = join(directory, 'data.json')
  let application
  let backend
  let vite

  context.after(async () => {
    const results = await Promise.allSettled([
      vite?.close(),
      backend && new Promise((resolveClose, reject) => backend.close((error) => error ? reject(error) : resolveClose())),
    ])
    application?.close()
    await rm(directory, { recursive: true, force: true })
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  })

  await writeFile(dataPath, JSON.stringify({ rev: 'same-revision', data: [{ company: '原始公司' }] }))
  application = createApp({
    databasePath: join(directory, 'progress.sqlite'),
    dataPath,
    distPath: join(directory, 'dist'),
  })
  backend = await new Promise((resolveServer, reject) => {
    const instance = application.app.listen(0, '127.0.0.1', () => resolveServer(instance))
    instance.once('error', reject)
  })

  const previousPort = process.env.PORT
  let loaded
  try {
    process.env.PORT = String(backend.address().port)
    loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, join(rootDirectory, 'vite.config.js'), rootDirectory, 'silent')
  } finally {
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
  }
  assert.ok(loaded)
  assert.equal(loaded.config.server.proxy['/api'].changeOrigin, false)
  assert.equal(loaded.config.server.proxy['/data.json'].changeOrigin, false)

  vite = await createServer({
    ...loaded.config,
    configFile: false,
    root: rootDirectory,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...loaded.config.server,
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      hmr: false,
      watch: null,
    },
  })
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }

  const created = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ username: 'XiaoLv', password: 'XiaoLvBaoBei' }),
  })
  assert.equal(created.status, 200)
  assert.deepEqual(await created.json(), { user: { username: 'XiaoLv' } })
  const cookie = created.headers.get('set-cookie')?.split(';')[0]
  assert.match(cookie, /^qiuzhao_session=[A-Za-z0-9_-]{43}$/)

  const record = { stage: '笔试', dates: { 笔试: '2026-09-28' }, updatedAt: '2026-09-28', endStage: '', endDate: '' }
  const updated = await fetch(`${origin}/api/sync`, {
    method: 'PATCH',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ changes: [{ company: '同步公司', record, baseVersion: 0 }] }),
  })
  assert.equal(updated.status, 200)
  const updatedPayload = await updated.json()
  assert.deepEqual(updatedPayload.conflicts, [])
  const direct = await fetch(`http://127.0.0.1:${backend.address().port}/api/sync`, { headers: { Cookie: cookie } })
  assert.deepEqual((await direct.json()).records['同步公司'], { record, version: 1 })

  const initialData = await fetch(`${origin}/data.json`)
  assert.equal(initialData.status, 200)
  assert.equal(initialData.headers.get('cache-control'), 'no-store')
  assert.equal((await initialData.json()).data[0].company, '原始公司')
  await writeFile(dataPath, JSON.stringify({ rev: 'same-revision', data: [{ company: '最新公司' }] }))
  const latestData = await fetch(`${origin}/data.json`)
  assert.equal(latestData.status, 200)
  assert.equal(latestData.headers.get('cache-control'), 'no-store')
  assert.equal((await latestData.json()).data[0].company, '最新公司')
})
