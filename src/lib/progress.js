export const STATUSES = ['已投递', '笔试', 'AI面试', '面试', '流程结束']
export const END_STAGES = ['已投递', '笔试', 'AI面试', '面试']
export const END_LABEL = { 已投递: '初筛/已投递', 笔试: '笔试', AI面试: 'AI面试', 面试: '面试' }

export function todayStr(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function emptyRecord() {
  return { stage: '', dates: {}, updatedAt: '', endStage: '', endDate: '' }
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : ''
}

export function normalizeRecord(value) {
  if (typeof value === 'string') {
    if (!STATUSES.includes(value)) return null
    const date = todayStr()
    return { stage: value, dates: { [value]: date }, updatedAt: date, endStage: '', endDate: '' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!['stage', 'dates', 'updatedAt', 'endStage', 'endDate'].some((field) => Object.hasOwn(value, field))) return null
  const dates = {}
  for (const stage of STATUSES) {
    const date = normalizeDate(value.dates?.[stage])
    if (date) dates[stage] = date
  }
  const endStage = END_STAGES.includes(value.endStage) ? value.endStage : ''
  return {
    stage: STATUSES.includes(value.stage) ? value.stage : '',
    dates,
    updatedAt: normalizeDate(value.updatedAt),
    endStage,
    endDate: endStage ? normalizeDate(value.endDate) : '',
  }
}

export function normalizeRecords(value) {
  const records = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return records
  for (const [company, candidate] of Object.entries(value)) {
    const record = normalizeRecord(candidate)
    if (isValidCompany(company) && record) records[company] = record
  }
  return records
}

export function isValidCompany(company) {
  return typeof company === 'string' && Boolean(company.trim()) && company.length <= 300 && !/[\u0000-\u001f\u007f]/.test(company)
}

export function recordsEqual(first, second) {
  return JSON.stringify(normalizeRecord(first)) === JSON.stringify(normalizeRecord(second))
}
