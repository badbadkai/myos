/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts `define`. Empty string for same-origin (dev + the
// localhost bridge build); the absolute bridge URL for the GitHub Pages build.
declare const __BRIDGE_BASE__: string;
