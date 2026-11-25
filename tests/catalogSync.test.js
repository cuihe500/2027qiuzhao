import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractPortalKey,
  fetchAndMergeDualSources,
  isBranchName,
  mapIndustryToCategory,
  mergeCatalogs,
  normalizeCompanyName,
} from '../server/catalogSync.js'

test('extractPortalKey handles multi-level TLDs, ATS tenants, and excludes public platforms', () => {
  assert.equal(extractPortalKey('https://campus.dahuatech.com/jobs'), 'dom:dahuatech.com')
  assert.equal(extractPortalKey('https://hr.sgcc.com.cn/campus'), 'dom:sgcc.com.cn')
  assert.equal(extractPortalKey('https://campus.mcdonalds.com.cn/apply'), 'dom:mcdonalds.com.cn')
  assert.notEqual(
    extractPortalKey('https://hr.sgcc.com.cn/campus'),
    extractPortalKey('https://campus.mcdonalds.com.cn/apply'),
  )
  assert.equal(extractPortalKey('https://app.mokahr.com/campus_apply/bytedance/123'), 'ats:moka:bytedance')
  assert.equal(extractPortalKey('https://yonghui.jobs.feishu.cn/900113/'), 'ats:feishu:yonghui')
  assert.equal(extractPortalKey('https://wecruit.hotjob.cn/SU6136b970bef57c3b638162c4/pb/school.html'), 'ats:hotjob:su6136b970bef57c3b638162c4')
  assert.equal(extractPortalKey('https://mengniu.zhiye.com/campus'), 'ats:zhiye:mengniu')
  // Generic platforms and doc/form links must return empty key
  assert.equal(extractPortalKey('https://example.feishu.cn/docx/abc123'), '')
  assert.equal(extractPortalKey('https://mp.weixin.qq.com/s/abcdef'), '')
  assert.equal(extractPortalKey('https://career.ahnu.edu.cn/info/1008/38992.htm'), '')
  assert.equal(extractPortalKey('https://jobs.51job.com/all/co123.html'), '')
})

test('branch detection isolates SOE/bank branches while normalizing identical branch variants', () => {
  assert.equal(isBranchName('招商银行股份有限公司泉州分行'), true)
  assert.equal(isBranchName('招商银行泉州分行'), true)
  assert.equal(isBranchName('中核浙能能源有限公司'), true)
  assert.equal(isBranchName('国网山西省电力有限公司'), true)
  assert.equal(isBranchName('顺丰控股股份有限公司'), false)
  assert.equal(isBranchName('招商银行'), false)

  // Same branch with/without legal suffix normalizes identically
  assert.equal(
    normalizeCompanyName('招商银行股份有限公司泉州分行'),
    normalizeCompanyName('招商银行泉州分行'),
  )
  // Branch stays distinct from headquarters
  assert.notEqual(
    normalizeCompanyName('招商银行股份有限公司泉州分行'),
    normalizeCompanyName('招商银行'),
  )
})

test('mergeCatalogs enforces 4-layer deduplication, branch independence, expiry filtering, pure-internship badges, and baseline/progress protection', () => {
  const baseline = {
    rev: '20261014-d',
    updated: '2026-10-14',
    cats: {
      '美团': '大厂',
      '大华股份': '智能制造/装备',
      '招商银行': '金融',
      '麦当劳中国': '餐饮茶饮',
      '停招老公司': '中厂',
    },
    data: [
      { company: '美团', cat: '大厂', date: '2026-08-01', roles: '产品经理、算法', portal: 'https://campus.meituan.com', note: '基线备注', source: '基线', ent: '民企', cohort: '2027届' },
      { company: '大华股份', cat: '智能制造/装备', date: '2026-08-10', roles: '研发', portal: 'https://campus.dahuatech.com', note: '', source: '基线', ent: '民企', cohort: '2027届' },
      { company: '招商银行', cat: '金融', date: '2026-08-20', roles: '管培生', portal: 'https://career.cmbchina.com', note: '', source: '基线', ent: '央企国企', cohort: '2027届' },
      { company: '麦当劳中国', cat: '餐饮茶饮', date: '2026-08-20', roles: '管培生', portal: 'https://campus.mcdonalds.com.cn', note: '', source: '基线', ent: '外企', cohort: '2027届' },
      { company: '停招老公司', cat: '中厂', date: '2026-07-01', roles: '后端', portal: '', note: '已投递过', source: '基线', ent: '民企', cohort: '2027届' },
    ],
  }

  const previousCatalog = {
    rev: '20261120-dual-6',
    updated: '2026-11-20',
    cats: { ...baseline.cats, '已投过期外源公司': '互联网/软件' },
    data: [
      ...baseline.data,
      { company: '已投过期外源公司', cat: '互联网/软件', date: '2026-11-01', roles: 'Java开发', portal: 'https://old.example.com', note: '截止：2026-11-10', source: '秋招信库', ent: '民企', cohort: '2027届' },
    ],
  }

  const chloeRecords = [
    // L4 alias match -> 美团
    {
      company: '北京三快在线科技有限公司',
      title: '后端开发、大模型算法',
      program: '美团2027届秋招补录',
      industry: 'IT/互联网/游戏',
      cities: ['北京', '上海'],
      cohort: '2027届',
      batch: '秋招补录',
      deadline: '2026-12-20',
      updatedAt: '2026-11-24T10:00:00+08:00',
      source: '官网',
      applyUrl: 'https://campus.meituan.com/jobs',
    },
    // L3 portal + token match -> 大华股份
    {
      company: '浙江大华技术股份有限公司',
      title: '嵌入式软件工程师',
      program: '2027届秋招',
      industry: '电子/通信/半导体',
      cities: ['杭州'],
      cohort: '2027届',
      batch: '秋招专场',
      deadline: null,
      updatedAt: '2026-11-23T09:00:00+08:00',
      source: '官网',
      applyUrl: 'https://campus.dahuatech.com/school',
    },
    // SOE branch -> must stay independent from 招商银行
    {
      company: '招商银行股份有限公司泉州分行',
      title: '金融科技岗',
      program: '2027届校园招聘',
      industry: '金融业',
      cities: ['泉州'],
      cohort: '2027届',
      batch: '秋招专场',
      deadline: '2026-12-30',
      updatedAt: '2026-11-24T12:00:00+08:00',
      source: '官网',
      applyUrl: 'https://career.cmbchina.com/qz',
    },
    // Different .com.cn domain must NOT collide with 麦当劳中国
    {
      company: '国网电力测试有限公司',
      title: '电气工程师',
      program: '2027届校园招聘',
      industry: '能源/化工/环保',
      cities: ['北京'],
      cohort: '2027届',
      batch: '秋招专场',
      deadline: '2026-12-31',
      updatedAt: '2026-11-24T12:00:00+08:00',
      source: '官网',
      applyUrl: 'https://hr.sgcc.com.cn/apply',
    },
    // Expired external entry -> must be dropped
    {
      company: '已截止外部公司',
      title: '前端开发',
      program: '2027届秋招',
      industry: 'IT/互联网/游戏',
      cities: ['深圳'],
      cohort: '2027届',
      batch: '秋招专场',
      deadline: '2026-11-20',
      updatedAt: '2026-11-01T12:00:00+08:00',
      source: '官网',
      applyUrl: 'https://expired.example.com',
    },
    // Strict 2026 cohort -> must be dropped
    {
      company: '仅26届公司',
      title: '开发',
      program: '2026校园招聘',
      industry: 'IT/互联网/游戏',
      cities: ['北京'],
      cohort: '2026届',
      batch: '秋招专场',
      deadline: '2026-12-30',
      updatedAt: '2026-11-24T12:00:00+08:00',
      source: '官网',
      applyUrl: 'https://only26.example.com',
    },
  ]

  const huRecords = [
    // Junk header row -> ignored
    { '公司名称': '筛选前必看-点这里', '招聘对象': ['2027届'], '批次': ['秋招'] },
    // Same branch variant -> must merge into 招商银行股份有限公司泉州分行 and enrich with 免笔试 & 央国企
    {
      '公司名称': '招商银行泉州分行',
      '行业大类': ['金融业'],
      '企业性质': ['央国企'],
      '工作地点': ['泉州'],
      '更新时间': '2026/11/24',
      '招聘岗位': '数据分析岗',
      '截止时间': '2026/12/30',
      '是否需要笔试': ['含免笔试'],
      '投递方式': 'https://career.cmbchina.com/qz',
      '招聘对象': ['2027届'],
      '批次': ['秋招'],
    },
    // Pure internship entry -> must be retained and prominently labeled!
    {
      '公司名称': '星辰大模型实验室',
      '行业大类': ['IT/互联网/游戏'],
      '企业性质': ['民企'],
      '工作地点': ['北京'],
      '更新时间': '2026/11/24',
      '招聘岗位': '大模型算法实习生',
      '截止时间': '2026/12/31',
      '是否需要笔试': ['含免笔试'],
      '投递方式': 'https://xingchen.jobs.feishu.cn/intern',
      '招聘对象': ['2027届', '2028届'],
      '批次': ['日常实习'],
    },
    // Company with BOTH full-time and internship -> should NOT be internOnly
    {
      '公司名称': '双轨科技',
      '行业大类': ['IT/互联网/游戏'],
      '企业性质': ['民企'],
      '工作地点': ['上海'],
      '更新时间': '2026/11/24',
      '招聘岗位': '软件开发工程师',
      '截止时间': '2026/12/31',
      '投递方式': 'https://shuanggui.example.com/campus',
      '招聘对象': ['2027届'],
      '批次': ['秋招'],
    },
    {
      '公司名称': '双轨科技',
      '行业大类': ['IT/互联网/游戏'],
      '企业性质': ['民企'],
      '工作地点': ['上海'],
      '更新时间': '2026/11/24',
      '招聘岗位': '研发实习生',
      '截止时间': '2026/12/31',
      '投递方式': 'https://shuanggui.example.com/intern',
      '招聘对象': ['2027届'],
      '批次': ['日常实习'],
    },
  ]

  const { catalog, stats } = mergeCatalogs({
    baseline,
    previousCatalog,
    protectedCompanies: new Set(['已投过期外源公司']),
    chloeRecords,
    huRecords,
    today: '2026-11-25',
  })

  const byName = new Map(catalog.data.map((item) => [item.company, item]))

  // 1. All baseline companies preserved with exact keys
  for (const baseItem of baseline.data) {
    assert.ok(byName.has(baseItem.company), `Baseline company missing: ${baseItem.company}`)
  }

  // 2. SQLite-tracked non-baseline company preserved even after expiring upstream
  assert.ok(byName.has('已投过期外源公司'))
  assert.equal(stats.protectedPreserved, 1)

  // 3. L4 alias merged into 美团 without creating duplicate row
  assert.ok(!byName.has('北京三快在线科技有限公司'))
  assert.equal(byName.get('美团').date, '2026-11-24')
  assert.match(byName.get('美团').roles, /大模型算法/)
  assert.match(byName.get('美团').note, /秋招补录/)
  assert.doesNotMatch(byName.get('美团').roles, /等等/)

  // 4. L3 portal + token merged into 大华股份 without duplicate row
  assert.ok(!byName.has('浙江大华技术股份有限公司'))
  assert.equal(byName.get('大华股份').date, '2026-11-23')
  assert.match(byName.get('大华股份').roles, /嵌入式软件工程师/)

  // 5. Branch stays separate from headquarters, while duplicate branch variants deduplicate cleanly
  assert.ok(byName.has('招商银行'))
  assert.ok(byName.has('招商银行股份有限公司泉州分行'))
  assert.ok(!byName.has('招商银行泉州分行'))
  assert.equal(byName.get('招商银行股份有限公司泉州分行').ent, '央企国企')
  assert.match(byName.get('招商银行股份有限公司泉州分行').note, /含免笔试/)
  assert.match(byName.get('招商银行股份有限公司泉州分行').roles, /数据分析岗/)

  // 6. Multi-level TLD (.com.cn) does not falsely collide with 麦当劳中国
  assert.ok(byName.has('国网电力测试有限公司'))

  // 7. Expired external and 2026-only external records are excluded
  assert.ok(!byName.has('已截止外部公司'))
  assert.ok(!byName.has('仅26届公司'))

  // 8. Pure internship is kept and prominently marked
  const internItem = byName.get('星辰大模型实验室')
  assert.ok(internItem)
  assert.equal(internItem.internOnly, true)
  assert.match(internItem.cohort, /纯实习/)
  assert.match(internItem.note, /【纯实习·日常实习】/)
  assert.equal(internItem.cat, '互联网/软件')

  // 9. Company with both full-time and internship is not marked internOnly
  const dualTrack = byName.get('双轨科技')
  assert.ok(dualTrack)
  assert.equal(Boolean(dualTrack.internOnly), false)
  assert.equal(dualTrack.cat, '互联网/软件')
})

test('mapIndustryToCategory maps IT/互联网/游戏 to 互联网/软件 instead of 游戏/文娱', () => {
  assert.equal(mapIndustryToCategory('IT/互联网/游戏'), '互联网/软件')
  assert.equal(mapIndustryToCategory('游戏'), '游戏/文娱')
  assert.equal(mapIndustryToCategory('电子/通信/半导体、制造业'), '半导体/电子')
})

test('fetchAndMergeDualSources degrades gracefully when one source fails and returns null when all fail', async () => {
  const baseline = {
    rev: '20261014-d',
    updated: '2026-10-14',
    cats: { '基线公司': '大厂' },
    data: [{ company: '基线公司', cat: '大厂', date: '2026-10-01', roles: '研发', portal: '', note: '', source: '', ent: '民企', cohort: '2027届' }],
  }

  const partialResult = await fetchAndMergeDualSources({
    baseline,
    sources: {
      chloe: ['https://broken.example/chloe.json'],
      hu: ['https://ok.example/hu.json'],
    },
    now: () => Date.parse('2026-11-25T08:00:00Z'),
    logger: { warn() {} },
    fetchImpl: async (url) => {
      if (url.includes('broken')) throw new Error('network down')
      return {
        ok: true,
        json: async () => ([
          {
            '公司名称': '单源存活公司',
            '行业大类': ['IT/互联网/游戏'],
            '企业性质': ['央国企'],
            '更新时间': '2026/11/24',
            '招聘岗位': '后端开发',
            '投递方式': 'https://alive.example.com',
            '招聘对象': ['2027届'],
            '批次': ['秋招'],
          },
        ]),
      }
    },
  })

  assert.ok(partialResult)
  assert.deepEqual(partialResult.activeSources, ['hu'])
  assert.equal(partialResult.catalog.count, 2)
  assert.ok(partialResult.catalog.data.some((x) => x.company === '单源存活公司'))
  assert.ok(partialResult.catalog.data.some((x) => x.company === '基线公司'))

  const allFailed = await fetchAndMergeDualSources({
    baseline,
    sources: {
      chloe: ['https://broken.example/chloe.json'],
      hu: ['https://broken.example/hu.json'],
    },
    logger: { warn() {} },
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.equal(allFailed, null)
})
