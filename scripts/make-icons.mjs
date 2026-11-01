// Renders the app icons in public/icons from the logo, using Playwright's
// Chromium. Run with: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const LOGO = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
  <path d="M6 9 L12 4 H28 L22 9 Z" fill="#7ce7df" fill-opacity="0.45" stroke="#7ce7df" stroke-width="1" stroke-linejoin="round"/>
  <path d="M22 9 L28 4 V22 L22 27 Z" fill="#7ce7df" fill-opacity="0.22" stroke="#7ce7df" stroke-width="1" stroke-linejoin="round"/>
  <rect x="6" y="9" width="16" height="18" rx="1.5" fill="#d97757" stroke="#7ce7df" stroke-width="1"/>
  <rect x="9.2" y="13.5" width="3.2" height="4.2" fill="#2b2a27"/>
  <rect x="15.6" y="13.5" width="3.2" height="4.2" fill="#2b2a27"/>
  <rect x="10.8" y="14" width="1.1" height="1.1" fill="#f7f4ec"/>
  <rect x="17.2" y="14" width="1.1" height="1.1" fill="#f7f4ec"/>
  <rect x="12.6" y="21.4" width="2.8" height="1.1" fill="#b85d40"/>
</svg>`;

const BG = 'radial-gradient(120% 120% at 20% 0%, #10343a 0%, #08161a 60%)';

function page(size, { padding, radius }) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${BG};display:grid;place-items:center;overflow:hidden">
    <div style="width:${size - padding * 2}px;height:${size - padding * 2}px;transform:translateX(${size * 0.01}px)">${LOGO}</div>
  </div></body></html>`;
}

const targets = [
  { file: 'pwa-192.png', size: 192, padding: 30, radius: 42 },
  { file: 'pwa-512.png', size: 512, padding: 80, radius: 112 },
  // Maskable icons must keep the important part inside the central 80% circle.
  { file: 'pwa-maskable-512.png', size: 512, padding: 128, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, padding: 28, radius: 0 },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const tab = await ctx.newPage();
for (const t of targets) {
  await tab.setViewportSize({ width: t.size, height: t.size });
  await tab.setContent(page(t.size, t));
  await tab.screenshot({ path: `public/icons/${t.file}`, omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log('wrote', t.file);
}
await browser.close();
