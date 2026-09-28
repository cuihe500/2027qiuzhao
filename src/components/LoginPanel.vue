<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ auth: { type: Object, required: true } })
const username = ref('')
const password = ref('')
const submitting = ref(false)
const busy = computed(() => submitting.value || props.auth.authLoading.value)

async function submit() {
  if (busy.value) return
  submitting.value = true
  try {
    if (await props.auth.login(username.value.trim(), password.value)) password.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title" :aria-busy="busy">
      <span class="login-eyebrow">CAMPUS RECRUITMENT / 2027</span>
      <h1 id="login-title">登录秋招助手</h1>
      <p class="login-description">登录后，在每台设备继续你的求职进度。</p>
      <form class="login-form" @submit.prevent="submit">
        <label for="login-username">用户名</label>
        <input id="login-username" v-model="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="请输入用户名" required :disabled="busy">
        <label for="login-password">密码</label>
        <input id="login-password" v-model="password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required :disabled="busy">
        <p v-if="auth.authError.value" class="login-error" role="alert">{{ auth.authError.value }}</p>
        <button type="submit" class="btn primary login-submit" :disabled="busy || !username.trim() || !password">{{ submitting ? '登录中…' : '登录' }}</button>
      </form>
      <p v-if="auth.authLoading.value && !submitting" class="login-hint" role="status">正在确认登录状态…</p>
      <p v-else class="login-hint">投递进度会自动保存，并在设备间同步。</p>
    </section>
  </main>
</template>
