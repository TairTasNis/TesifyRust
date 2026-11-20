import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const platformStyles = 'virtual:tesify-platform-styles'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'tesify-platform-styles',
      resolveId(id) { if (id === platformStyles) return '\0' + id },
      load(id) {
        if (id === '\0' + platformStyles) {
          return mode === 'android' ? "import '/src/shared/styles/android.css'" : ''
        }
      },
    },
  ],
  clearScreen: false,
  server: {
    watch: { ignored: ['**/Backend/**'] },
    proxy: { '/api': { target: 'http://127.0.0.1:17830', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  build: { target: 'es2022', outDir: mode === 'android' ? 'dist-android' : 'dist' },
}))
