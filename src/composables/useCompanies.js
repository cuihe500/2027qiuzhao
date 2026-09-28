import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

export function useCompanies() {
  const payload = shallowRef(null)
  const loading = ref(false)
  const error = ref('')
  const checkedAt = ref('')
  let controller

  async function refresh() {
    if (loading.value) return
    loading.value = true
    error.value = ''
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/data.json?t=${Date.now()}`, {
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
    updated: computed(() => payload.value?.updated || ''),
    loading, error, checkedAt, refresh,
  }
}
