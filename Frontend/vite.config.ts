import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    watch: { ignored: ['**/Backend/**'] },
    proxy: { '/api': { target: 'http://127.0.0.1:17830', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  build: { target: 'es2022' },
})
