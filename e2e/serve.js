import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/app.js'

const directory = await mkdtemp(join(tmpdir(), 'qiuzhao-e2e-'))
const dataPath = join(directory, 'data.json')
await writeFile(dataPath, JSON.stringify({
  rev: 'test-1', updated: '2026-09-28', count: 2,
  cats: { '测试科技': '互联网/软件', '示例集团': '央企国企' },
  data: [
    { company: '测试科技', date: '2026-09-28', roles: '产品经理、研发', cat: '互联网/软件', portal: 'https://example.com/jobs', note: '面向2027届', ent: '民企' },
    { company: '示例集团', date: '2026-09-27', roles: '财务 会计', cat: '央企国企', portal: '邮箱：jobs@example.com', note: '校招', ent: '央企国企' },
  ],
}))
const { app, close } = createApp({ dataPath, databasePath: join(directory, 'progress.sqlite') })
const server = app.listen(3187, '127.0.0.1')
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  server.close(async () => {
    close()
    await rm(directory, { recursive: true, force: true })
    process.exit(0)
  })
  server.closeAllConnections()
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
