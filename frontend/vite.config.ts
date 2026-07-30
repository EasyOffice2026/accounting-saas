import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import browserslist from 'browserslist'
import { browserslistToTargets } from 'lightningcss'

// Downlevel modern CSS (oklch(), color-mix(), @property, nesting) that Tailwind
// v4 emits so the app renders on older tablet browsers (e.g. Huawei / older
// Chromium that predate Chrome 111).
const targets = browserslistToTargets(
  browserslist('>= 0.2%, last 4 versions, Chrome >= 87, Safari >= 13, Firefox >= 78, not dead')
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    transformer: 'lightningcss',
    lightningcss: { targets },
  },
  build: {
    cssMinify: 'lightningcss',
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
    },
  },
})
