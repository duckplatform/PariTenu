// Aperçus des thèmes pour la page « Apparence » de l'admin : les captures téléphone des tests de bout en bout
// (test/e2e/out/61-theme-<id>.png), réduites en JPEG dans public/img/themes/<id>.jpg.
//   npm run test:e2e && node scripts/theme-previews.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { THEMES } from '../src/core/themes.js';

const SRC = fileURLToPath(new URL('../test/e2e/out/', import.meta.url));
const OUT = fileURLToPath(new URL('../public/img/themes/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
for (const { id } of THEMES) {
  const png = `${SRC}61-theme-${id}.png`;
  if (!fs.existsSync(png)) throw new Error(`Capture manquante : ${png} (lance d'abord npm run test:e2e)`);
  await page.setContent(`<style>body{margin:0}img{display:block;width:390px;height:844px}</style><img src="data:image/png;base64,${fs.readFileSync(png).toString('base64')}">`);
  await page.screenshot({ path: `${OUT}${id}.jpg`, type: 'jpeg', quality: 80 });
  console.log(`${id}.jpg`, fs.statSync(`${OUT}${id}.jpg`).size);
}
await browser.close();
