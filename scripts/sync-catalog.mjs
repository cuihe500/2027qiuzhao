#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DUAL_SOURCES, fetchAndMergeDualSources } from '../server/catalogSync.js'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
const baselinePath = resolve(rootDir, process.env.BASELINE_PATH || 'data.baseline.json')
const dataPath = resolve(rootDir, process.env.DATA_PATH || 'data.json')
const versionPath = resolve(rootDir, process.env.VERSION_PATH || 'version.json')

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const previousCatalog = await readJsonOptional(dataPath)
  const baseline = (await readJsonOptional(baselinePath)) ?? previousCatalog
  if (!baseline || !Array.isArray(baseline.data)) {
    throw new Error(`找不到有效的基线文件：${baselinePath}`)
  }

  const result = await fetchAndMergeDualSources({
    baseline,
    previousCatalog,
    sources: DEFAULT_DUAL_SOURCES,
    timeoutMs: 25_000,
    logger: console,
  })

  if (!result) {
    throw new Error('双源拉取均失败，保持现有 data.json 不变。')
  }

  const { catalog, stats, activeSources } = result
  const uniqueNames = new Set(catalog.data.map((item) => item.company))
  if (uniqueNames.size !== catalog.data.length) {
    throw new Error('合并结果校验失败：存在重复公司名称')
  }

  // Verify every baseline company is still 100% present with identical key
  for (const baseItem of baseline.data) {
    if (!uniqueNames.has(baseItem.company)) {
      throw new Error(`基线保护校验失败：缺少历史公司「${baseItem.company}」`)
    }
  }

  const portalCount = catalog.data.filter((item) => item.portal && /^https?:\/\//.test(item.portal)).length
  const versionPayload = {
    rev: catalog.rev,
    updated: catalog.updated,
    count: catalog.count,
    note: `双源合并（${activeSources.join('+')}）：共收录 ${catalog.count} 家（保留基线 ${stats.baselineCount} 家，净增 ${stats.netNew} 家，其中纯实习 ${stats.internOnlyCount} 家，有效直链/公告 ${portalCount} 家）。`,
  }

  await writeFile(dataPath, `${JSON.stringify(catalog, null, 1)}\n`, 'utf8')
  await writeFile(versionPath, `${JSON.stringify(versionPayload, null, 1)}\n`, 'utf8')

  console.log('双源同步完成：', JSON.stringify({
    rev: catalog.rev,
    updated: catalog.updated,
    activeSources,
    portalCount,
    ...stats,
  }, null, 2))
}

main().catch((error) => {
  console.error('同步失败：', error.message)
  process.exit(1)
})
