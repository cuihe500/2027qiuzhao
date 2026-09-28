<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ sync: { type: Object, required: true } })
const busy = ref(false)
const message = ref('')
const statusLabels = {
  local: '等待同步', syncing: '正在同步…', synced: '已同步', pending: '修改已保存，等待同步',
  offline: '暂时离线，变更将在重连后同步', error: '同步失败，可重试', conflict: '有多端修改需要确认',
}
const state = computed(() => props.sync.status.value)
const conflicts = computed(() => Object.entries(props.sync.conflicts.value))

async function run(action) {
  busy.value = true
  message.value = ''
  try {
    await action()
  } catch (cause) {
    message.value = cause.message || '操作失败，请重试'
  } finally {
    busy.value = false
  }
}

function describe(record) {
  if (!record) return '已清空'
  const dates = Object.entries(record.dates).map(([stage, date]) => `${stage} ${date}`).join('；')
  return `${record.stage || '未填写'}${dates ? `（${dates}）` : ''}${record.endStage ? `，结束于${record.endStage}` : ''}`
}
</script>

<template>
  <details class="sync-panel" :open="conflicts.length > 0 || undefined">
    <summary><span>进度同步</span><span :class="['sync-status', state]">{{ statusLabels[state] || state }}</span></summary>
    <div class="sync-content">
      <p>当前账号：<strong>{{ sync.user.value?.username }}</strong>。在其他设备登录同一账号，即可继续记录。</p>
      <div class="sync-actions">
        <button class="btn" type="button" :disabled="busy || state === 'syncing'" @click="run(sync.syncNow)">立即同步</button>
        <button class="btn" type="button" :disabled="busy" @click="run(sync.importLocalRecords)">合并此设备本地进度</button>
        <button class="btn" type="button" :disabled="busy" @click="run(sync.logout)">退出登录</button>
      </div>
      <p class="muted">在线时修改自动保存，每 15 秒及切回页面时拉取其他设备的变更。</p>
      <p class="muted">只同步投递状态和日期。简历、面试记录和 AI API Key 仍保留在本机。</p>
      <p v-if="sync.error.value || message" class="notice" role="status">{{ sync.error.value || message }}</p>
      <div v-if="conflicts.length" class="conflicts" role="alert">
        <p>以下公司在多台设备被同时修改，请选择要保留的进度：</p>
        <div v-for="[company, conflict] in conflicts" :key="company" class="conflict-item">
          <strong>{{ company }}</strong>
          <p>此设备：{{ describe(conflict.local) }}</p>
          <p>服务器：{{ describe(conflict.remote) }}</p>
          <div class="sync-actions">
            <button class="btn" type="button" @click="run(() => sync.resolveConflict(company, 'local'))">保留此设备</button>
            <button class="btn" type="button" @click="run(() => sync.resolveConflict(company, 'remote'))">使用服务器版本</button>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>
