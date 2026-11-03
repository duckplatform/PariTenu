// Génère les icônes PNG (Android, iOS) à partir de public/icons/icon.svg avec Edge headless.
//   npm run icons
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const dir = new URL('../public/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', dir), 'utf8');
// iOS et les icônes « maskable » arrondissent elles-mêmes : on leur donne un carré plein.
const square = svg.replace('rx="112"', 'rx="0"');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
for (const [file, size, source] of [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, square],
  ['apple-touch-icon.png', 180, square],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  await writeFile(new URL(file, dir), await page.screenshot({ omitBackground: true }));
  console.log(`✔ ${file}`);
}
await browser.close();
