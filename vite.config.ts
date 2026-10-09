import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Auf GitHub Pages liegt die App unter /<repo-name>/ – das setzt der Deploy-Workflow.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.png'],
      manifest: {
        name: 'Plopp! – Der Biertracker',
        short_name: 'Plopp!',
        description: 'Getrunkene Biere tracken, scannen und auf der Karte sehen',
        lang: 'de',
        theme_color: '#f4a300',
        background_color: '#1c1917',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Kartenkacheln und API-Aufrufe nicht cachen, nur die App selbst
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
