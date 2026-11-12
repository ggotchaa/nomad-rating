import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: null,
      manifest: {
        name: 'Nomad — настольный теннис',
        short_name: 'Nomad',
        start_url: '/me',
        display: 'standalone',
        background_color: '#03050b',
        theme_color: '#03050b',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], maximumFileSizeToCacheInBytes: 3_000_000 },
    }),
  ],
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
