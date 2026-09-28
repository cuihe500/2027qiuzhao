<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  companies: { type: Array, default: () => [] },
  categories: { type: Object, default: () => ({}) },
})

const assistantRoot = ref(null)
const assistantMarkup = ref('')
const loading = ref(false)
const error = ref('')
let controller = null
let disposed = false

async function openAssistant() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (!controller) {
      const [markupModule, assistantModule] = await Promise.all([
        import('../legacy/interview.html?raw'),
        import('../legacy/interview.js'),
      ])
      if (disposed) return
      assistantMarkup.value = markupModule.default
      await nextTick()
      if (disposed) return
      controller = assistantModule.initializeInterviewAssistant(assistantRoot.value, {
        getCompanies: () => props.companies,
        getCategories: () => props.categories,
      })
    }
    controller.open()
  } catch {
    error.value = '面试助手加载失败，请检查网络后重试。'
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  controller?.destroy()
})
</script>

<template>
  <button
    type="button"
    class="btn interview-launch"
    :disabled="loading"
    @click="openAssistant"
  >
    {{ loading ? '正在加载…' : 'AI 面试助手' }}
  </button>
  <span v-if="error" class="interview-load-error" role="alert">{{ error }}</span>
  <Teleport to="body">
    <div ref="assistantRoot" class="interview-assistant-host" v-html="assistantMarkup" />
  </Teleport>
</template>

<style scoped>
.interview-launch {
  background: #1f3864;
  border-color: #1f3864;
  color: #fff;
}

.interview-load-error {
  color: #be123c;
  font-size: 13px;
}
</style>
