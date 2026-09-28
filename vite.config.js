import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = `http://127.0.0.1:${env.PORT || 3001}`
  const proxy = {
    '/api': { target, changeOrigin: false },
    '/data.json': { target, changeOrigin: false },
  }
  return {
    plugins: [vue()],
    server: { proxy },
    preview: { proxy },
  }
})
