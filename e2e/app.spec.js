import { expect, test } from '@playwright/test'

const credentials = { username: 'XiaoLv', password: 'XiaoLvBaoBei' }

test.beforeEach(async ({ request }) => {
  const loginResponse = await request.post('/api/auth/login', { data: credentials })
  expect(loginResponse.ok()).toBeTruthy()
  const response = await request.get('/api/sync')
  expect(response.ok()).toBeTruthy()
  const { records } = await response.json()
  const changes = Object.entries(records)
    .filter(([, entry]) => entry.record !== null)
    .map(([company, entry]) => ({ company, record: null, baseVersion: entry.version }))
  if (changes.length) {
    const cleared = await request.patch('/api/sync', { data: { changes } })
    expect(cleared.ok()).toBeTruthy()
    expect((await cleared.json()).conflicts).toEqual([])
  }
  const logoutResponse = await request.post('/api/auth/logout', { data: {} })
  expect(logoutResponse.ok()).toBeTruthy()
})

async function login(page) {
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录秋招助手', exact: true })).toBeHidden()
  await expect(page.locator('.sync-status')).toHaveText('已同步')
}

async function openApp(page) {
  await page.goto('/')
  await login(page)
}

async function openSync(page) {
  const panel = page.locator('.sync-panel')
  if (!(await panel.evaluate(element => element.open))) {
    await panel.locator('summary').click()
  }
}

test('requires login, rejects wrong passwords, restores sessions, and gates the app after logout', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录秋招助手', exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader')).toHaveCount(0)
  expect((await page.request.get('/api/sync')).status()).toBe(401)
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/用户名|密码/)
  await expect(page.getByRole('rowheader')).toHaveCount(0)
  await login(page)
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: '登录秋招助手', exact: true })).toBeHidden()
  await openSync(page)
  await expect(page.locator('.sync-panel')).toContainText(credentials.username)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录秋招助手', exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader')).toHaveCount(0)
  expect((await page.request.get('/api/sync')).status()).toBe(401)
  await login(page)
  await expect(page.getByRole('rowheader')).toHaveCount(2)
})

test('loads current JSON on every open and refresh even with unchanged revision', async ({ page }) => {
  let companyName = '首次打开的公司'
  let requests = 0
  await page.route('**/data.json?*', route => {
    requests += 1
    return route.fulfill({ json: {
      rev: 'same-revision', updated: '2026-09-28', count: 999,
      cats: { [companyName]: '大厂' },
      data: [{ company: companyName, roles: '财务', date: '2026-09-28' }],
    } })
  })
  await openApp(page)
  await expect(page.getByRole('rowheader', { name: companyName })).toBeVisible()
  await expect(page.locator('.hero-meta')).toContainText('收录 1 家公司')
  companyName = '刷新后的最新公司'
  await page.reload()
  await expect(page.getByRole('rowheader', { name: companyName })).toBeVisible()
  companyName = '手动更新后的公司'
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('rowheader', { name: companyName })).toBeVisible()
  expect(requests).toBe(3)
})

test('migrates old progress, filters reactively, and reports data loading failures', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qiuzhao2027_progress_v2', JSON.stringify({
    '测试科技': { stage: '笔试', dates: { 已投递: '2026-09-20', 笔试: '2026-09-24' }, updatedAt: '2026-09-24', endStage: '', endDate: '' },
  })))
  await openApp(page)
  await openSync(page)
  await page.getByRole('button', { name: '合并此设备本地进度', exact: true }).click()
  await expect(page.locator('.sync-status')).toHaveText('已同步')
  await expect(page.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('笔试')
  await page.getByLabel('自定义岗位方向').fill('财务 会计')
  await expect(page.getByRole('rowheader', { name: '示例集团', exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: '测试科技', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重置筛选' }).click()
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  await page.route('**/data.json?*', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('当前显示上次成功读取的数据')
  await expect(page.getByRole('rowheader')).toHaveCount(2)
})

test('syncs separate devices, persists offline changes, and resolves deletion conflicts', async ({ browser }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  try {
    const first = await firstContext.newPage()
    const second = await secondContext.newPage()
    await openApp(first)
    await first.getByLabel('测试科技 投递进度', { exact: true }).selectOption('已投递')
    await openSync(first)
    await expect(first.locator('.sync-status')).toHaveText('已同步')
    await openApp(second)
    await openSync(second)
    await expect(second.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('已投递')
    await secondContext.setOffline(true)
    await second.getByLabel('测试科技 投递进度', { exact: true }).selectOption('面试')
    await expect(second.locator('.sync-status')).toContainText('离线')
    first.once('dialog', dialog => dialog.accept())
    await first.getByLabel('测试科技 投递进度', { exact: true }).selectOption('')
    await expect(first.locator('.sync-status')).toHaveText('已同步')
    await secondContext.setOffline(false)
    await expect(second.locator('.conflict-item')).toContainText('测试科技')
    await expect(second.locator('.conflict-item')).toContainText('服务器：已清空')
    await second.getByRole('button', { name: '保留此设备', exact: true }).click()
    await expect(second.locator('.sync-status')).toHaveText('已同步')
    await first.getByRole('button', { name: '立即同步' }).click()
    await expect(first.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('面试')
    await second.reload()
    await expect(second.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('面试')
    await openSync(second)
    await second.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(second.getByRole('rowheader')).toHaveCount(0)
    await expect(first.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('面试')
    await login(second)
    await expect(second.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('面试')
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})

test('opens the migrated interview assistant with the latest company list', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openApp(page)
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  await page.getByRole('button', { name: 'AI 面试助手', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI 面试助手', exact: true })).toBeVisible()
  await expect(page.locator('#aiCompanyList option')).toHaveCount(2)
  await page.locator('#aiClose').click()
  await expect(page.getByRole('dialog', { name: 'AI 面试助手', exact: true })).toBeHidden()
  expect(errors).toEqual([])
})

test('restores legacy backups, exports CSV, and keeps backup-only companies', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  page.once('dialog', dialog => dialog.accept())
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'progress.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ '测试科技': '面试', '已下架的公司': '笔试' })),
  })
  await expect(page.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('面试')
  await expect(page.locator('footer')).toContainText('已恢复 2 家公司的进度')
  const backupEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份进度', exact: true }).click()
  const backup = await backupEvent
  const chunks = []
  for await (const chunk of await backup.createReadStream()) chunks.push(chunk)
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(data['已下架的公司'].stage).toBe('笔试')
  const csvEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
  const csv = await csvEvent
  expect(csv.suggestedFilename()).toBe('2027届秋招投递进度.csv')
})

test('preserves unsent edits from multiple tabs after both tabs close', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const first = await context.newPage()
    await openApp(first)
    await openSync(first)
    await expect(first.locator('.sync-status')).toHaveText('已同步')
    const second = await context.newPage()
    await second.goto('/')
    await expect(second.getByLabel('示例集团 投递进度', { exact: true })).toBeVisible()
    await context.route('**/api/sync**', route => route.abort())
    await first.getByLabel('测试科技 投递进度', { exact: true }).selectOption('已投递')
    await second.getByLabel('示例集团 投递进度', { exact: true }).selectOption('笔试')
    await first.close()
    await second.close()
    const restored = await context.newPage()
    await restored.goto('/')
    await expect(restored.getByLabel('测试科技 投递进度', { exact: true })).toHaveValue('已投递')
    await expect(restored.getByLabel('示例集团 投递进度', { exact: true })).toHaveValue('笔试')
    await context.unroute('**/api/sync**')
    await openSync(restored)
    await restored.getByRole('button', { name: '立即同步' }).click()
    await expect(restored.locator('.sync-status')).toHaveText('已同步')
  } finally {
    await context.close()
  }
})
