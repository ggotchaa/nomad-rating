import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3010',
      '/ws': { target: 'ws://127.0.0.1:3010', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
