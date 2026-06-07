// Generate the PNG/ICO icon set from favicon.svg.
// One-off dev tool — not deployed (see .vercelignore). To rerun:
//   npm install --no-save sharp png-to-ico
//   node scripts/generate-icons.mjs      (run from the project root)
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';

// Browser-tab icon keeps the rounded corners (transparency is fine in tabs).
const rounded = readFileSync('favicon.svg');

// App icons (iOS home screen / Android / PWA) must be a FULL-BLEED OPAQUE square:
// the OS masks the corners itself, and iOS renders transparency as black. Ball
// stays centered within the inner ~80% so it survives Android's maskable crop.
const square = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#002868"/>
  <circle cx="32" cy="32" r="20" fill="#ffffff"/>
  <polygon points="32,23 40.5,29.2 37.3,39.2 26.7,39.2 23.5,29.2" fill="#0a1733"/>
  <g stroke="#0a1733" stroke-width="2.4" stroke-linecap="round">
    <line x1="32" y1="23" x2="32" y2="12.5"/>
    <line x1="40.5" y1="29.2" x2="50.5" y2="26"/>
    <line x1="37.3" y1="39.2" x2="43.5" y2="48"/>
    <line x1="26.7" y1="39.2" x2="20.5" y2="48"/>
    <line x1="23.5" y1="29.2" x2="13.5" y2="26"/>
  </g>
</svg>`);

const png = (svg, size, file) =>
  sharp(svg, { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);

await png(rounded, 16, 'favicon-16x16.png');
await png(rounded, 32, 'favicon-32x32.png');
await png(rounded, 48, 'favicon-48x48.png');
await png(square, 180, 'apple-touch-icon.png');
await png(square, 192, 'android-chrome-192x192.png');
await png(square, 512, 'android-chrome-512x512.png');

const ico = await pngToIco(['favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png']);
writeFileSync('favicon.ico', ico);

console.log('icons generated');
