// One-off raster-icon generator for iOS/Android installability.
// Rasterises public/favicon.svg into the PNGs the manifest + Apple meta need.
// Run with: node scripts/gen-icons.mjs  (requires the `sharp` devDependency)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'));

// The favicon's own background — used to fill the full-bleed maskable canvas so
// the launcher mask never exposes transparent corners.
const CREAM = { r: 251, g: 250, b: 246, alpha: 1 };
const DENSITY = 512; // rasterise the SVG at high DPI before downscaling for crisp text

// Plain square icon (purpose "any"): the favicon card edge-to-edge.
async function square(size, out) {
  await sharp(svg, { density: DENSITY }).resize(size, size).png().toFile(join(pub, out));
}

// Maskable icon: content scaled into the central safe zone (~80%) on a solid
// cream field, so Android's adaptive mask can crop to any shape without clipping.
async function maskable(size, out, contentFrac = 0.8) {
  const inner = Math.round(size * contentFrac);
  const content = await sharp(svg, { density: DENSITY }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
    .composite([{ input: content, gravity: 'center' }])
    .png()
    .toFile(join(pub, out));
}

await square(192, 'icon-192.png');
await square(512, 'icon-512.png');
await square(180, 'apple-touch-icon.png');
await maskable(512, 'icon-512-maskable.png', 0.8);
console.log('[gen-icons] wrote icon-192, icon-512, icon-512-maskable, apple-touch-icon to public/');
