import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://anwardebes.github.io/glassbox-studio/
const BASE = '/glassbox-studio/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Glassbox Studio',
        short_name: 'Glassbox',
        description: 'The coding agent that shows its work. Every step is checked by readable logic and acted out by Pixie.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#08161a',
        theme_color: '#08161a',
        categories: ['developer', 'productivity', 'education'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,webmanifest}'],
        // The in-browser LLM runtime is large and only needed by people who pick a
        // local model, so it is cached the first time it is used instead of up front.
        globIgnores: ['**/webllm.worker-*.js'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/webllm.worker-'),
            handler: 'CacheFirst',
            options: { cacheName: 'glassbox-webllm-runtime', expiration: { maxEntries: 4 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
