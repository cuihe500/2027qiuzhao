import { readFileSync } from 'node:fs'

export const DEFAULT_DUAL_SOURCES = {
  chloe: [
    'https://raw.githubusercontent.com/Chloe-s-Space/job-website/main/public/jobs.json',
    'https://cdn.jsdelivr.net/gh/Chloe-s-Space/job-website@main/public/jobs.json',
  ],
  hu: [
    'https://raw.githubusercontent.com/HU-eun/campus-recruitment/main/data/jobs.json',
    'https://cdn.jsdelivr.net/gh/HU-eun/campus-recruitment@main/data/jobs.json',
  ],
}

const DEFAULT_ALIASES = JSON.parse(
  readFileSync(new URL('./companyAliases.json', import.meta.url), 'utf8'),
)

const MULTI_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'org.hk', 'edu.hk', 'com.tw', 'co.jp', 'co.uk', 'com.sg', 'com.au',
])

const GENERIC_PLATFORM_HOSTS = /(?:^|\.)(?:mp\.weixin\.qq\.com|weixin\.qq\.com|qq\.com|163\.com|sina\.com\.cn|51job\.com|zhaopin\.com|liepin\.com|nowcoder\.com|iguopin\.com|ncss\.cn|shixiseng\.com|zhipin\.com|lagou\.com|yingjiesheng\.com|jobui\.com|dajie\.com|offerxiansheng\.com|wintalent\.cn|moseeker\.com|italent\.cn|dayee\.com|hotjob\.cn|mokahr\.com|zhiye\.com|beisen\.com|feishu\.cn|wps\.cn|kdocs\.cn|shimo\.im|dingtalk\.com|notion\.so|wjx\.cn|wenjuan\.com|jinshuju\.net|mikecrm\.com|xiaohongshu\.com|bilibili\.com|zhihu\.com|github\.com|gitee\.com|58\.com|ganji\.com|cjol\.com|jobcn\.com|gxrc\.com|szrc\.cn|fzrsrc\.com|xmrc\.com\.cn|scrc168\.com|hbsc\.cn|qlrc\.com|jxhr\.com|ahrc\.com\.cn|edu\.cn|gov\.cn)$/i

const JOB_BOARD_HOSTS = /(?:^|\.)(?:51job\.com|zhaopin\.com|liepin\.com|nowcoder\.com|iguopin\.com|ncss\.cn|shixiseng\.com|zhipin\.com|lagou\.com|yingjiesheng\.com|jobcn\.com|cjol\.com|gxrc\.com|szrc\.cn|fzrsrc\.com|xmrc\.com\.cn)$/i
const ANNOUNCEMENT_HOSTS = /(?:^|\.)(?:mp\.weixin\.qq\.com|weixin\.qq\.com|edu\.cn|gov\.cn|wjx\.cn|wenjuan\.com|jinshuju\.net|mikecrm\.com|kdocs\.cn|shimo\.im|feishu\.cn)$/i

const JUNK_COMPANY_RE = /^(?:筛选前必看|点击这里|使用说明|注意事项|置顶|公告|免责声明|更新日志|表头)/

const BRANCH_MARKER_RE = /(?:分公司|分行|支行|研究院|研究所|设计院|医院|学院|大学|电力公司|供电公司|供电局|铁路.{1,6}局|局集团|省公司|市公司|工程局|电厂|发电厂|热电厂|机场|地铁|轨道交通|港务|炼化|油田|煤矿|党校|分院|办事处|营业部|中心医院|实验学校|中学|小学)/
const CONGLOMERATE_REGION_RE = /^(?:中国|国家|中核|中交|中建|中铁|中船|中航|中电|中煤|中粮|中储粮|中石油|中石化|国网|南网|华能|大唐|华电|国能|三峡|人保|人寿|平安|招商银行|工商银行|农业银行|建设银行|交通银行|邮储银行|中信银行|光大银行|浦发银行|民生银行|兴业银行|华夏银行|广发银行).{0,12}(?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|新疆|宁夏|西藏|深圳|青岛|大连|宁波|厦门|苏州|无锡|杭州|南京|武汉|成都|西安|长沙|郑州|合肥|福州|济南|沈阳|哈尔滨|昆明|贵阳|南宁|兰州|太原|石家庄|长春|南昌|海口|乌鲁木齐|呼和浩特|银川|西宁|拉萨|东北|华北|华东|华南|华中|西南|西北|华西|浙能|苏能|津|沪|渝|粤|苏|浙|鲁|豫|川|鄂|湘|皖|闽|赣|陕|晋|辽|吉|黑)/

const INTERN_BATCH_RE = /(?:实习|暑期实习|日常实习|寒假实习|转正实习|实习生)/
const FULLTIME_BATCH_RE = /(?:秋招|春招|正式批|提前批|补录|补招|校园招聘|校招|应届)/

const INDUSTRY_RULES = [
  [/^(?:游戏|文娱|影视|动漫|音乐|直播|短视频|互娱)$/, '游戏/文娱'],
  [/半导体|芯片|集成电路|微电子|电子|通信|通讯|光电|传感器|硬件/, '半导体/电子'],
  [/互联网|软件|计算机|信息|人工智能|AI|大模型|云计算|大数据|网络安全|IT/i, '互联网/软件'],
  [/游戏|文娱|影视|动漫|音乐|直播|短视频|互娱/, '游戏/文娱'],
  [/广告|传媒|媒体|出版|公关|新闻|文化/, '传媒/广告'],
  [/汽车|新能源车|整车|车企|智驾|自动驾驶|汽配/, '汽车'],
  [/医药|医疗|生物|制药|器械|大健康|生命科学|医院/, '医药'],
  [/金融|银行|证券|基金|保险|信托|期货|投行|资管|财务|会计/, '金融'],
  [/能源|电力|石油|石化|煤炭|核电|光伏|风电|储能|电网|燃气|新能源|水利/, '能源'],
  [/化工|材料|新材料|冶金|钢铁|有色|矿业|环保|纺织|造纸/, '化工/材料'],
  [/机械|制造|装备|自动化|机器人|工业|航空|航天|船舶|军工|重工|仪器|仪表|模具|建材/, '智能制造/装备'],
  [/物流|供应链|快递|航运|航空运输|铁路|交通|仓储|港口|海运/, '物流'],
  [/房产|房地产|建筑|工程|施工|物业|置业|土木|城建|规划/, '房地产'],
  [/家电|电器|消费电子|智能家居/, '家电'],
  [/家居|家具|建材家居|家装|照明|卫浴/, '家居/家具'],
  [/服装|服饰|鞋服|纺织服装|运动品牌|奢侈品/, '服装服饰'],
  [/化妆品|美妆|日化|护肤|个护/, '化妆品'],
  [/餐饮|茶饮|咖啡|酒旅|食品饮料|饮品/, '餐饮茶饮'],
  [/农牧|农业|食品|乳业|粮油|养殖|牧业|酒业|白酒|啤酒/, '农牧/食品'],
  [/快消|零售|商超|便利店|百货|消费品|贸易|批发/, '快消'],
  [/跨境|外贸|出海|进出口/, '跨境电商/外贸'],
  [/咨询|专业服务|律所|审计|检测|认证|人力资源|法律/, '专业服务/咨询'],
  [/教育|培训|高校|学校|科研|教培/, '教育'],
  [/酒店|文旅|旅游|航空旅游|景区|出行/, '酒店/文旅'],
  [/国企|央企|事业单位|政府|公共事业/, '央企国企'],
]

export function todayShanghai(nowMs = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date(nowMs))
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseDateStr(value) {
  if (!value) return ''
  const text = String(value).trim()
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return ''
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return validDate(normalized) ? normalized : ''
}

export function isBranchName(rawName) {
  const name = String(rawName || '').trim()
  if (!name) return false
  return BRANCH_MARKER_RE.test(name) || CONGLOMERATE_REGION_RE.test(name)
}

export function normalizeCompanyName(rawName, { preserveBranch = true } = {}) {
  let text = String(rawName || '').normalize('NFKC').trim()
  if (!text) return ''
  // Remove recruitment-campaign noise in parentheses or trailing text
  text = text
    .replace(/[（(][^）)]*(?:校招|秋招|春招|招聘|内推|202[5678]届|集团|有限合伙|原[^）)]*)[^）)]*[）)]/gi, '')
    .replace(/202[5678]届?(?:校园招聘|校招|秋招|春招|提前批|补录|补招|实习生?招聘|实习).*$/i, '')
    .replace(/(?:校园招聘|校招官网|招聘官网|校园|校招|秋招|春招|提前批|补录|微招聘|招聘)$/i, '')
    .replace(/\s+/g, '')

  // Remove standard Chinese corporate legal suffixes anywhere (so "招商银行股份有限公司泉州分行" -> "招商银行泉州分行")
  text = text
    .replace(/(?:控股)?(?:股份)?(?:有限|责任|合伙)(?:责任)?公司/g, '')
    .replace(/(?:股份|有限|责任)公司/g, '')
    .replace(/有限合伙企业$/g, '')

  // Only strip trailing "集团" for headquarters/non-branch names
  if (!preserveBranch || !isBranchName(rawName)) {
    text = text
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/集团$/, '')
  } else {
    text = text.replace(/[（()）]/g, '')
  }

  return text.toLowerCase().trim()
}

export function getRootDomain(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length >= 3 && MULTI_TLDS.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.')
  }
  return parts.length >= 2 ? parts.slice(-2).join('.') : parts.join('.')
}

export function extractFirstUrl(value) {
  if (!value) return ''
  const match = String(value).match(/https?:\/\/[^\s"'<>（）()\[\]｜|;；，,、。]+/)
  return match ? match[0].trim() : ''
}

export function extractPortalKey(rawUrl) {
  const urlStr = extractFirstUrl(rawUrl)
  if (!urlStr) return ''
  try {
    const parsed = new URL(urlStr)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    // Multi-tenant ATS platforms -> extract tenant ID specifically
    if (host.endsWith('mokahr.com')) {
      const m = parsed.pathname.match(/\/(?:campus_apply|campus-recruitment|social-recruitment|apply)\/([^/]+)/i)
      return m ? `ats:moka:${m[1].toLowerCase()}` : ''
    }
    if (host.endsWith('.jobs.feishu.cn')) {
      const sub = host.slice(0, -'.jobs.feishu.cn'.length)
      return sub && !['www', 'jobs'].includes(sub) ? `ats:feishu:${sub}` : ''
    }
    if (host.endsWith('hotjob.cn')) {
      const m = parsed.pathname.match(/\/(SU[0-9a-f]{16,})/i)
      return m ? `ats:hotjob:${m[1].toLowerCase()}` : ''
    }
    if (host.endsWith('.zhiye.com')) {
      const sub = host.slice(0, -'.zhiye.com'.length)
      return sub && !['www', 'campus', 'hr', 'app', 'jobs', 'm'].includes(sub) ? `ats:zhiye:${sub}` : ''
    }
    if (GENERIC_PLATFORM_HOSTS.test(host)) return ''
    const root = getRootDomain(host)
    if (!root || GENERIC_PLATFORM_HOSTS.test(root)) return ''
    return `dom:${root}`
  } catch {
    return ''
  }
}

export function shareCoreToken(nameA, nameB) {
  const a = normalizeCompanyName(nameA, { preserveBranch: false })
  const b = normalizeCompanyName(nameB, { preserveBranch: false })
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true
  for (let i = 0; i < a.length - 1; i += 1) {
    const bigram = a.slice(i, i + 2)
    if (/^[\u4e00-\u9fa5]{2}$/.test(bigram) && b.includes(bigram)) return true
  }
  const asciiWords = a.match(/[a-z]{3,}/g) || []
  return asciiWords.some((word) => b.includes(word))
}

export function portalRank(rawUrl) {
  const urlStr = extractFirstUrl(rawUrl)
  if (!urlStr) return 0
  try {
    const host = new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '')
    if (host.endsWith('.jobs.feishu.cn') || host.endsWith('mokahr.com') || host.endsWith('.zhiye.com') || host.endsWith('hotjob.cn')) {
      return 3
    }
    if (ANNOUNCEMENT_HOSTS.test(host)) return 1
    if (JOB_BOARD_HOSTS.test(host)) return 2
    return 3
  } catch {
    return 0
  }
}

export function normalizeEnt(rawEnt, companyName = '', industry = '') {
  const text = `${Array.isArray(rawEnt) ? rawEnt.join(',') : (rawEnt || '')}`.trim()
  if (/事业单位|高校|科研院所|研究所|医院|学院|大学/.test(text)) return '事业单位'
  if (/央企|国企|央国企|国有/.test(text)) return '央企国企'
  if (/外企|外资|合资/.test(text)) return '外企'
  if (/民企|民营|私企|上市|独角兽|初创/.test(text)) return '民企'
  const fallback = `${companyName} ${industry}`
  if (/大学|学院|研究院|研究所|医院|事业单位/.test(fallback) && !/科技|有限|股份/.test(companyName)) return '事业单位'
  if (/^(?:中国|国家|中核|中交|中建|中铁|中船|中航|中粮|中石油|中石化|国网|南网|华能|大唐|华电|三峡|人保|人寿)/.test(companyName) || /国企|央企/.test(industry)) {
    return '央企国企'
  }
  return ''
}

export function mapIndustryToCategory(rawIndustry, ent = '', companyName = '') {
  const text = Array.isArray(rawIndustry) ? rawIndustry.join('、') : String(rawIndustry || '')
  for (const [pattern, category] of INDUSTRY_RULES) {
    if (pattern.test(text)) return category
  }
  if (ent === '央企国企' || ent === '事业单位') return '央企国企'
  for (const [pattern, category] of INDUSTRY_RULES) {
    if (pattern.test(companyName)) return category
  }
  return '其他'
}

function asString(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean).join('、')
  return value == null ? '' : String(value).trim()
}

function cleanCompanyDisplayName(rawName) {
  return String(rawName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/202[5678]届?(?:校园招聘|校招|秋招|春招|提前批|补录|补招|实习生?招聘).*$/i, '')
    .replace(/(?:2027|27届)?(?:校园招聘|校招官网|招聘官网)$/i, '')
    .trim()
}

function splitRoleTokens(text) {
  return String(text || '')
    .split(/[、，,;/；|｜\n]+/)
    .map((part) => part.trim().replace(/等+$/, '').trim())
    .filter((part) => part && part.length <= 40 && !/^筛选前必看/.test(part))
}

function mergeRoles(existing, incoming, maxLength = 120) {
  const seen = new Set()
  const merged = []
  let truncated = false
  for (const token of [...splitRoleTokens(existing), ...splitRoleTokens(incoming)]) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(token)
  }
  let out = ''
  for (const token of merged) {
    const next = out ? `${out}、${token}` : token
    if (next.length > maxLength && out) {
      truncated = true
      break
    }
    out = next
  }
  return truncated ? `${out}等` : out
}

function isTargetCohort2027(cohort, program = '', batch = '') {
  const coh = String(cohort || '').trim()
  if (/2027|27届/.test(coh)) return true
  if (coh && !/不限/.test(coh)) return false
  return /2027|27届/.test(`${program} ${batch}`)
}

function detectInternship(batchText, titleText = '', programText = '') {
  const b = String(batchText || '')
  const hasInternBatch = INTERN_BATCH_RE.test(b)
  const hasFulltimeBatch = FULLTIME_BATCH_RE.test(b)
  if (hasInternBatch && !hasFulltimeBatch) {
    const subMatch = b.match(/(暑期实习|日常实习|寒假实习|转正实习)/)
    return { isIntern: true, label: subMatch ? subMatch[1] : '实习' }
  }
  if (!b) {
    const combined = `${titleText} ${programText}`
    if (INTERN_BATCH_RE.test(combined) && !FULLTIME_BATCH_RE.test(combined)) {
      const subMatch = combined.match(/(暑期实习|日常实习|寒假实习|转正实习)/)
      return { isIntern: true, label: subMatch ? subMatch[1] : '实习' }
    }
  }
  return { isIntern: false, label: '' }
}

function normalizeChloeRecord(raw, today) {
  if (!raw || typeof raw !== 'object') return null
  const company = cleanCompanyDisplayName(raw.company)
  if (!company || JUNK_COMPANY_RE.test(company)) return null

  const cohort = asString(raw.cohort)
  const batch = asString(raw.batch)
  const program = asString(raw.program)
  if (!isTargetCohort2027(cohort, program, batch)) return null

  const deadline = parseDateStr(raw.deadline)
  if (deadline && deadline < today) return null

  const applyUrl = extractFirstUrl(raw.applyUrl)
  const announcementUrl = extractFirstUrl(raw.announcementUrl)
  const sourceUrl = extractFirstUrl(raw.sourceUrl)
  const portal = applyUrl || announcementUrl || sourceUrl
  const date = parseDateStr(raw.updatedAt)
  const roles = asString(raw.title) || asString(raw.family)
  const cities = Array.isArray(raw.cities) ? raw.cities.filter(Boolean).slice(0, 6).join('/') : ''
  const intern = detectInternship(batch, roles, program)
  const ent = normalizeEnt('', company, asString(raw.industry))

  return {
    sourceKey: 'chloe',
    sourceLabel: raw.source ? `秋招信库(${raw.source})` : '秋招信库',
    company,
    date,
    deadline,
    roles,
    portal,
    announcementUrl: announcementUrl && announcementUrl !== portal ? announcementUrl : '',
    industry: asString(raw.industry),
    ent,
    cohort: /2027|27届/.test(cohort) ? cohort : '2027届',
    batch,
    cities,
    examFree: false,
    isIntern: intern.isIntern,
    internLabel: intern.label,
    extraNote: '',
  }
}

function normalizeHuRecord(raw, today) {
  if (!raw || typeof raw !== 'object') return null
  const company = cleanCompanyDisplayName(raw['公司名称'])
  if (!company || JUNK_COMPANY_RE.test(company)) return null

  const cohort = asString(raw['招聘对象'])
  const batch = asString(raw['批次'])
  if (!isTargetCohort2027(cohort, '', batch)) return null

  const deadline = parseDateStr(raw['截止时间'])
  if (deadline && deadline < today) return null

  const applyUrl = extractFirstUrl(raw['投递方式'])
  const announcementUrl = extractFirstUrl(raw['官方公告'])
  const portal = portalRank(applyUrl) >= portalRank(announcementUrl) ? (applyUrl || announcementUrl) : announcementUrl
  const date = parseDateStr(raw['更新时间'])
  const roles = asString(raw['招聘岗位'])
  const locations = asString(raw['工作地点']) || asString(raw['工作地点文本'])
  const cities = locations ? locations.split(/[、，,/]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6).join('/') : ''
  const examText = asString(raw['是否需要笔试'])
  const examFree = /免笔试/.test(examText)
  const intern = detectInternship(batch, roles, '')
  const ent = normalizeEnt(raw['企业性质'], company, asString(raw['行业大类']))

  return {
    sourceKey: 'hu',
    sourceLabel: '飞书校招表',
    company,
    date,
    deadline,
    roles,
    portal,
    announcementUrl: announcementUrl && announcementUrl !== portal ? announcementUrl : '',
    industry: asString(raw['行业大类']),
    ent,
    cohort: cohort || '2027届',
    batch,
    cities,
    examFree,
    isIntern: intern.isIntern,
    internLabel: intern.label,
    extraNote: raw['备注/提示'] && raw['备注/提示'].trim() !== company ? String(raw['备注/提示']).trim().slice(0, 80) : '',
  }
}

function buildEnrichedNote(state) {
  const tags = []
  if (state.internOnly) {
    tags.push(state.internLabel && state.internLabel !== '实习' ? `【纯实习·${state.internLabel}】` : '【纯实习】')
  } else if (state.hasIntern && !state.isBaseline) {
    tags.push('【含实习】')
  }
  if (state.batches.size) {
    const batchHighlights = [...state.batches].filter((b) => /补录|补招|春招|提前批/.test(b))
    if (batchHighlights.length) tags.push(`[${batchHighlights.slice(0, 2).join('/')}]`)
  }
  if (state.examFree) tags.push('[含免笔试]')
  if (state.deadline) tags.push(`截止：${state.deadline}`)
  if (state.cities) tags.push(`地点：${state.cities}`)

  const prefix = tags.join(' ')
  const baseNote = state.baseNote || ''
  if (!prefix) return baseNote
  if (!baseNote) return prefix
  if (baseNote.includes(prefix)) return baseNote
  // Keep baseline note intact while appending fresh metadata concisely
  return state.internOnly ? `${prefix} ${baseNote}` : `${baseNote}｜${prefix}`
}

export function mergeCatalogs({
  baseline = null,
  previousCatalog = null,
  protectedCompanies = new Set(),
  chloeRecords = [],
  huRecords = [],
  today = todayShanghai(),
  aliases = DEFAULT_ALIASES,
} = {}) {
  const protectedSet = protectedCompanies instanceof Set ? protectedCompanies : new Set(protectedCompanies || [])
  const normalizedAliases = new Map()
  for (const [alias, canonical] of Object.entries(aliases || {})) {
    const key = normalizeCompanyName(alias, { preserveBranch: false })
    if (key) normalizedAliases.set(key, canonical)
  }

  // Canonical company records keyed by exact `company` string
  const states = new Map()
  const exactIndex = new Map()      // exact lowercase trimmed name -> canonical company
  const normIndex = new Map()       // L2 normalized name (branch-aware) -> canonical company
  const portalIndex = new Map()     // L3 portalKey -> canonical company (headquarters only)

  function registerIndex(canonicalName, portal) {
    exactIndex.set(canonicalName.trim().toLowerCase(), canonicalName)
    const nk = normalizeCompanyName(canonicalName, { preserveBranch: true })
    if (nk && !normIndex.has(nk)) normIndex.set(nk, canonicalName)
    if (!isBranchName(canonicalName)) {
      const pk = extractPortalKey(portal)
      if (pk && !portalIndex.has(pk)) portalIndex.set(pk, canonicalName)
    }
  }

  // Step 1: Seed immutable baseline (100% locked company keys)
  const baselineItems = Array.isArray(baseline?.data) ? baseline.data : []
  const baselineCats = baseline?.cats && typeof baseline.cats === 'object' ? baseline.cats : {}
  for (const item of baselineItems) {
    if (!item || typeof item.company !== 'string' || !item.company.trim()) continue
    const company = item.company
    const cat = baselineCats[company] || item.cat || '未分类'
    states.set(company, {
      company,
      cat,
      date: parseDateStr(item.date) || '',
      roles: item.roles || '',
      portal: item.portal || '',
      baseNote: item.note || '',
      source: item.source || '',
      ent: item.ent || '民企',
      cohort: item.cohort || '2027届',
      isBaseline: true,
      hasFulltime: true,
      hasIntern: false,
      internOnly: Boolean(item.internOnly),
      internLabel: '',
      deadline: '',
      cities: '',
      examFree: false,
      batches: new Set(),
      sources: new Set(item.source ? [item.source] : []),
    })
    registerIndex(company, item.portal)
  }

  // Step 2: Normalize & filter external dual-source records
  const chloeRawList = Array.isArray(chloeRecords) ? chloeRecords : (chloeRecords?.jobs || [])
  const huRawList = Array.isArray(huRecords) ? huRecords : (huRecords?.data || huRecords?.jobs || [])
  const incoming = []
  for (const raw of chloeRawList) {
    const rec = normalizeChloeRecord(raw, today)
    if (rec) incoming.push(rec)
  }
  for (const raw of huRawList) {
    const rec = normalizeHuRecord(raw, today)
    if (rec) incoming.push(rec)
  }

  // Sort incoming so higher-quality / newer / full-time entries establish canonical display names first
  incoming.sort((a, b) => {
    const fulltimeDiff = Number(a.isIntern) - Number(b.isIntern)
    if (fulltimeDiff) return fulltimeDiff
    const dateDiff = String(b.date || '').localeCompare(String(a.date || ''))
    if (dateDiff) return dateDiff
    return portalRank(b.portal) - portalRank(a.portal)
  })

  const stats = {
    baselineCount: states.size,
    chloeKept: incoming.filter((r) => r.sourceKey === 'chloe').length,
    huKept: incoming.filter((r) => r.sourceKey === 'hu').length,
    matchedBaseline: 0,
    matchedL1Exact: 0,
    matchedL2Norm: 0,
    matchedL3Portal: 0,
    matchedL4Alias: 0,
    netNew: 0,
    internOnlyCount: 0,
    protectedPreserved: 0,
  }

  function resolveCanonical(rec) {
    const exactKey = rec.company.trim().toLowerCase()
    if (exactIndex.has(exactKey)) {
      return { canonical: exactIndex.get(exactKey), layer: 'L1' }
    }

    const branch = isBranchName(rec.company)

    // L4 explicit brand alias (non-branch only, and only if target exists in states)
    if (!branch) {
      const plainNorm = normalizeCompanyName(rec.company, { preserveBranch: false })
      const aliasTarget = normalizedAliases.get(plainNorm)
      if (aliasTarget && states.has(aliasTarget)) {
        return { canonical: aliasTarget, layer: 'L4' }
      }
    }

    // L2 branch-aware entity normalization
    const nk = normalizeCompanyName(rec.company, { preserveBranch: true })
    if (nk && normIndex.has(nk)) {
      const target = normIndex.get(nk)
      // Extra guard: never merge a branch into a non-branch or vice versa
      if (isBranchName(target) === branch) {
        return { canonical: target, layer: 'L2' }
      }
    }

    // L3 independent portal/ATS tenant + lexical token dual verification (non-branch only)
    if (!branch) {
      const pk = extractPortalKey(rec.portal)
      if (pk && portalIndex.has(pk)) {
        const target = portalIndex.get(pk)
        if (!isBranchName(target) && shareCoreToken(rec.company, target)) {
          return { canonical: target, layer: 'L3' }
        }
      }
    }

    return null
  }

  // Step 3: Merge all incoming records into canonical states
  for (const rec of incoming) {
    const match = resolveCanonical(rec)
    if (match) {
      const state = states.get(match.canonical)
      if (state.isBaseline) stats.matchedBaseline += 1
      if (match.layer === 'L1') stats.matchedL1Exact += 1
      if (match.layer === 'L2') stats.matchedL2Norm += 1
      if (match.layer === 'L3') stats.matchedL3Portal += 1
      if (match.layer === 'L4') stats.matchedL4Alias += 1

      // Complementary field upgrades
      if (rec.date && (!state.date || rec.date > state.date)) {
        state.date = rec.date
      }
      if (rec.portal) {
        const currentRank = portalRank(state.portal)
        const nextRank = portalRank(rec.portal)
        if (nextRank > currentRank || (nextRank === currentRank && !state.isBaseline && rec.date && rec.date >= state.date)) {
          state.portal = rec.portal
        }
      }
      if (rec.ent && (!state.ent || (state.ent === '民企' && rec.ent !== '民企'))) {
        state.ent = rec.ent
      }
      if (rec.roles) {
        state.roles = mergeRoles(state.roles, rec.roles)
      }
      if (rec.deadline && (!state.deadline || rec.deadline > state.deadline)) {
        state.deadline = rec.deadline
      }
      if (rec.cities && !state.cities) {
        state.cities = rec.cities
      }
      if (rec.examFree) state.examFree = true
      if (rec.batch) state.batches.add(rec.batch)
      if (rec.isIntern) {
        state.hasIntern = true
        if (!state.internLabel && rec.internLabel) state.internLabel = rec.internLabel
      } else {
        state.hasFulltime = true
        state.internOnly = false
      }
      if (!state.cat || state.cat === '其他' || state.cat === '未分类') {
        const mapped = mapIndustryToCategory(rec.industry, state.ent, state.company)
        if (mapped && mapped !== '其他') state.cat = mapped
      }
      state.sources.add(rec.sourceLabel)
      if (!isBranchName(state.company)) {
        const pk = extractPortalKey(state.portal)
        if (pk && !portalIndex.has(pk)) portalIndex.set(pk, state.company)
      }
      continue
    }

    // Net new company
    stats.netNew += 1
    const ent = rec.ent || '民企'
    const cat = mapIndustryToCategory(rec.industry, ent, rec.company)
    const state = {
      company: rec.company,
      cat,
      date: rec.date || '',
      roles: mergeRoles('', rec.roles),
      portal: rec.portal || '',
      baseNote: rec.extraNote || '',
      source: '',
      ent,
      cohort: rec.cohort || '2027届',
      isBaseline: false,
      hasFulltime: !rec.isIntern,
      hasIntern: rec.isIntern,
      internOnly: rec.isIntern,
      internLabel: rec.internLabel || '',
      deadline: rec.deadline || '',
      cities: rec.cities || '',
      examFree: rec.examFree,
      batches: new Set(rec.batch ? [rec.batch] : []),
      sources: new Set([rec.sourceLabel]),
    }
    states.set(rec.company, state)
    registerIndex(rec.company, rec.portal)
  }

  // Step 4: Guarantee 100% preservation of any company with existing SQLite progress
  const prevByCompany = new Map(
    (Array.isArray(previousCatalog?.data) ? previousCatalog.data : [])
      .filter((item) => item && typeof item.company === 'string')
      .map((item) => [item.company, item]),
  )
  const prevCats = previousCatalog?.cats && typeof previousCatalog.cats === 'object' ? previousCatalog.cats : {}

  for (const company of protectedSet) {
    if (!company || states.has(company)) continue
    stats.protectedPreserved += 1
    const prev = prevByCompany.get(company)
    states.set(company, {
      company,
      cat: prevCats[company] || prev?.cat || '其他',
      date: parseDateStr(prev?.date) || '',
      roles: prev?.roles || '',
      portal: prev?.portal || '',
      baseNote: prev?.note || '已保留历史投递记录',
      source: prev?.source || '历史进度保护',
      ent: prev?.ent || '民企',
      cohort: prev?.cohort || '2027届',
      isBaseline: false,
      hasFulltime: !prev?.internOnly,
      hasIntern: Boolean(prev?.internOnly),
      internOnly: Boolean(prev?.internOnly),
      internLabel: '',
      deadline: '',
      cities: '',
      examFree: false,
      batches: new Set(),
      sources: new Set(prev?.source ? [prev.source] : ['历史进度保护']),
    })
  }

  // Step 5: Assemble final normalized catalog matching existing data.json contract
  const data = []
  const cats = {}
  let latestItemDate = ''

  for (const state of states.values()) {
    const internOnly = Boolean(state.internOnly && !state.hasFulltime && !state.isBaseline)
    state.internOnly = internOnly
    if (internOnly) stats.internOnlyCount += 1

    const sourceList = [...state.sources].filter(Boolean)
    const sourceText = sourceList.length > 3 ? `${sourceList.slice(0, 3).join('；')}等` : sourceList.join('；')
    const entry = {
      company: state.company,
      cat: state.cat || '其他',
      date: state.date || '',
      roles: state.roles || '',
      note: buildEnrichedNote(state),
      portal: state.portal || '',
      source: sourceText,
      ent: state.ent || '民企',
      cohort: internOnly ? `${state.cohort || '2027届'}（纯实习）` : (state.cohort || '2027届'),
      ...(internOnly ? { internOnly: true } : {}),
    }
    if (entry.date && entry.date > latestItemDate) latestItemDate = entry.date
    data.push(entry)
    cats[entry.company] = entry.cat
  }

  // Sort by date descending, then company name ascending for deterministic diffs
  data.sort((a, b) => {
    const dateDiff = String(b.date || '').localeCompare(String(a.date || ''))
    if (dateDiff) return dateDiff
    return a.company.localeCompare(b.company, 'zh-CN')
  })

  const updated = [today, latestItemDate].filter(validDate).sort().at(-1) || today
  const revDate = updated.replace(/-/g, '')
  const catalog = {
    rev: `${revDate}-dual-${data.length}`,
    updated,
    count: data.length,
    data,
    cats,
  }

  return { catalog, stats }
}

async function fetchJsonWithFallback(urls, { timeoutMs = 15_000, cacheBust = Date.now(), fetchImpl = fetch, logger = console } = {}) {
  let lastError = null
  for (const url of urls) {
    try {
      const separator = url.includes('?') ? '&' : '?'
      const response = await fetchImpl(`${url}${separator}t=${cacheBust}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      logger?.warn?.(`Failed to fetch dual-source data from ${url}:`, error.message)
    }
  }
  throw lastError ?? new Error('No source URLs configured')
}

export async function fetchAndMergeDualSources({
  baseline = null,
  previousCatalog = null,
  protectedCompanies = new Set(),
  sources = DEFAULT_DUAL_SOURCES,
  timeoutMs = 15_000,
  now = Date.now,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const cacheBust = now()
  const today = todayShanghai(cacheBust)
  const sourceEntries = Object.entries(sources || {}).filter(([, urls]) => Array.isArray(urls) && urls.length)
  if (!sourceEntries.length) return null

  const settled = await Promise.allSettled(
    sourceEntries.map(async ([key, urls]) => [
      key,
      await fetchJsonWithFallback(urls, { timeoutMs, cacheBust, fetchImpl, logger }),
    ]),
  )

  const fetched = {}
  const activeSources = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const [key, payload] = result.value
      fetched[key] = payload
      activeSources.push(key)
    }
  }

  // If BOTH external sources failed, return null so caller cleanly falls back to local data.json
  if (!activeSources.length) return null

  const { catalog, stats } = mergeCatalogs({
    baseline,
    previousCatalog,
    protectedCompanies,
    chloeRecords: fetched.chloe || [],
    huRecords: fetched.hu || [],
    today,
  })

  return { catalog, stats, activeSources }
}
