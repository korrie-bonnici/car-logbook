import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Deployed at https://<user>.github.io/car-logbook/
const BASE = '/car-logbook/';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
  },

  base: BASE,

  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },

  server: {
    port: 5173,
    // Lets you open the dev server from your phone on the same Wi-Fi.
    host: true,
  },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],

      manifest: {
        id: BASE,
        name: 'Car Logbook',
        short_name: 'Logbook',
        description:
          'A paper-style vehicle logbook. Photograph the odometer at each end of a business trip and note the purpose.',
        lang: 'en-AU',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#0d1117',
        theme_color: '#0d1117',
        categories: ['productivity', 'finance'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Start trip', url: `${BASE}?action=start-trip` },
          { name: 'Trip list', url: `${BASE}?view=trips` },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,

        // Single-page app: any in-scope navigation falls back to the shell.
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        runtimeCaching: [
          {
            // Tesseract.js worker, wasm core and the English traineddata.
            // Cached on first (online) OCR run so later runs work offline.
            urlPattern: ({ url }) => url.origin === 'https://cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine-v1',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: {
        // Lets you test install + offline behaviour with `npm run dev`.
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
});
