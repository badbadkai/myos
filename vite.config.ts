import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// When deploying the UI-only mirror to GitHub Pages, the project lives at /myos/.
// When the local bridge serves the built app (the real setup), it sits at root.
const base = process.env.DEPLOY_TARGET === 'pages' ? '/myos/' : '/';
const BRIDGE_PORT = process.env.MYOS_BRIDGE_PORT || '4177';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
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
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
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
