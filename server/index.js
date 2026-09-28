import { resolve } from 'node:path'
import { createApp } from './app.js'

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是 1 到 65535 之间的整数。')
  process.exit(1)
}

const { app, close } = createApp({
  databasePath: process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : undefined,
  dataPath: process.env.DATA_PATH ? resolve(process.env.DATA_PATH) : undefined,
})
const server = app.listen(port, host, () => {
  console.log(`秋招服务已启动：http://${host}:${port}`)
})

server.on('error', (error) => {
  console.error('服务启动失败：', error.message)
  close()
  process.exitCode = 1
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const timeout = setTimeout(() => process.exit(1), 10_000)
  timeout.unref()
  server.close((error) => {
    clearTimeout(timeout)
    close()
    if (error) process.exitCode = 1
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
