import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// When deploying the UI-only mirror to GitHub Pages, the project lives at /myos/.
// When the local bridge serves the built app (the real setup), it sits at root.
const isPages = process.env.DEPLOY_TARGET === 'pages';
const base = isPages ? '/myos/' : '/';
const BRIDGE_PORT = process.env.MYOS_BRIDGE_PORT || '4177';
// The Pages build is a static site with no proxy, so it must call the bridge by
// an absolute URL. localhost is a trusted origin in Chromium, so an HTTPS Pages
// page can reach http://localhost:4177 (the bridge adds the Private-Network-Access
// header). Override with MYOS_PUBLIC_BRIDGE (e.g. a Tailscale HTTPS address).
const bridgeBase = isPages ? (process.env.MYOS_PUBLIC_BRIDGE || `http://localhost:${BRIDGE_PORT}`) : '';

export default defineConfig({
  base,
  define: {
    __BRIDGE_BASE__: JSON.stringify(bridgeBase),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'myOS',
        short_name: 'myOS',
        description: "Kai's personal OS",
        theme_color: '#9a3b2e',
        background_color: '#fbfaf6',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2 isn't in the default precache glob — add it so the self-hosted
        // fonts are available offline and the app looks right with no network.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cache the last successful GET /api/* response so the app stays usable
        // read-only when the bridge blips. Health is excluded — it's the live
        // online probe. Non-GET writes are never cached (urlPattern requires GET).
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET'
              && url.pathname.startsWith('/api/')
              && url.pathname !== '/api/health',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'myos-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${BRIDGE_PORT}`, changeOrigin: true },
    },
  },
});
