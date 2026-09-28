<script setup>
import { computed, ref, watch } from 'vue'
import CompanyTable from './components/CompanyTable.vue'
import InterviewAssistant from './components/InterviewAssistant.vue'
import LoginPanel from './components/LoginPanel.vue'
import SyncPanel from './components/SyncPanel.vue'
import { useCompanies } from './composables/useCompanies.js'
import { useProgress } from './composables/useProgress.js'
import { DIRECTIONS, csvCell, downloadFile, searchText, splitTerms } from './lib/catalog.js'
import { END_LABEL, STATUSES, emptyRecord, normalizeRecords, todayStr } from './lib/progress.js'

const { companies, categories, revision, updated, loading, error, checkedAt, refresh } = useCompanies()
const sync = useProgress()
const { progress } = sync
const query = ref('')
const directionQuery = ref('')
const selectedDirections = ref([])
const category = ref('全部')
const stageFilter = ref('全部')
const sort = ref('date-desc')
const page = ref(1)
const pageSize = ref(50)
const notice = ref('')
const restoreInput = ref(null)

const catalog = computed(() => companies.value.map(company => ({
  company,
  category: categories.value[company.company] || company.cat || '未分类',
  name: searchText(company.company),
  text: searchText([company.company, company.roles, company.note, categories.value[company.company] || company.cat].join(' ')),
})))
const stageCounts = computed(() => {
  const counts = Object.fromEntries(['全部', '未投递', ...STATUSES].map(stage => [stage, 0]))
  counts['全部'] = companies.value.length
  for (const company of companies.value) counts[progress.value[company.company]?.stage || '未投递']++
  return counts
})
const categoryCounts = computed(() => {
  const counts = new Map()
  for (const entry of catalog.value) counts.set(entry.category, (counts.get(entry.category) || 0) + 1)
  return [['全部', companies.value.length], ...counts.entries()]
})
const directionCounts = computed(() => DIRECTIONS.map(([label, terms]) => ({
  label,
  count: catalog.value.filter(entry => terms.some(term => entry.text.includes(searchText(term)))).length,
})))
const filtered = computed(() => {
  const queryTerms = splitTerms(query.value)
  const directionTerms = splitTerms(directionQuery.value)
  const entries = catalog.value.filter(entry => {
    const stage = progress.value[entry.company.company]?.stage || '未投递'
    return (stageFilter.value === '全部' || stage === stageFilter.value) &&
      (category.value === '全部' || entry.category === category.value) &&
      queryTerms.every(term => entry.text.includes(term)) &&
      directionTerms.every(term => entry.text.includes(term)) &&
      selectedDirections.value.every(label => DIRECTIONS.find(direction => direction[0] === label)[1].some(term => entry.text.includes(searchText(term))))
  })
  const [field, order] = sort.value.split('-')
  entries.sort((left, right) => {
    if (queryTerms.length) {
      const nameRank = Number(queryTerms.every(term => right.name.includes(term))) - Number(queryTerms.every(term => left.name.includes(term)))
      if (nameRank) return nameRank
    }
    let comparison = 0
    if (field === 'date') comparison = String(left.company.date || '').localeCompare(String(right.company.date || ''))
    if (field === 'company') comparison = left.company.company.localeCompare(right.company.company, 'zh-CN')
    if (field === 'stage') comparison = STATUSES.indexOf(progress.value[left.company.company]?.stage) - STATUSES.indexOf(progress.value[right.company.company]?.stage)
    return (order === 'desc' ? -comparison : comparison) || left.company.company.localeCompare(right.company.company, 'zh-CN')
  })
  return entries.map(entry => entry.company)
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const offset = computed(() => (page.value - 1) * pageSize.value)
const visibleCompanies = computed(() => filtered.value.slice(offset.value, offset.value + pageSize.value))
const suggestions = computed(() => query.value.trim() ? catalog.value.filter(entry => entry.name.includes(searchText(query.value))).slice(0, 10) : [])

watch([query, directionQuery, selectedDirections, category, stageFilter, sort, pageSize], () => { page.value = 1 })
watch(pageCount, count => { page.value = Math.min(page.value, count) })

function toggleDirection(label) {
  selectedDirections.value = selectedDirections.value.includes(label)
    ? selectedDirections.value.filter(value => value !== label)
    : [...selectedDirections.value, label]
}

function clearFilters() {
  query.value = ''
  directionQuery.value = ''
  selectedDirections.value = []
  category.value = '全部'
  stageFilter.value = '全部'
}

function updateStage(company, stage) {
  if (!stage) return sync.setRecord(company, null)
  const previous = progress.value[company] || emptyRecord()
  sync.setRecord(company, { ...previous, stage, dates: { ...previous.dates, [stage]: todayStr() }, updatedAt: todayStr() })
}

function updateDate(company, stage) {
  const previous = progress.value[company] || emptyRecord()
  sync.setRecord(company, { ...previous, dates: { ...previous.dates, [stage]: todayStr() }, updatedAt: todayStr() })
}

function updateEndStage(company, endStage) {
  const previous = progress.value[company] || emptyRecord()
  sync.setRecord(company, { ...previous, endStage, endDate: endStage ? todayStr() : '', updatedAt: todayStr() })
}

function exportCsv() {
  const rows = [
    ['序号', '公司', '公司分类', '企业性质', '届别', '开启秋招时间', '相关岗位方向', '备注', '投递入口/投递方式', '信息来源', '投递进度', ...STATUSES.map(stage => `${stage}日期`), '流程结束阶段', '最近变更'],
    ...filtered.value.map((company, index) => {
      const record = progress.value[company.company] || emptyRecord()
      return [index + 1, company.company, categories.value[company.company] || company.cat, company.ent, company.cohort, company.date, company.roles, company.note, company.portal, company.source, record.stage || '未填写', ...STATUSES.map(stage => record.dates[stage]), END_LABEL[record.endStage] || '', record.updatedAt]
    }),
  ]
  downloadFile('2027届秋招投递进度.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
}

function backup() {
  downloadFile('qiuzhao-progress.json', JSON.stringify(progress.value, null, 2), 'application/json')
}

async function restore(event) {
  const file = event.target.files[0]
  if (!file) return
  const user = sync.user.value
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('备份文件不能超过 5 MB')
    const raw = JSON.parse(await file.text())
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('请选择进度备份 JSON 文件')
    const restored = normalizeRecords(raw)
    const count = Object.keys(restored).length
    if (!count && Object.keys(raw).length) throw new Error('备份文件中没有有效的投递进度')
    if (!user || sync.user.value !== user) throw new Error('登录状态已变化，请重新选择备份文件')
    if (count && !window.confirm(`将合并 ${count} 家公司的进度，同名公司使用备份中的记录，是否继续？`)) return
    if (count) sync.importRecords(restored)
    const skipped = Object.keys(raw).length - count
    notice.value = `已恢复 ${count} 家公司的进度，将自动同步。${skipped ? `已跳过 ${skipped} 条无效记录。` : ''}`
  } catch (cause) {
    notice.value = `恢复失败：${cause.message}`
  } finally {
    event.target.value = ''
  }
}
</script>

<template>
  <LoginPanel v-if="!sync.authenticated.value" :auth="sync" />
  <main v-else class="page">
    <header class="hero">
      <div class="hero-heading"><span class="eyebrow">CAMPUS RECRUITMENT / 2027</span><span class="hero-badge">秋招进行时</span></div>
      <h1>2027届秋招信息汇总</h1>
      <p>发现适合你的岗位，记录每一步求职进展。</p>
      <p v-if="checkedAt" class="hero-meta">数据截至 {{ updated || '待确认' }} · 收录 {{ companies.length }} 家公司 · 修订 {{ revision || '未标注' }}</p>
      <p v-else class="hero-meta">{{ loading ? '正在读取最新公司信息…' : '等待加载公司信息' }}</p>
    </header>

    <SyncPanel :sync="sync" />
    <p v-if="sync.storageError.value" class="notice error" role="alert">{{ sync.storageError.value }}</p>

    <section class="filter-panel" aria-label="筛选公司">
      <div class="filter-group">
        <h2>投递进度</h2>
        <div class="chips stats" role="group" aria-label="按投递进度筛选">
          <button v-for="(count, stage) in stageCounts" :key="stage" type="button" :class="['chip', { active: stageFilter === stage }]" :aria-pressed="stageFilter === stage" @click="stageFilter = stage">{{ stage }} <span>{{ count }}</span></button>
        </div>
      </div>
      <div class="filter-group">
        <h2>公司分类</h2>
        <div class="chips" role="group" aria-label="按公司分类筛选">
          <button v-for="[label, count] in categoryCounts" :key="label" type="button" :class="['chip', { active: category === label }]" :aria-pressed="category === label" @click="category = label">{{ label }} <span>{{ count }}</span></button>
        </div>
      </div>
      <div class="filter-group">
        <h2>岗位方向 <span class="muted">多选取交集</span></h2>
        <div class="chips" role="group" aria-label="按岗位方向筛选">
          <button class="chip" :class="{ active: !selectedDirections.length }" type="button" :aria-pressed="!selectedDirections.length" @click="selectedDirections = []">全部</button>
          <button v-for="direction in directionCounts" :key="direction.label" type="button" :class="['chip', { active: selectedDirections.includes(direction.label) }]" :aria-pressed="selectedDirections.includes(direction.label)" @click="toggleDirection(direction.label)">{{ direction.label }} <span>{{ direction.count }}</span></button>
        </div>
      </div>
      <label class="direction-input">我的求职方向<input v-model="directionQuery" placeholder="例如：财务 会计、人力 行政、法务…" aria-label="自定义岗位方向"><button v-if="directionQuery" class="btn" type="button" @click="directionQuery = ''">清除方向</button></label>
    </section>

    <section class="results-panel" aria-label="公司列表">
      <div class="toolbar">
        <label class="search-field"><span class="sr-only">搜索公司或岗位</span><input v-model="query" list="company-suggestions" type="search" placeholder="搜索公司、岗位或关键词…" aria-label="搜索公司或岗位"><datalist id="company-suggestions"><option v-for="entry in suggestions" :key="entry.company.company" :value="entry.company.company" /></datalist></label>
        <label class="sort-field"><span class="sr-only">排序方式</span><select v-model="sort" aria-label="排序方式"><option value="date-desc">最新开放优先</option><option value="date-asc">最早开放优先</option><option value="company-asc">公司名称</option><option value="stage-desc">投递进度优先</option></select></label>
        <button class="btn" type="button" @click="clearFilters">重置筛选</button>
        <button class="btn" type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '检查更新' }}</button>
        <button class="btn primary" type="button" :disabled="!filtered.length" @click="exportCsv">导出 CSV</button>
        <InterviewAssistant :companies="companies" :categories="categories" />
      </div>
      <div class="result-meta" role="status"><span>符合条件 <strong>{{ filtered.length }}</strong> 家 / 共 {{ companies.length }} 家</span><span v-if="checkedAt" class="muted">最近读取 {{ checkedAt }}</span></div>
      <div v-if="error" class="notice error" role="alert">{{ error }}<span v-if="checkedAt">；当前显示上次成功读取的数据。</span><button class="btn" type="button" :disabled="loading" @click="refresh">重试</button></div>
      <p v-if="loading && !checkedAt" class="empty" role="status">正在加载最新 data.json…</p>
      <CompanyTable v-else-if="checkedAt" :companies="visibleCompanies" :categories="categories" :progress="progress" :offset="offset" @stage="updateStage" @date="updateDate" @end-stage="updateEndStage" />
      <nav v-if="checkedAt" class="pagination" aria-label="表格分页">
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <label>每页 <select v-model.number="pageSize" aria-label="每页公司数"><option :value="50">50</option><option :value="100">100</option><option :value="200">200</option></select> 家</label>
        <button class="btn" type="button" :disabled="page <= 1" @click="page--">上一页</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="page++">下一页</button>
      </nav>
    </section>

    <footer>
      <p>信息以公司官方招聘公告为准。修改进度会自动记录当天日期，点击时间线可更新日期。</p>
      <div class="footer-actions"><button class="text-button" type="button" @click="backup">备份进度</button><button class="text-button" type="button" @click="restoreInput.click()">恢复进度</button><input ref="restoreInput" type="file" accept=".json,application/json" hidden @change="restore"></div>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    </footer>
  </main>
</template>
