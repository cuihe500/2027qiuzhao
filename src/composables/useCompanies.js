import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
function latestDate(value) {
  if (!value) return ''
  const revDate = String(value.rev || '').match(/^(\d{4})(\d{2})(\d{2})/)
  const dates = [
    value.updated,
    revDate ? `${revDate[1]}-${revDate[2]}-${revDate[3]}` : '',
    ...(Array.isArray(value.data) ? value.data.map(company => company?.date) : []),
  ].filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
  return dates.sort().at(-1) || value.updated || ''
}

export function useCompanies() {
  const payload = shallowRef(null)
  const loading = ref(false)
  const error = ref('')
  const checkedAt = ref('')
  let controller

  async function refresh(force = false) {
    if (loading.value) return
    loading.value = true
    error.value = ''
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), force ? 35000 : 15000)
    try {
      const query = force ? `refresh=1&t=${Date.now()}` : `t=${Date.now()}`
      const response = await fetch(`/data.json?${query}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`读取数据失败（HTTP ${response.status}）`)
      const latest = await response.json()
      if (!latest || !Array.isArray(latest.data) || !latest.cats ||
          typeof latest.cats !== 'object' || Array.isArray(latest.cats) ||
          !latest.data.every(company => company && typeof company.company === 'string' && company.company.trim())) {
        throw new Error('data.json 格式不正确，请检查数据文件')
      }
      if (new Set(latest.data.map(company => company.company)).size !== latest.data.length) {
        throw new Error('data.json 包含重复公司名称，请检查数据文件')
      }
      payload.value = latest
      checkedAt.value = new Date().toLocaleTimeString('zh-CN')
    } catch (cause) {
      error.value = cause.name === 'AbortError' ? '读取数据超时，请重试' : `无法加载最新公司信息：${cause.message}`
    } finally {
      clearTimeout(timeout)
      loading.value = false
    }
  }

  onMounted(refresh)
  onBeforeUnmount(() => controller?.abort())

  return {
    companies: computed(() => payload.value?.data || []),
    categories: computed(() => payload.value?.cats || {}),
    revision: computed(() => payload.value?.rev || ''),
    updated: computed(() => latestDate(payload.value)),
    loading, error, checkedAt, refresh,
  }
}
