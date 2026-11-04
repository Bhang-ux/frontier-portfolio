import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves project sites from /<repo>/ — override with BASE_PATH.
const base = process.env.BASE_PATH ?? '/frontier-portfolio/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Frontier — Portfolio Intelligence',
        short_name: 'Frontier',
        description: 'Quant-grade portfolio analytics and optimisation, explained in plain English.',
        theme_color: '#070a12',
        background_color: '#070a12',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/data/**'],
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          // The manifest is the "what changed?" pointer: always try the network first.
          { urlPattern: /\/data\/manifest\.json/, handler: 'NetworkFirst', options: { cacheName: 'frontier-manifest', networkTimeoutSeconds: 4 } },
          // Everything else under /data is content-addressed (?v=hash) ⇒ cache-first is safe.
          { urlPattern: /\/data\/.*\.json/, handler: 'CacheFirst', options: { cacheName: 'frontier-data', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 86400 } } },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          viz: ['d3-scale', 'd3-shape', 'd3-array', 'd3-hierarchy'],
          ui: ['motion', '@radix-ui/react-popover', '@radix-ui/react-dialog', '@radix-ui/react-slider', '@radix-ui/react-tooltip', 'cmdk', 'sonner'],
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
