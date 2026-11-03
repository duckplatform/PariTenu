// Tests de bout en bout : Edge (headless) joue l'app comme quatre amis sur leurs téléphones.
//   npm run test:e2e              tous les scénarios, captures dans test/e2e/out/
//   npm run test:e2e -- --headed  pour regarder
// L'horloge du serveur est avancée par /api/_test/clock (PT_TEST_HOOKS) pour vivre clôtures et délais.
// Les sources de données (matchs, météo…) sont simulées par test/fake-upstream.js : aucun appel réseau.
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../../src/app.js';
import { buildConfig } from '../../src/config.js';
import { naturalSeason } from '../../src/core/seasons.js';
import { createClock } from '../../src/lib/clock.js';
import { encodePng } from '../../src/lib/png.js';
import { fakeUpstream } from '../fake-upstream.js';

const HEADED = process.argv.includes('--headed');
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const HOUR = 3_600_000;
const PINS = { lea: '2468', max: '1357', tom: '8642', ines: '9753' }; // PIN de test, propres à ce scénario
const ADMIN_PASSWORD = 'mot de passe admin du scénario'; // propre à ce serveur de test (base en mémoire)

const config = buildConfig({ NODE_ENV: 'test', PT_DB_PATH: ':memory:', PT_TEST_HOOKS: '1' });
const clock = createClock();
const upstream = fakeUpstream(clock);
const instance = createApp(config, { clock, fetch: upstream.fetch });
const server = await new Promise((resolve) => { const s = instance.app.listen(0, () => resolve(s)); });
const ORIGIN = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: !HEADED });

// ——— Petit moteur de scénarios

const results = [];
let errors = [];
let active = null; // le téléphone utilisé en dernier, pour la capture d'échec
async function test(name, fn) {
  const t0 = Date.now();
  errors = [];
  try {
    await fn();
    if (errors.length) throw new Error(`erreurs dans la page :\n  ${errors.join('\n  ')}`);
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`✖ ${name}\n  ${String(err.stack || err).split('\n').slice(0, 8).join('\n  ')}`);
    if (active && !active.isClosed()) {
      await active.screenshot({ path: `${OUT}ECHEC-${results.length}.png`, fullPage: true }).catch(() => {});
      const seen = await active.locator('body').innerText().catch(() => '');
      console.log(`  page (${active.url()}) :\n  ${seen.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
}

// Les refus attendus (PIN faux, 409…) laissent une trace « Failed to load resource » : ce n'est pas un bug de la page.
const EXPECTED_HTTP = /Failed to load resource: the server responded with a status of (401|403|404|409|423)/;

async function phone(name, { colorScheme = 'light', storageState } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme, storageState,
  });
  // Le partage natif est remplacé par un enregistreur : on vérifie ce qui aurait été envoyé dans WhatsApp.
  await context.addInitScript(() => {
    window.__shared = [];
    navigator.share = async (data) => { window.__shared.push(data); };
  });
  const page = await context.newPage();
  page.on('framenavigated', () => { active = page; });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED_HTTP.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  return { name, context, page };
}

/** Capture pour la preuve : sans notifications ni panneau en train de se fermer (sauf keepOverlays). */
async function shot(page, file, { keepOverlays = false, ...opts } = {}) {
  if (!keepOverlays) await page.locator('.sheet-backdrop').waitFor({ state: 'detached' }).catch(() => {});
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  // Page entière : on simule un téléphone aussi haut que la page, pour que la barre de navigation
  // et la zone de commentaire restent en bas comme sur un vrai écran.
  const { fullPage, ...rest } = opts;
  const size = page.viewportSize();
  if (fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${file}.png`, animations: 'disabled', ...rest });
  if (fullPage) await page.setViewportSize(size);
}
/**
 * Le texte visible de l'app, dans sa casse d'origine : innerText rendrait les titres en capitales (text-transform),
 * et la barre latérale du PC, cachée sur téléphone, n'en fait pas partie.
 */
const text = (page) => page.evaluate(() => {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) { out.push(node.data); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || !node.checkVisibility() || ['SCRIPT', 'STYLE', 'svg'].includes(node.tagName)) return;
    const block = !getComputedStyle(node).display.startsWith('inline');
    if (block) out.push('\n');
    for (const child of node.childNodes) walk(child);
    if (block) out.push('\n');
  };
  walk(document.getElementById('app'));
  return out.join('').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
});
const shared = (page) => page.evaluate(() => window.__shared);
/** Un coupon de création de groupe, comme ceux que génère l'admin de l'instance. */
const newCoupon = () => instance.deps.coupons.create({ note: 'scénario' }).code;
async function advance(ms) {
  const res = await fetch(`${ORIGIN}/api/_test/clock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ advanceMs: ms }) });
  assert.equal(res.status, 200);
}
async function reload(page) {
  await page.reload();
  await page.waitForSelector('#app main');
}
const dialog = (page) => page.getByRole('dialog');
// Les adresses de l'app : /<groupe>[/…], le groupe en 16 caractères hexadécimaux.
const GROUP_URL = /\/[0-9a-f]{16}$/;
const gidOf = (url) => new URL(url).pathname.split('/')[1];

async function waitText(page, needle, timeout = 5000) {
  await page.locator('body').getByText(needle, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
}

/** Ouvre une adresse ; si c'est déjà celle de la page (même #…), recharge pour avoir des données fraîches. */
async function open(page, url) {
  if (page.url() === url) await page.reload();
  else await page.goto(url);
  await page.waitForSelector('#app main');
}

// ——— Scénario

const lea = await phone('Léa');
const max = await phone('Max');
const tom = await phone('Tom');
const ines = await phone('Inès');
let invite;
let betUrl;
let kartUrl;

await test('l’accueil du site, puis créer un groupe par le lien d’un coupon', async () => {
  const { page } = lea;
  await page.goto(ORIGIN);
  // L'accueil du site : le principe et les sports, sans formulaire ni lien vers la création d'un groupe.
  await page.locator('.landing-hero h1').waitFor();
  assert.equal(await page.locator('form').count(), 0, 'pas de formulaire sur l’accueil');
  assert.equal(await page.locator('a[href^="/groups/new"]').count(), 0, 'aucun lien vers la création d’un groupe');
  await shot(page, '00-accueil-site', { fullPage: true });
  // Créer un groupe : seulement par le lien d'un coupon (ici la page sans coupon : Léa le tape).
  await page.goto(`${ORIGIN}/groups/new`);
  const create = page.locator('#creer');
  await create.waitFor();
  // Sans coupon (ou avec un faux) : refusé.
  await create.getByLabel('Ton coupon').fill('AAAA-BBBB-CCCC');
  await create.getByLabel('Nom du groupe').fill('Les Potes');
  await create.getByLabel('Ton pseudo').fill('Léa');
  await create.locator('input[name=pin]').fill(PINS.lea);
  await create.locator('input[name=pin2]').fill(PINS.lea);
  await page.getByRole('button', { name: 'Créer le groupe' }).click();
  await waitText(page, 'Ce coupon n’existe pas');
  await create.getByLabel('Ton coupon').fill(newCoupon().toLowerCase());
  await create.locator('input[name=pin]').fill(PINS.lea);
  await create.locator('input[name=pin2]').fill(PINS.lea);
  await shot(page, '01-accueil-creer-groupe', { fullPage: true });
  await page.getByRole('button', { name: 'Créer le groupe' }).click();
  await waitText(page, 'Aucun pari pour l’instant');
  assert.match(await text(page), /Invite tes amis/);
  assert.equal(await page.title(), 'Paris · Les Potes — Pari tenu !', 'titre explicite (onglet, historique)');
  await shot(page, '02-groupe-vide');
});

await test('partager le lien d’invitation', async () => {
  const { page } = lea;
  await page.getByRole('button', { name: 'Partager le lien d’invitation' }).click();
  const [msg] = await shared(page);
  assert.match(msg.url, /\/invite\/[\w-]{22}$/);
  assert.match(msg.text, /Les Potes/);
  invite = msg.url;
});

await test('rejoindre par le lien en moins de 30 secondes (Max, Tom, Inès)', async () => {
  for (const [p, pseudo, pin] of [[max, 'Max', PINS.max], [tom, 'Tom', PINS.tom], [ines, 'Inès', PINS.ines]]) {
    const t0 = Date.now();
    await p.page.goto(invite);
    await p.page.getByLabel('Ton pseudo').fill(pseudo);
    await p.page.locator('input[name=pin]').fill(pin);
    await p.page.locator('input[name=pin2]').fill(pin);
    if (pseudo === 'Max') await shot(p.page, '03-invitation');
    await p.page.getByRole('button', { name: 'Entrer dans le groupe' }).click();
    await waitText(p.page, 'Les Potes');
    await p.page.waitForURL(GROUP_URL);
    assert.ok(Date.now() - t0 < 30_000);
  }
  // Le lien rouvert sur un téléphone déjà connecté entre directement dans le groupe.
  await max.page.goto(invite);
  await max.page.waitForURL(GROUP_URL);
});

await test('un seul compte : connexion par le lien du groupe (jamais depuis l’accueil), un 2e groupe, on y entre d’un geste', async () => {
  // Max sur son PC : l'accueil n'a pas de formulaire de connexion (un PIN se devine vite), il dit d'ouvrir le lien.
  const pc = await phone('Max (PC)');
  await pc.page.goto(ORIGIN);
  const hint = pc.page.locator('#deja-un-compte');
  assert.match(await hint.innerText(), /Ouvre le lien d’un de tes groupes/);
  assert.equal(await pc.page.locator('input[name=login-pin]').count(), 0, 'pas de PIN à taper sur l’accueil');
  assert.equal(await pc.page.getByRole('button', { name: 'Me connecter' }).count(), 0);
  const refused = await pc.page.evaluate(async () => (await fetch('/api/account/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pseudo: 'Max', pin: '0000' }) })).status);
  assert.equal(refused, 403, 'sans lien de groupe, le serveur refuse aussi');
  // Le lien du groupe : son pseudo et son PIN, il retrouve son groupe.
  await pc.page.goto(invite);
  await pc.page.getByRole('tab', { name: 'J’ai déjà un compte' }).click();
  await pc.page.getByLabel('Ton pseudo').fill('max');
  await pc.page.locator('input[name=login-pin]').fill(PINS.max);
  await shot(pc.page, '39-connexion-lien-groupe');
  await pc.page.getByRole('button', { name: 'Me connecter' }).click();
  await pc.page.waitForURL(GROUP_URL);
  await waitText(pc.page, 'Les Potes');
  // Un deuxième groupe : connecté, un nom et un emoji suffisent.
  await pc.page.goto(`${ORIGIN}/groups/new`);
  const create = pc.page.locator('#creer');
  assert.match(await create.locator('.identity-row').innerText(), /Max/);
  assert.equal(await create.getByLabel('Ton pseudo').count(), 0, 'pas de pseudo ni de PIN à retaper');
  await create.getByLabel('Nom du groupe').fill('Le Foot du jeudi');
  await create.getByLabel('Ton coupon').fill(newCoupon());
  await create.getByRole('button', { name: 'Créer le groupe' }).click();
  await waitText(pc.page, 'Aucun pari pour l’instant');
  assert.match(await pc.page.title(), /Le Foot du jeudi/);
  await pc.page.getByRole('button', { name: 'Partager le lien d’invitation' }).click();
  const [msg] = await shared(pc.page);
  // Tom, déjà inscrit : un bouton, et il est dedans avec son pseudo et son avatar.
  await tom.page.goto(msg.url);
  assert.match(await tom.page.locator('.identity-row').innerText(), /Tom/);
  await shot(tom.page, '40-rejoindre-un-geste');
  await tom.page.getByRole('button', { name: 'Entrer dans Le Foot du jeudi' }).click();
  await tom.page.waitForURL(GROUP_URL);
  await waitText(tom.page, 'Le Foot du jeudi');
  await pc.context.close();
});

await test('un groupe neuf n’a rien d’activé : Léa ouvre les paris maison', async () => {
  const { page } = lea;
  const home = page.url();
  await reload(page);
  await waitText(page, 'Aucun pari pour l’instant');
  assert.equal(await page.locator('.nav-new').count(), 0, 'pas de bouton Parier');
  await page.getByRole('link', { name: '🎛️ Choisir des compétitions' }).click();
  await waitText(page, 'Catégories et paris automatiques');
  const kinds = [page.getByRole('switch', { name: /Oui \/ Non/ }), page.getByRole('switch', { name: /Choix multiples/ })];
  const cats = await page.getByRole('switch', { name: /^Paris maison : / }).all();
  assert.equal(cats.length, 12);
  for (const s of [...kinds, ...cats]) assert.equal(await s.isChecked(), false, 'rien d’activé d’office');
  for (const s of [...kinds, ...cats]) await s.check();
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await waitText(page, 'Réglages enregistrés.');
  await page.goto(home);
  await page.getByRole('link', { name: /Nouveau pari/ }).waitFor();
});

await test('créer un pari Oui/Non en moins d’une minute et le partager', async () => {
  const { page } = lea;
  const t0 = Date.now();
  await reload(page);
  await page.getByRole('link', { name: /Nouveau pari/ }).click();
  await page.locator('textarea[name=question]').fill('Julien arrive après 20 h 15 samedi ?');
  await page.getByRole('radio', { name: '👥 Vie du groupe' }).click();
  await page.getByRole('button', { name: 'Dans 1 h' }).click();
  await page.locator('textarea[name=details]').fill('Heure d’arrivée au bar, celle du téléphone d’Inès fait foi.');
  await shot(page, '04-nouveau-pari', { fullPage: true });
  await page.getByRole('button', { name: '🎲 Lancer le pari' }).click();
  await waitText(page, 'Pari lancé !');
  assert.ok(Date.now() - t0 < 60_000);
  betUrl = page.url();
  assert.equal(await page.title(), 'Julien arrive après 20 h 15 samedi ? · Les Potes — Pari tenu !');
  await shot(page, '05-pari-lance');
  await page.getByRole('button', { name: '📤 Partager dans le groupe' }).click();
  const last = (await shared(page)).at(-1);
  assert.match(last.text, /Nouveau pari : Julien arrive après 20 h 15 samedi \?/);
  assert.match(last.url, /\/invite\/[\w-]+\?bet=\w+$/);
  // Le lien partagé ouvre directement le pari chez un ami déjà connecté.
  await tom.page.goto(last.url);
  await tom.page.waitForURL(/\/bet\//);
});

await test('idées de paris : un modèle « Qui… ? » passe en choix multiples', async () => {
  const { page } = lea;
  await page.goto(`${ORIGIN}/${gidOf(betUrl)}/new`);
  await page.getByRole('button', { name: '💡 Idées de paris' }).click();
  await dialog(page).getByRole('button', { name: 'Qui gagne le tournoi de Mario Kart ?' }).click();
  assert.equal(await page.locator('textarea[name=question]').inputValue(), 'Qui gagne le tournoi de Mario Kart ?');
  assert.equal(await page.getByRole('tab', { name: 'Choix multiples' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('radio', { name: '🎲 Jeux entre amis' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('textbox', { name: 'Option 1' }).fill('Max');
  await page.getByRole('textbox', { name: 'Option 2' }).fill('Tom');
  await page.getByRole('textbox', { name: 'Option 3' }).fill('Inès');
  await page.getByRole('button', { name: 'Dans 1 h' }).click();
  await page.getByRole('button', { name: '🎲 Lancer le pari' }).click();
  await waitText(page, 'Pari lancé !');
  kartUrl = page.url();
  // Un blanc « ___ » non complété est refusé.
  await page.goto(betUrl.replace(/bet\/.*/, 'new'));
  await page.getByRole('button', { name: '💡 Idées de paris' }).click();
  await dialog(page).getByRole('button', { name: '___ arrive en retard samedi ?' }).click();
  await page.getByRole('button', { name: 'Dans 1 h' }).click();
  await page.getByRole('button', { name: '🎲 Lancer le pari' }).click();
  await waitText(page, 'Complète les blancs');
});

await test('parier en 2 touches, avec les points potentiels justes', async () => {
  const pickIt = async ({ page }, label, expected) => {
    await open(page, betUrl);
    await page.getByRole('button', { name: `Parier « ${label} »` }).click();
    const box = dialog(page);
    await box.getByText(`≈ ${expected} pts`).waitFor();
    if (expected === 150) await shot(page, '06-confirmer-pari', { keepOverlays: true });
    await box.getByRole('button', { name: 'Je parie !' }).click();
    await waitText(page, `Ton pari : « ${label} »`);
  };
  await pickIt(max, 'Oui', 100); // seul : ×1
  await pickIt(tom, 'Non', 200); // 2 participants, seul sur Non : ×2
  await pickIt(ines, 'Non', 150); // 3 participants, 2 sur Non : ×1,5
  const page = ines.page;
  const options = await page.locator('.option').allInnerTexts();
  assert.match(options[0], /Oui\s+3,00[\s\S]*1 pronostic · ≈ 300 pts si ça gagne/);
  assert.match(options[1], /Non\s+1,50[\s\S]*2 pronostics · ≈ 150 pts si ça gagne/);
  await shot(page, '07-pari-cotes', { fullPage: true });
  // Son option n'est plus à toucher ; l'autre, si : on peut changer d'avis jusqu'à la clôture.
  assert.equal(await page.locator('button.option').count(), 1);
  assert.match(await text(page), /Tu peux changer d’avis jusqu’à la clôture/);
});

await test('l’arbitre ne parie pas sur son pari', async () => {
  const { page } = lea;
  await open(page, betUrl);
  await waitText(page, 'Tu es l’arbitre');
  assert.equal(await page.locator('button.option').count(), 0);
});

await test('pronostics sur le pari Mario Kart', async () => {
  for (const [p, label] of [[max, 'Max'], [tom, 'Tom'], [ines, 'Tom']]) {
    await open(p.page, kartUrl);
    await p.page.getByRole('button', { name: `Parier « ${label} »` }).click();
    await dialog(p.page).getByRole('button', { name: 'Je parie !' }).click();
    await waitText(p.page, `Ton pari : « ${label} »`);
  }
});

await test('après la clôture, plus aucun pronostic n’est accepté', async () => {
  await advance(HOUR + 60_000);
  const { page } = max;
  await open(page, kartUrl);
  await waitText(page, 'Pronostics clos');
  const gid = gidOf(kartUrl);
  const betId = kartUrl.split('/bet/')[1];
  const r = await page.evaluate(async ([g, b]) => {
    const detail = await (await fetch(`/api/groups/${g}/bets/${b}`)).json();
    const res = await fetch(`/api/groups/${g}/bets/${b}/pick`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId: detail.bet.options[0].id }),
    });
    return { status: res.status, body: await res.json() };
  }, [gid, betId]);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Trop tard : les pronostics sont clos.');
});

await test('trancher, contester, voter : le vote renverse le verdict', async () => {
  await lea.page.goto(`${ORIGIN}/${gidOf(betUrl)}`);
  await waitText(lea.page, 'À toi de trancher');
  await shot(lea.page, '08-accueil-a-trancher');
  await open(lea.page, betUrl);
  await lea.page.locator('.verdict label.choice', { hasText: 'Oui' }).click();
  await lea.page.locator('.verdict input[type=text]').fill('Arrivé à 20 h 20, d’après mon téléphone');
  await shot(lea.page, '09-trancher', { fullPage: true });
  await lea.page.getByRole('button', { name: 'Valider le résultat' }).click();
  await waitText(lea.page, 'Résultat proposé : « Oui »');

  await open(tom.page, betUrl);
  await tom.page.getByRole('button', { name: 'Contester le résultat' }).click();
  await dialog(tom.page).locator('textarea').fill('Il est arrivé à 20 h 10, j’ai la photo !');
  await dialog(tom.page).getByRole('button', { name: 'Contester', exact: true }).click();
  await waitText(tom.page, 'Vote du groupe');

  const vote = async ({ page }, choice) => {
    await open(page, betUrl);
    await page.locator('.vote-row', { hasText: new RegExp(`^${choice}`) }).getByRole('button', { name: 'Voter' }).click();
    await waitText(page, 'Vote enregistré.');
  };
  await vote(tom, 'Non');
  await vote(ines, 'Non');
  await waitText(ines.page, 'Tu as voté « Non »');
  await shot(ines.page, '10-vote', { fullPage: true });
  assert.equal(await lea.page.locator('.vote-row button').count(), 0, 'l’arbitre ne vote pas');
  await vote(max, 'Oui');
  await reload(max.page);
  await waitText(max.page, 'Résultat : « Non »');
  const banner = await max.page.locator('.banner').innerText();
  assert.match(banner, /Tom \+150 pts/);
  assert.match(banner, /Inès \+150 pts/);
  assert.doesNotMatch(banner, /Prime/, 'pas de prime après contestation');
  await shot(max.page, '11-pari-regle', { fullPage: true });
});

await test('sans contestation, les points tombent après 24 h (avec la prime d’arbitre)', async () => {
  await open(lea.page, kartUrl);
  await lea.page.locator('.verdict label.choice', { hasText: 'Tom' }).click();
  await lea.page.getByRole('button', { name: 'Valider le résultat' }).click();
  await waitText(lea.page, 'Résultat proposé : « Tom »');
  await advance(24 * HOUR);
  await reload(lea.page);
  await waitText(lea.page, 'Résultat : « Tom »');
  const banner = await lea.page.locator('.banner').innerText();
  assert.match(banner, /Tom \+150 pts/);
  assert.match(banner, /Prime d’arbitre : Léa \+20 pts/);
});

await test('classements : un par catégorie, sur la saison de l’année', async () => {
  const { page } = tom;
  await page.goto(`${betUrl.split('/bet/')[0]}/rank`);
  await waitText(page, 'Classements');
  // Les points du groupe se répartissent entre les classements des catégories jouées ; pas de classement général.
  const gid = gidOf(betUrl);
  const totals = await page.evaluate(async (g) => {
    const { rankings } = await (await fetch(`/api/groups/${g}/rankings`)).json();
    const out = {};
    for (const r of rankings) {
      const { season } = await (await fetch(`/api/groups/${g}/rankings/${encodeURIComponent(r.key)}`)).json();
      for (const row of season.standings) out[row.member.pseudo] = (out[row.member.pseudo] ?? 0) + row.score;
    }
    return out;
  }, gid);
  assert.deepEqual(totals, { Inès: 300, Tom: 300, Léa: 20, Max: 0 });
  const tabs = await page.getByRole('tab').allInnerTexts();
  assert.ok(tabs.includes('👥 Vie du groupe'), tabs.join(', '));
  await page.getByRole('tab', { name: '👥 Vie du groupe' }).click();
  await waitText(page, `· ${naturalSeason(clock.now()).label}`);
  assert.match(await text(page), /le meilleur score sera sacré champion, puis tout repart de zéro/);
  assert.ok(await page.locator('.rank-row').count() >= 2);
  await shot(page, '12-classement');
});

await test('profil, badges et relevé de points', async () => {
  const { page } = tom;
  await page.locator('.rank-row', { hasText: 'Inès' }).first().click();
  await waitText(page, 'Badges');
  const t = await text(page);
  assert.match(t, /Saisons en cours/);
  assert.match(t, /Premier pari/);
  assert.match(t, /100 %/);
  await page.getByText('Relevé de points').click();
  await shot(page, '13-profil', { fullPage: true });
});

await test('commentaires et réactions', async () => {
  const { page } = max;
  await open(page, betUrl);
  await page.getByLabel('Écrire un commentaire').fill('Scandale, le chrono était faux 😤');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await waitText(page, 'Scandale, le chrono était faux');
  await page.getByRole('button', { name: 'Réagir 😂' }).click();
  await page.locator('.comment .reaction').waitFor();
  await open(tom.page, betUrl);
  await waitText(tom.page, 'Scandale, le chrono était faux');
});

await test('fil d’activité : à la une, résultats en cartes, pronostics regroupés, filtres', async () => {
  const { page } = ines;
  await page.goto(`${betUrl.split('/bet/')[0]}/activity`);
  await waitText(page, 'Activité');
  // « À la une » (depuis 24 h) : les paris réglés et les gains de chacun.
  assert.match(await page.locator('.act-une').innerText(), /Paris réglés/);
  // Le résultat en carte : la réponse gagnante, les points de Tom et d'Inès, Max s'est trompé.
  const result = page.locator('.act-result', { hasText: 'Julien arrive après 20 h 15 samedi ?' });
  const card = await result.innerText();
  assert.match(card, /Résultat : « Non »/);
  assert.match(card, /Tom\s+\+150 pts/);
  assert.match(card, /Inès\s+\+150 pts/);
  assert.match(card, /Max\s+raté/);
  const t = await text(page);
  assert.match(t, /conteste le résultat/);
  assert.match(t, /a rejoint le groupe/);
  assert.ok(await page.locator('.act-picks').count() > 0, 'les pronostics de chacun regroupés');
  await shot(page, '14-activite', { fullPage: true });
  // Filtre « Résultats » : plus de pronostics, les résultats restent.
  await page.getByRole('button', { name: 'Résultats', exact: true }).click();
  assert.equal(await page.locator('.act-picks').count(), 0);
  assert.ok(await page.locator('.act-result').count() > 0);
  await page.getByRole('button', { name: 'Tout', exact: true }).click();
});

await test('5 PIN faux bloquent le compte', async () => {
  const thief = await phone('Voleur');
  const { page } = thief;
  await page.goto(invite);
  await page.getByRole('tab', { name: 'J’ai déjà un compte' }).click();
  await page.locator('.member-choice', { hasText: 'Max' }).click();
  assert.equal(await page.getByLabel('Ton pseudo').inputValue(), 'Max', 'toucher son avatar remplit le pseudo');
  for (let i = 1; i <= 5; i++) {
    await page.locator('input[name=login-pin]').fill('0000');
    await page.getByRole('button', { name: 'Me connecter' }).click();
    await page.locator('.form-error').filter({ hasText: i < 5 ? 'PIN incorrect' : 'bloqué' }).waitFor();
  }
  await shot(page, '15-pin-bloque');
  await page.locator('input[name=login-pin]').fill(PINS.max);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await page.locator('.form-error').filter({ hasText: 'bloqué' }).waitFor();
  await thief.context.close();
});

await test('admin : changer le lien rend l’ancien inutilisable', async () => {
  const { page } = lea;
  await page.goto(`${betUrl.split('/bet/')[0]}/me`);
  assert.equal(await page.getByRole('link', { name: /Réglages du groupe|Administration/ }).count(), 0, 'plus dans « Moi »');
  // Les réglages du groupe : l'engrenage à côté de son nom (sur téléphone, dans l'en-tête du groupe).
  await page.goto(betUrl.split('/bet/')[0]);
  await page.locator('.topbar').getByRole('link', { name: 'Réglages du groupe' }).click();
  await waitText(page, 'Lien d’invitation');
  assert.match(await page.title(), /^Réglages du groupe · Les Potes/);
  await shot(page, '16-administration', { fullPage: true });
  await page.getByRole('button', { name: 'Changer le lien' }).click();
  await dialog(page).getByRole('button', { name: 'Changer le lien' }).click();
  await waitText(page, 'Nouveau lien créé.');
  const fresh = await page.locator('.invite-link code').innerText();
  assert.notEqual(fresh, invite);
  const stranger = await phone('Inconnu');
  await stranger.page.goto(invite);
  await waitText(stranger.page, 'Lien expiré');
  await shot(stranger.page, '17-lien-expire');
  await stranger.page.goto(fresh);
  await waitText(stranger.page, 'Tu es invité à rejoindre');
  await stranger.context.close();
});

await test('réglages des paris : couper un type, une catégorie ; activer des compétitions', async () => {
  const { page } = lea;
  await page.goto(`${betUrl.split('/bet/')[0]}/admin`);
  await page.getByRole('link', { name: /Réglages des paris/ }).click();
  await waitText(page, 'Catégories et paris automatiques');
  const multi = page.getByRole('switch', { name: /Choix multiples/ });
  await multi.uncheck();
  await page.getByRole('switch', { name: 'Paris maison : Insolite' }).uncheck();
  // Rien n'est activé d'office : on choisit les compétitions une par une.
  const foot = page.locator('[data-source=foot]');
  await foot.getByText('Rien d’activé').waitFor();
  await foot.getByRole('button', { name: 'Ligue 1', exact: true }).click();
  assert.equal(await foot.getByRole('button', { name: 'Ligue 1', exact: true }).getAttribute('aria-pressed'), 'true');
  await foot.getByText('1 activée').waitFor();
  await page.locator('[data-source=usfoot]').getByRole('button', { name: 'NFL', exact: true }).click();
  await page.getByRole('switch', { name: 'Paris automatiques : Météo' }).check();
  const meteo = page.locator('[data-source=meteo]');
  await meteo.getByRole('textbox', { name: 'Chercher une ville' }).fill('Lyon');
  await meteo.getByRole('button', { name: 'Chercher' }).click();
  await meteo.getByRole('button', { name: /^Lyon · Auvergne-Rhône-Alpes/ }).click();
  await meteo.getByText('📍 Lyon (Auvergne-Rhône-Alpes, France)').waitFor();
  // Couper les paris maison de la Météo ne touche pas à ses paris automatiques.
  await page.getByRole('switch', { name: 'Paris maison : Météo' }).uncheck();
  const autoMeteo = page.getByRole('switch', { name: 'Paris automatiques : Météo' });
  assert.deepEqual([await autoMeteo.isDisabled(), await autoMeteo.isChecked()], [false, true]);
  await page.getByRole('switch', { name: 'Paris maison : Météo' }).check();
  await shot(page, '21-reglages-paris', { fullPage: true });
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await waitText(page, 'Réglages enregistrés.');

  // Chez Max : plus de choix multiples ni de catégorie Insolite dans le formulaire.
  await max.page.goto(`${betUrl.split('/bet/')[0]}/new`);
  await max.page.locator('textarea[name=question]').waitFor();
  assert.equal(await max.page.getByRole('tab', { name: 'Choix multiples' }).count(), 0);
  assert.equal(await max.page.getByRole('radio', { name: '🤪 Insolite' }).count(), 0);
  assert.equal(await max.page.getByRole('radio', { name: '🌦️ Météo' }).count(), 1);

  // On remet les choix multiples (le 1N2 d'un match en est un).
  await page.reload();
  await page.getByRole('switch', { name: /Choix multiples/ }).check();
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await waitText(page, 'Réglages enregistrés.');
  const { settings } = await page.evaluate(async (g) => (await fetch(`/api/groups/${g}`)).json(), gidOf(betUrl));
  assert.deepEqual(settings.kinds, { yesno: true, multi: true });
  assert.deepEqual(settings.sources.foot.competitions, ['fra.1']);
  assert.deepEqual(settings.sources.usfoot.competitions, ['nfl']);
  assert.deepEqual(settings.sources.meteo.competitions, ['meteo']);
  assert.equal(settings.sources.meteo.params.place.name, 'Lyon');
  assert.equal(settings.categories.find((c) => c.id === 'insolite').hidden, true);
});

let autoUrl;
await test('paris automatiques : la Ligue 1 activée, ses matchs s’ouvrent et le résultat arrive tout seul', async () => {
  upstream.rebase(); // l'horloge du serveur a avancé de plusieurs jours depuis le début des scénarios
  // Le serveur ouvre les paris des compétitions activées toutes les 30 minutes (et juste après un réglage).
  const opened = await instance.deps.sources.autoOpen();
  assert.equal(opened, 2 + 1 + 14, 'un pari par match (Ligue 1 : 2, NFL : 1) ; météo : 7 jours × 2');
  const { page } = max;
  await page.goto(betUrl.split('/bet/')[0]);
  // Léa a activé la Ligue 1, la NFL et la météo : le groupe les propose, Max choisit (sinon rien ne s'affiche chez lui).
  const proposals = page.locator('.proposals');
  await proposals.getByText('⚽ Ligue 1').waitFor();
  assert.equal(await page.locator('.bet-card', { hasText: 'Lille – Lens' }).count(), 0, 'pas encore de paris de Ligue 1 chez Max');
  await shot(page, '26-competitions-proposees');
  await proposals.locator('[data-feed="foot:fra.1"]').getByRole('button', { name: 'Je participe' }).click();
  await page.locator('.bet-card', { hasText: 'Lille – Lens' }).first().waitFor();
  await page.locator('.proposals [data-feed="meteo"]').getByRole('button', { name: 'Non merci' }).click();
  await page.locator('.proposals [data-feed="meteo"]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '⚽ Ligue 1' }).click();
  await waitText(page, 'Football · Ligue 1 · Lille – Lens');
  assert.equal(await page.locator('.bet-card').count(), 2, 'seulement les paris de la Ligue 1');
  // Sous chaque choix, la cote comme chez les bookmakers (+150, +230, +180 chez ESPN), pas les points.
  const lilleCard = page.locator('.bet-card', { hasText: 'Football · Ligue 1 · Lille – Lens' });
  assert.deepEqual(await lilleCard.locator('.opt-chip b').allTextContents(), ['2,50', '3,30', '2,80']);
  assert.equal(await lilleCard.locator('.opt-chip b.fixed').count(), 0);
  await shot(page, '22-paris-auto');
  // Toute la carte mène à la fiche (sauf les options, qui parient d'un geste) : on touche son coin.
  await page.locator('.bet-card', { hasText: 'Football · Ligue 1 · Lille – Lens' }).locator('.card-link').click({ position: { x: 24, y: 16 } });
  await waitText(page, 'Ouvert automatiquement');
  autoUrl = page.url();
  const t = await text(page);
  assert.match(t, /Résultat automatique \(ESPN\)/);
  assert.match(t, /Voir sur ESPN ↗/);
  assert.match(t, /Compte pour le classement ⚽ Ligue 1/);
  assert.match(t, /Cotes des bookmakers/);
  assert.match(t, /Victoire Lille\n2,50/);
  await shot(page, '23-pari-auto', { fullPage: true });

  for (const [p, label] of [[max, 'Victoire Lille'], [tom, 'Match nul'], [ines, 'Victoire Lens']]) {
    await open(p.page, autoUrl);
    await p.page.getByRole('button', { name: `Parier « ${label} »` }).click();
    await dialog(p.page).getByRole('button', { name: 'Je parie !' }).click();
    await waitText(p.page, `Ton pari : « ${label} »`);
  }
  // Le match se joue : Lille gagne 2-1. Le serveur interroge la source (toutes les 5 minutes en vrai).
  await advance(upstream.match('9001').at - clock.now() + 3 * HOUR);
  await instance.deps.sources.checkDue();
  await open(tom.page, autoUrl);
  await waitText(tom.page, 'Pronostics clos. Le résultat officiel arrive tout seul');
  upstream.finish('9001', 2, 1);
  await advance(60_000); // le bouton ne relance pas la source plus d'une fois par minute
  await tom.page.getByRole('button', { name: '🔄 Vérifier le résultat' }).click();
  await waitText(tom.page, 'Résultat reçu');
  // Le résultat officiel règle le pari tout de suite : points aussitôt, pas de contestation.
  await waitText(tom.page, 'Résultat : « Victoire Lille »');
  assert.match(await text(tom.page), /Résultat officiel \(ESPN\) : il ne se conteste pas/);
  assert.match(await text(tom.page), /Score final : Lille 2 – 1 Lens/);
  assert.equal(await tom.page.getByRole('button', { name: 'Contester le résultat' }).count(), 0);
  await shot(tom.page, '24-resultat-auto', { fullPage: true });
  await open(max.page, autoUrl);
  await waitText(max.page, 'Résultat : « Victoire Lille »');
  assert.match(await max.page.locator('.banner').innerText(), /Max \+250 pts/, 'cote des bookmakers 2,50');

  // Les points vont au classement de la Ligue 1, sur sa saison officielle.
  await max.page.getByRole('link', { name: '⚽ Ligue 1' }).click();
  await waitText(max.page, '⚽ Ligue 1 ·');
  const rows = (await max.page.locator('.rank-row').allInnerTexts()).map((r) => r.replace(/\s+/g, ' '));
  assert.match(rows[0], /^1 .*Max .*250 pts$/);
  assert.equal(rows.length, 3, 'les trois qui ont parié');
  await shot(max.page, '25-classement-ligue1');
});

await test('paris de sport en images : logos, score en direct, page Direct, pilotes MotoGP, score final', async () => {
  // Le coup d'envoi et la mi-temps doivent tomber le même jour à Paris (la page Direct montre les matchs du jour).
  const parisHour = (ts) => Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(ts));
  if (parisHour(clock.now()) >= 21) await advance((34 - parisHour(clock.now())) * HOUR); // le lendemain vers 10 h
  const kickoff = Math.ceil((clock.now() + 20 * 60_000) / 60_000) * 60_000;
  upstream.addMatch({ id: '9003', path: 'soccer/fra.1', at: kickoff, home: 'Lyon', away: 'Nice' });
  const home = betUrl.split('/bet/')[0];
  const gid = gidOf(home);
  // Léa ajoute le MotoGP aux compétitions du groupe.
  assert.equal(await lea.page.evaluate(async (g) => (await fetch(`/api/groups/${g}/settings`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: { moto: { competitions: ['motogp'] } } }),
  })).status, gid), 200);
  await instance.deps.sources.autoOpen();

  const { page } = max;
  await page.goto(home);
  await page.locator('.proposals [data-feed="moto:motogp"]').getByRole('button', { name: 'Je participe' }).click();
  await page.getByRole('button', { name: '⚽ Ligue 1' }).click();
  const lyon = page.locator('.bet-card', { hasText: 'Football · Ligue 1 · Lyon – Nice' });
  await lyon.waitFor();
  // Les deux écussons sont chargés (servis par l'app), les options portent le nom des équipes.
  await page.waitForFunction(() => [...document.querySelectorAll('.bet-card.is-match')].slice(0, 2)
    .every((card) => [...card.querySelectorAll('.crest img')].length === 2 && [...card.querySelectorAll('.crest img')].every((i) => i.complete && i.naturalWidth > 0)));
  assert.deepEqual(await lyon.locator('.match-name').allInnerTexts(), ['Lyon', 'Nice']);
  assert.deepEqual((await lyon.locator('.opt-chip span').allInnerTexts()).map((t) => t.trim()), ['Lyon', 'Nul', 'Nice']);
  // Pas de cote de bookmaker pour ce match : barème fixe, la cote 2,00 en grisé.
  assert.deepEqual(await lyon.locator('.opt-chip b.fixed').allTextContents(), ['2,00', '2,00', '2,00']);
  await shot(page, '33-cartes-logos');

  // Max parie depuis la liste, d'un geste (sans fenêtre) : Lyon… puis il change d'avis pour Nice avant la clôture.
  await lyon.getByRole('button', { name: 'Parier « Victoire Lyon »' }).click();
  await waitText(page, 'Pari enregistré : « Victoire Lyon »');
  assert.equal(await dialog(page).count(), 0, 'pas de fenêtre de confirmation');
  await lyon.getByRole('button', { name: 'Parier « Victoire Nice »' }).click();
  await waitText(page, 'Pari changé : « Victoire Nice »');
  assert.equal(await lyon.getByRole('button', { name: 'Parier « Victoire Nice »' }).getAttribute('aria-pressed'), 'true');
  assert.match(await lyon.locator('.bet-card-foot').innerText(), /Ton pari : Nice/);
  await shot(page, '54-pari-rapide-liste');
  await lyon.locator('.card-link').click({ position: { x: 24, y: 16 } });
  await waitText(page, 'Ton pari : « Victoire Nice ». Tu peux changer d’avis jusqu’à la clôture.');
  assert.match(await page.locator('details.history .timeline').textContent(), /a changé d’avis : « Victoire Nice » au lieu de « Victoire Lyon »/);
  assert.deepEqual(await page.locator('button.option').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label'))), ['Parier « Victoire Lyon »', 'Parier « Match nul »']);
  const lyonUrl = page.url();
  // Tom parie sur Lyon, depuis la fiche (avec sa fenêtre de confirmation).
  await open(tom.page, lyonUrl);
  await tom.page.getByRole('button', { name: 'Parier « Victoire Lyon »' }).click();
  await dialog(tom.page).getByRole('button', { name: 'Je parie !' }).click();
  await waitText(tom.page, 'Ton pari : « Victoire Lyon »');

  // Le match se joue : 1-0 pour Lyon à la 29e minute. Le serveur relit le direct chaque minute.
  await advance(kickoff + 30 * 60_000 - clock.now());
  upstream.play('9003', 1, 0, "29'", 'STATUS_FIRST_HALF');
  const firstHalf = [["12'", 'home', 'Goal', 'A. Lacazette', 'R. Cherki'], ["25'", 'away', 'Yellow Card', 'D. Ndayishimiye']];
  upstream.facts('9003', { details: firstHalf, statistics: { possessionPct: [58.4, 41.6], totalShots: [7, 3], shotsOnTarget: [3, 1], wonCorners: [4, 1], foulsCommitted: [5, 8] } });
  // Lyon – Nice, et Lille – Lens (réglé plus tôt sans ses faits : relu une fois pour eux).
  assert.equal(await instance.deps.sources.refreshLive(), 2);
  await advance(60_000);
  assert.equal(await instance.deps.sources.refreshLive(), 1, 'ensuite, seulement le match en cours');
  await page.goto(home);
  await lyon.locator('.status.s-live').waitFor();
  assert.match(await lyon.locator('.status').innerText(), /En direct/i);
  // 4 sections : À parier, Pariés, Clos, Terminés (les vides n'apparaissent pas). Le match en direct est « Clos » (plus
  // rien ne change), en tête de sa section.
  const sectionNames = await page.locator('section[data-section]').evaluateAll((s) => s.map((x) => x.dataset.section));
  assert.ok(sectionNames.every((n) => ['À parier', 'Pariés', 'Clos', 'Terminés'].includes(n)) && sectionNames.includes('Clos'), sectionNames.join(', '));
  assert.match(await page.locator('section[data-section="Clos"] .bet-card').first().innerText(), /Lyon/, 'le match en direct en tête de « Clos »');
  assert.deepEqual(await lyon.locator('.match-score b').allInnerTexts(), ['1', '0']);
  assert.match(await lyon.locator('.match-clock').innerText(), /29'/);
  assert.match(await lyon.locator('.pick-state').innerText(), /ne passe pas/);
  await shot(page, '34-carte-en-direct');

  // La page Direct : les matchs du jour, le direct en premier, mes pronos et où ils en sont.
  await page.locator('.nav').getByRole('link', { name: /Direct/ }).click();
  await page.locator('.live-row').first().waitFor();
  assert.equal(await page.title(), 'Direct · Les Potes — Pari tenu !');
  const t = await text(page);
  assert.match(t, /En direct\n1/);
  // Mon choix se voit sur le match : Nice entouré, « Ton choix » sous son nom (en rouge : Lyon mène).
  const myTeam = page.locator('.live-row', { hasText: 'Lyon' }).locator('.match-team.mine');
  assert.match(await myTeam.innerText(), /Nice[\s\S]*Ton choix/i);
  assert.equal(await page.locator('.live-row', { hasText: 'Lyon' }).getAttribute('class').then((c) => c.includes('ps-losing')), true);
  assert.equal(await page.locator('.live-stat').count(), 4);
  // Sous le score : le buteur, du côté de son équipe.
  const lyonRow = page.locator('.live-row', { hasText: 'Lyon' });
  assert.equal(await lyonRow.locator('.fx-line .fx-cell.home').innerText(), "⚽ A. Lacazette 12'");
  await shot(page, '35-page-direct', { fullPage: true });

  // La fiche du match : le tableau de score en grand.
  await open(page, lyonUrl);
  await page.locator('.match.big .match-score').waitFor();
  assert.equal(await page.title(), 'Ligue 1 · Lyon – Nice · Les Potes — Pari tenu !');
  assert.deepEqual(await page.locator('.match.big .match-score b').allInnerTexts(), ['1', '0']);
  await shot(page, '36-match-en-direct');
  // « Le match » : la chronologie (chaque action du côté de son équipe, le passeur sous le buteur) et les statistiques
  // comparées.
  const facts = page.locator('section.facts');
  assert.deepEqual(await facts.locator('.fx-event').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label'))),
    ["12' : But, A. Lacazette, passe : R. Cherki, Lyon", "25' : Carton jaune, D. Ndayishimiye, Nice"]);
  assert.equal(await facts.locator('.fx-event').first().locator('.fx-cell.home').innerText(), '⚽A. Lacazette\npasse : R. Cherki');
  assert.deepEqual((await facts.locator('.fx-stat-line').allInnerTexts()).slice(0, 2).map((x) => x.replace(/\s+/g, ' ')), ['58 % Possession 42 %', '7 Tirs 3']);
  await facts.screenshot({ path: `${OUT}52-le-match-en-direct.png` });

  // Le MotoGP : les photos des pilotes (recadrées sur le visage par le serveur), leur couleur et leur numéro.
  await page.goto(home);
  await page.getByRole('button', { name: '🏍️ MotoGP' }).click();
  const race = page.locator('.bet-card', { hasText: 'Moto · MotoGP · Grand Prix de Malaisie' }).filter({ hasNotText: 'sprint' });
  await race.waitFor();
  await page.waitForFunction(() => {
    const imgs = [...(document.querySelector('.bet-card .opt-chips.faces')?.querySelectorAll('img') ?? [])];
    return imgs.length >= 7 && imgs.every((i) => i.complete && i.naturalWidth === 160);
  });
  await shot(page, '37-motogp-pilotes');

  // Fin du match : Nice renverse Lyon (1-2). Le direct annonce la fin : le pari est réglé aussitôt (sans attendre
  // l'heure prévue du résultat), le score final s'affiche et Max a ses points.
  upstream.facts('9003', {
    details: [...firstHalf, ["58'", 'away', 'Goal', 'T. Moffi', 'G. Laborde'], ["71'", 'home', 'Red Card', 'C. Tolisso'], ["90'+3'", 'away', 'Penalty - Scored', 'T. Moffi']],
    statistics: { possessionPct: [61, 39], totalShots: [15, 9], shotsOnTarget: [5, 4], wonCorners: [8, 2], foulsCommitted: [11, 14] },
  });
  upstream.finish('9003', 1, 2);
  await advance(60_000);
  await instance.deps.sources.refreshLive();
  await page.getByRole('button', { name: '⚽ Ligue 1' }).click();
  await lyon.locator('.match.over').waitFor();
  assert.deepEqual(await lyon.locator('.match-score b').allInnerTexts(), ['1', '2']);
  assert.match(await lyon.locator('.match-clock').innerText(), /Terminé/);
  assert.match(await lyon.locator('.tag.t-ok').innerText(), /^\+\d+ pts$/, 'réglé : ses points sur la carte');
  await shot(page, '38-score-final');
  // Le match fini : toute la chronologie reste (le doublé de Moffi, le rouge de Tolisso), même une fois le pari réglé.
  await open(page, lyonUrl);
  await page.locator('.match.over').waitFor();
  assert.equal(await facts.locator('.fx-event').count(), 5);
  assert.equal(await facts.locator('.fx-event.k-red .fx-cell.home').innerText(), '🟥C. Tolisso');
  assert.match(await facts.locator('.fx-event').last().innerText(), /T\. Moffi \(pen\.\)/);
  assert.match(await facts.locator('.fx-event', { hasText: "58'" }).innerText(), /T\. Moffi\s+passe : G\. Laborde/);
  assert.match(await facts.locator('.fx-stats').innerText(), /Cartons rouges/);
  await facts.screenshot({ path: `${OUT}53-le-match-fini.png` });
});

await test('sur PC : barre latérale, mes groupes, page d’accueil du site et aide', async () => {
  const pc = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', storageState: await lea.context.storageState() });
  const page = await pc.newPage();
  page.on('pageerror', (e) => errors.push(`[PC] pageerror: ${e.message}`));
  await page.goto(betUrl.split('/bet/')[0]);
  await page.locator('.sidebar').waitFor();
  assert.equal(await page.locator('.nav').isVisible(), false, 'pas de barre du bas sur PC');
  assert.match(await page.locator('.sidebar .side-groups a[aria-current="true"]').innerText(), /Les Potes/);
  await page.locator('.bet-card').first().waitFor();
  // Une liste en lignes : sur chaque carte, la question ou le match à gauche, les choix à droite.
  const rows = await page.evaluate(() => [...document.querySelectorAll('.home .bet-card')].map((card) => {
    const chips = card.querySelector('.opt-chips').getBoundingClientRect();
    const left = card.querySelector('.match, .bet-q').getBoundingClientRect();
    return chips.left > left.right && chips.top < left.bottom;
  }));
  assert.ok(rows.length >= 2 && rows.every(Boolean), `paris en lignes (${rows.join(', ')})`);
  await shot(page, '27-pc-accueil');
  await page.locator('.sidebar').getByRole('link', { name: /Classements/ }).click();
  await page.locator('.rank-row').first().waitFor();
  await shot(page, '28-pc-classements');
  // Les réglages du groupe : l'engrenage à côté de son nom, dans le menu de gauche (pas dans l'en-tête sur PC).
  assert.equal(await page.locator('.topbar').getByRole('link', { name: 'Réglages du groupe' }).count(), 0);
  await page.locator('.sidebar').getByRole('link', { name: 'Réglages du groupe Les Potes' }).click();
  await waitText(page, 'Lien d’invitation');
  assert.equal(await page.locator('.side-gear[aria-current="page"]').count(), 1, 'engrenage allumé');
  await page.locator('.sidebar .side-group').filter({ hasText: 'Les Potes' }).screenshot({ path: `${OUT}41-pc-engrenage.png` });
  await shot(page, '42-pc-reglages-groupe');
  // Aucun lien vers la création d'un groupe dans le menu : on n'y arrive que par le lien d'un coupon.
  assert.equal(await page.locator('.sidebar a[href^="/groups/new"]').count(), 0, 'pas de lien vers la création dans le menu');
  assert.equal(await page.locator('.sidebar').getByRole('link', { name: /créer|rejoindre/i }).count(), 0, 'ni « Créer », ni « Rejoindre » dans le menu');
  await page.goto(`${ORIGIN}/groups/new`);
  await page.locator('#creer').waitFor();
  assert.equal(await page.locator('#creer input[name=coupon]').count(), 1, 'même connectée : un coupon par groupe');
  // Connectée : son compte sert pour le prochain groupe, sans pseudo ni PIN à retaper ; pas de formulaire de connexion.
  assert.match(await page.locator('#creer .identity-row').innerText(), /Léa/);
  assert.equal(await page.getByLabel('Ton pseudo').count(), 0);
  assert.equal(await page.locator('#deja-un-compte').count(), 0);
  await shot(page, '29-pc-creer-groupe');
  // Mes groupes : son compte et ses groupes, sans présentation ni formulaire.
  await page.locator('.landing-top').getByRole('link', { name: 'Mes groupes' }).click();
  await page.waitForURL(`${ORIGIN}/groups`);
  assert.match(await page.locator('.my-groups').innerText(), /Les Potes/);
  assert.equal(await page.locator('a[href^="/groups/new"]').count(), 0, 'pas de bouton « Créer un groupe »');
  assert.match(await page.locator('.landing-section .identity-row').innerText(), /Léa[\s\S]*Connecté sur cet appareil/, 'mon compte, connecté');
  assert.equal(await page.locator('form').count(), 0);
  assert.equal(await page.locator('.sports-grid').count(), 0, 'pas la présentation des sports');
  await shot(page, '29-pc-mes-groupes');
  // L'accueil du site (la marque) : même connectée, le principe, sans formulaire.
  await page.locator('.landing-top .brand').click();
  await page.waitForURL(`${ORIGIN}/`);
  await page.locator('.sports-grid').waitFor(); // l'accueil (Mes groupes a aussi un titre dans son bandeau)
  assert.match(await text(page), /Pronostique\. Chambre tes potes\./);
  assert.equal(await page.locator('form').count(), 0);
  assert.equal(await page.locator('a[href^="/groups/new"]').count(), 0);
  await shot(page, '29-pc-site', { fullPage: true });
  // Le maillot de son avatar (page Moi) : deux chiffres au plus, qui tiennent dans le maillot.
  await page.goto(`${betUrl.split('/bet/')[0]}/me`);
  await page.getByRole('tab', { name: 'Maillot' }).click();
  const number = page.getByLabel('Numéro');
  await number.fill('');
  await number.pressSequentially('1234');
  assert.equal(await number.inputValue(), '12', 'deux chiffres au plus');
  // Le numéro tient dans le maillot : la boîte du texte ne sort pas du corps (x de 13 à 27 sur 40).
  const box = await page.locator('.picker-head svg.jersey').evaluate((svg) => {
    const t = svg.querySelector('text').getBBox();
    return { left: t.x, right: t.x + t.width, top: t.y, bottom: t.y + t.height };
  });
  assert.ok(box.left >= 13.5 && box.right <= 26.5 && box.top >= 15 && box.bottom <= 36, `numéro dans le maillot ${JSON.stringify(box)}`);
  await page.locator('.avatar-picker .picker-head').screenshot({ path: `${OUT}32-maillot.png` });
  await page.goto(`${ORIGIN}/groups`);
  await page.locator('.landing-top').getByRole('link', { name: 'Aide' }).click();
  await page.waitForURL(`${ORIGIN}/help`);
  await page.locator('#help-points').waitFor();
  assert.match(await text(page), /Bon pronostic = 100 × la cote/);
  await shot(page, '30-pc-aide');

  // Aucune catégorie de paris maison : pas de bouton « Nouveau pari », le groupe ne vit que de ses compétitions.
  const home = betUrl.split('/bet/')[0];
  const gid = gidOf(home);
  await page.goto(home);
  const original = await page.evaluate(async (g) => (await (await fetch(`/api/groups/${g}`)).json()).settings.categories, gid);
  const saveCategories = (categories) => page.evaluate(async ([g, list]) => (await fetch(`/api/groups/${g}/settings`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: list }),
  })).status, [gid, categories]);
  assert.equal(await saveCategories(original.map((c) => ({ ...c, hidden: true }))), 200);
  await page.reload();
  await page.locator('.bet-card').first().waitFor();
  assert.deepEqual([await page.locator('.side-new').count(), await page.locator('.nav-new').count()], [0, 0], 'pas de bouton Nouveau pari');
  await page.goto(`${home}/new`);
  await waitText(page, 'Pas de paris maison dans ce groupe');
  assert.equal(await page.locator('textarea[name=question]').count(), 0);
  await shot(page, '31-pc-sans-paris-maison');
  assert.equal(await saveCategories(original), 200);
  await page.goto(home);
  await page.reload();
  await page.locator('.side-new').waitFor();
  await pc.close();
});

await test('admin du site : mot de passe choisi sur le serveur, coupon, son lien, son suivi, comptes et groupes', async () => {
  const pc = await phone('Admin (PC)');
  await pc.page.setViewportSize({ width: 1280, height: 860 });
  // Pas encore de mot de passe : la page dit comment le choisir sur le serveur, sans formulaire pour le faire.
  await pc.page.goto(`${ORIGIN}/admin`);
  await waitText(pc.page, 'npm run admin');
  assert.equal(await pc.page.locator('input[type=password]').count(), 0);
  await instance.deps.admin.setPassword(ADMIN_PASSWORD);
  await pc.page.getByRole('button', { name: 'C’est fait' }).click();
  await pc.page.getByLabel('Mot de passe').fill('pas le bon');
  await pc.page.getByRole('button', { name: 'Se connecter' }).click();
  await waitText(pc.page, 'Encore 4 essais');
  await pc.page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await pc.page.getByRole('button', { name: 'Se connecter' }).click();
  await pc.page.locator('.adm-kpis').waitFor();
  assert.match(await pc.page.title(), /^Vue d’ensemble · Admin/);
  await shot(pc.page, '43-admin-tableau-de-bord');

  // Un coupon pour Sofiane : montré une seule fois, avec son lien.
  await pc.page.getByRole('button', { name: 'Nouveau coupon', exact: true }).click();
  await dialog(pc.page).getByLabel('Pour qui ? (facultatif)').fill('Sofiane');
  await dialog(pc.page).getByRole('tab', { name: '7 jours' }).click();
  await dialog(pc.page).getByRole('button', { name: 'Créer le coupon' }).click();
  const code = (await pc.page.locator('.adm-coupon').innerText()).trim();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  await shot(pc.page, '44-admin-coupon-cree', { keepOverlays: true });
  await dialog(pc.page).getByRole('button', { name: 'J’ai copié, fermer' }).click();

  // Sofiane ouvre le lien : le formulaire de création, coupon rempli.
  const sofiane = await phone('Sofiane');
  await sofiane.page.goto(`${ORIGIN}/groups/new/${code}`);
  const create = sofiane.page.locator('#creer');
  assert.equal(await create.getByLabel('Ton coupon').inputValue(), code);
  assert.equal(new URL(sofiane.page.url()).pathname, '/groups/new', 'le code quitte la barre d’adresse');
  await create.getByLabel('Nom du groupe').fill('Chez Sofiane');
  await create.getByLabel('Ton pseudo').fill('Sofiane');
  await create.locator('input[name=pin]').fill('3579');
  await create.locator('input[name=pin2]').fill('3579');
  await sofiane.page.getByRole('button', { name: 'Créer le groupe' }).click();
  await waitText(sofiane.page, 'Aucun pari pour l’instant');
  // Le même lien une deuxième fois : déjà servi.
  const again = await phone('Sofiane bis');
  await again.page.goto(`${ORIGIN}/c/${code}`); // ancien format de lien : redirigé
  const form = again.page.locator('#creer');
  assert.equal(await form.getByLabel('Ton coupon').inputValue(), code);
  assert.equal(new URL(again.page.url()).pathname, '/groups/new');
  await form.getByLabel('Nom du groupe').fill('Encore');
  await form.getByLabel('Ton pseudo').fill('Sofiane2');
  await form.locator('input[name=pin]').fill('3579');
  await form.locator('input[name=pin2]').fill('3579');
  await again.page.getByRole('button', { name: 'Créer le groupe' }).click();
  await waitText(again.page, 'Ce coupon a déjà servi');
  await again.context.close();

  // L'admin suit le coupon : utilisé par Sofiane, pour « Chez Sofiane ».
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Coupons' }).click();
  await pc.page.getByRole('tab', { name: /^Utilisés/ }).click();
  const row = pc.page.locator('.adm-table tr').filter({ hasText: code.slice(-4) });
  assert.match(await row.innerText(), /Sofiane[\s\S]*Chez Sofiane/);
  await shot(pc.page, '45-admin-coupons');

  // La fiche du groupe (depuis le coupon), puis celle du compte : boutons rapides.
  await row.getByRole('link', { name: 'Chez Sofiane' }).click();
  await waitText(pc.page, 'Copier le lien d’invitation');
  assert.match(await pc.page.locator('.adm-facts').first().innerText(), new RegExp(`…${code.slice(-4)} \\(Sofiane\\)`));
  await pc.page.locator('.adm-table').getByRole('link', { name: 'Sofiane' }).click();
  await waitText(pc.page, 'Réinitialiser le PIN');
  await pc.page.getByRole('button', { name: 'Réinitialiser le PIN' }).click();
  await dialog(pc.page).getByRole('button', { name: 'Réinitialiser' }).click();
  await waitText(pc.page, 'PIN à choisir');
  await shot(pc.page, '46-admin-compte');
  // Sofiane est déconnecté : il rouvre le lien de son groupe et choisit un nouveau PIN.
  await sofiane.page.reload();
  await sofiane.page.waitForURL(/\/invite\//);
  await sofiane.context.close();

  // La liste des comptes (Léa, Max…) et le journal.
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Comptes' }).click();
  await pc.page.getByPlaceholder('Chercher un pseudo').fill('lé');
  assert.match(await pc.page.locator('.adm-table').innerText(), /Léa/);
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Journal' }).click();
  await pc.page.waitForURL(`${ORIGIN}/admin/log`);
  await waitText(pc.page, 'Chaque action de l’admin');
  const journal = await pc.page.locator('.adm-table').first().innerText();
  for (const line of ['Connexion à l’admin', 'Mot de passe admin incorrect', `Coupon …${code.slice(-4)} créé (Sofiane)`, 'utilisé par « Sofiane »', 'PIN de « Sofiane » réinitialisé']) {
    assert.ok(journal.includes(line), line);
  }
  // Les classements des Potes : celui de la Ligue 1, Max en tête (ses points du match Lille – Lens).
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Groupes' }).click();
  await pc.page.locator('.adm-table').getByRole('link', { name: /Les Potes/ }).click();
  await pc.page.locator('.adm-tabs').getByRole('link', { name: 'Classements' }).click();
  const ranks = pc.page.locator('.adm-section').filter({ has: pc.page.getByRole('heading', { name: 'Classements', exact: true }) });
  await ranks.getByRole('tab', { name: /Ligue 1/ }).click();
  await ranks.locator('.adm-table tbody tr').first().filter({ hasText: 'Max' }).waitFor();
  assert.match(await ranks.locator('.adm-table tbody tr').first().innerText(), /Max[\s\S]*pts/);
  await ranks.screenshot({ path: `${OUT}48-admin-classements.png` });

  // Modifier les Potes depuis l'admin : les réglages de Léa relus (Ligue 1, météo à Lyon), la Premier League ajoutée et
  // les points changés, d'un coup ; Max se la voit proposer. Puis tout est remis comme avant pour la suite.
  const editPotes = async (premierLeague, points) => {
    await pc.page.locator('.adm-head').getByRole('link', { name: 'Modifier les réglages' }).click();
    await waitText(pc.page, 'Catégories et paris automatiques');
    const foot = pc.page.locator('[data-source=foot]');
    assert.equal(await foot.getByRole('button', { name: 'Ligue 1', exact: true }).getAttribute('aria-pressed'), 'true');
    await pc.page.locator('[data-source=meteo]').getByText('📍 Lyon (Auvergne-Rhône-Alpes, France)').waitFor();
    const pl = foot.getByRole('button', { name: 'Premier League', exact: true });
    assert.equal(await pl.getAttribute('aria-pressed'), String(!premierLeague));
    await pl.click();
    await pc.page.locator('input[name=basePoints]').fill(String(points));
  };
  const reglages = pc.page.locator('.adm-section').filter({ has: pc.page.getByRole('heading', { name: 'Réglages', exact: true }) });
  const settingsTab = () => pc.page.locator('.adm-tabs').getByRole('link', { name: 'Réglages' }).click();
  await editPotes(true, 150);
  await shot(pc.page, '50-admin-modifier', { fullPage: true });
  await pc.page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await waitText(pc.page, 'Groupe enregistré.');
  await settingsTab();
  await reglages.getByText('150 × la cote').waitFor();
  assert.match(await reglages.innerText(), /Ligue 1[\s\S]*Premier League/);
  await reglages.screenshot({ path: `${OUT}51-admin-reglages.png` });
  const proposed = await max.page.evaluate(async (g) => (await (await fetch(`/api/groups/${g}/feeds`)).json()).feeds, gidOf(betUrl));
  assert.equal(proposed.find((f) => f.key === 'foot:eng.1')?.choice, null, 'proposée à Max, qui choisit');
  await editPotes(false, 100);
  await pc.page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await waitText(pc.page, 'Groupe enregistré.');
  await settingsTab();
  await reglages.getByText('100 × la cote').waitFor();
  assert.doesNotMatch(await reglages.innerText(), /Premier League/);
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Journal' }).click();
  await waitText(pc.page, 'compétitions (− ⚽ Premier League)');
  assert.match(await pc.page.locator('.adm-table').first().innerText(), /points et délais, compétitions \(\+ ⚽ Premier League\)/);

  // Sources : la météo coupée pour tout le site (plus sur l'accueil), puis rallumée.
  await pc.page.locator('.adm-nav').getByRole('link', { name: 'Sources' }).click();
  const meteo = pc.page.locator('.adm-src').filter({ hasText: 'Open-Meteo' });
  await meteo.getByRole('switch', { name: 'Source Météo' }).click();
  await dialog(pc.page).getByRole('button', { name: 'Couper pour tout le site' }).click();
  await meteo.getByText('Coupée', { exact: true }).waitFor();
  const catalog = async () => (await (await fetch(`${ORIGIN}/api/instance`)).json()).catalog.map((x) => x.id);
  assert.ok(!(await catalog()).includes('meteo'), 'plus proposée sur l’accueil');
  await shot(pc.page, '49-admin-sources');
  assert.equal(await meteo.getByRole('switch').getAttribute('aria-checked'), 'false');
  await meteo.getByRole('switch', { name: 'Source Météo' }).click();
  await dialog(pc.page).getByRole('button', { name: 'Rallumer' }).click();
  await meteo.locator('.adm-switch[aria-checked="true"]').waitFor();
  assert.ok((await catalog()).includes('meteo'));

  // Téléphone : la barre du bas remplace le menu, les tableaux deviennent des listes.
  await pc.page.setViewportSize({ width: 390, height: 844 });
  await pc.page.locator('.adm-bnav').getByRole('link', { name: 'Coupons' }).click();
  await pc.page.getByRole('tab', { name: /^Utilisés/ }).click();
  await pc.page.locator('.adm-table').waitFor();
  assert.equal(await pc.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de défilement horizontal');
  await shot(pc.page, '47-admin-telephone');
  await pc.page.locator('.adm-bnav').getByRole('button', { name: 'Plus' }).click();
  await dialog(pc.page).getByRole('button', { name: 'Se déconnecter' }).click();
  await pc.page.getByLabel('Mot de passe').waitFor();
  await pc.context.close();
});

await test('installable : manifeste, icônes et service worker', async () => {
  const { page } = lea;
  await page.goto(ORIGIN);
  const manifest = await (await fetch(`${ORIGIN}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((i) => i.sizes === size && i.type === 'image/png');
    assert.ok(icon, size);
    assert.equal((await fetch(ORIGIN + icon.src)).status, 200);
  }
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await reload(page);
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  // Dans le navigateur, « / » reste l'accueil du site ; l'app installée (sans barre d'adresse) file vers le dernier groupe.
  assert.equal(new URL(page.url()).pathname, '/');
  const app = await phone('Léa (appli installée)', { storageState: await lea.context.storageState() });
  await app.context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
  await app.page.goto(ORIGIN);
  await app.page.waitForURL(GROUP_URL);
  // Les anciennes adresses en « #/ » (favoris, applis installées avant) mènent à la même page, sans #.
  await app.page.goto(`${ORIGIN}/#/${gidOf(betUrl)}/rank`);
  await app.page.waitForURL(`${ORIGIN}/${gidOf(betUrl)}/rank`);
  await app.page.locator('.rank-row').first().waitFor();
  // … et les anciennes adresses en français : l'aide (et ses sections) devient /help.
  await app.page.goto(`${ORIGIN}/#/aide/installer`);
  await app.page.waitForURL(`${ORIGIN}/help/installer`);
  await app.page.locator('#help-install').waitFor();
  await app.context.close();
});

await test('mode sombre', async () => {
  const dark = await phone('Léa (sombre)', { colorScheme: 'dark', storageState: await lea.context.storageState() });
  await dark.page.goto(betUrl.split('/bet/')[0]);
  await dark.page.locator('.bet-card').first().waitFor();
  const bg = await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(7, 13, 25)');
  await shot(dark.page, '18-mode-sombre');
  await open(dark.page, betUrl);
  await waitText(dark.page, 'Résultat : « Non »');
  await shot(dark.page, '19-pari-sombre', { fullPage: true });
  await dark.context.close();
});

// Le thème du site : l'admin le choisit dans « Apparence », tout le monde le voit à sa page suivante.
const THEME_LOOK = {
  stade: ['system-ui', null], tribune: ['Source Sans 3', 'rgb(254, 242, 242)'], nocturne: ['Barlow', 'rgb(5, 5, 6)'],
  recre: ['DM Sans', 'rgb(255, 244, 214)'], arene: ['Chakra Petch', 'rgb(15, 15, 35)'], vestiaire: ['Work Sans', 'rgb(255, 255, 255)'],
};
await test('thèmes : l’admin du site en choisit un, l’appli change pour tout le monde', async () => {
  const home = betUrl.split('/bet/')[0];
  const adm = await phone('Admin (PC)');
  await adm.page.setViewportSize({ width: 1280, height: 860 });
  await adm.page.goto(`${ORIGIN}/admin#/apparence`); // ancienne adresse : convertie en /admin/configuration/theme
  await adm.page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await adm.page.getByRole('button', { name: 'Se connecter' }).click();
  await adm.page.locator('.adm-theme').first().waitFor();
  assert.equal(adm.page.url(), `${ORIGIN}/admin/configuration/theme`);
  assert.equal(await adm.page.locator('.adm-theme').count(), 6);
  assert.match(await adm.page.locator('.adm-theme.is-current').innerText(), /Stade[\s\S]*Thème actuel/);
  await adm.page.getByRole('button', { name: 'Choisir le thème Nocturne' }).click();
  await dialog(adm.page).getByRole('button', { name: 'Choisir Nocturne' }).click();
  await waitText(adm.page, 'Thème « Nocturne » appliqué à tout le site.');
  await adm.page.locator('.adm-theme.is-current[data-theme="nocturne"]').waitFor();
  await shot(adm.page, '60-admin-apparence');

  const pcLea = await phone('Léa (PC)', { storageState: await lea.context.storageState() });
  await pcLea.page.setViewportSize({ width: 1440, height: 900 });
  const look = async (page) => page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor,
  }));
  for (const theme of ['nocturne', 'tribune', 'recre', 'arene', 'vestiaire', 'stade']) {
    if (theme !== 'nocturne') {
      const status = await adm.page.evaluate(async (t) => (await fetch('/api/admin/theme', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: t }),
      })).status, theme);
      assert.equal(status, 200, theme);
    }
    const [font, bg] = THEME_LOOK[theme];
    for (const [p, suffix] of [[lea.page, ''], [pcLea.page, '-pc']]) {
      await open(p, home);
      await p.locator('.bet-card').first().waitFor();
      await p.evaluate(() => document.fonts.ready);
      const seen = await look(p);
      assert.ok(seen.font.replaceAll('"', '').startsWith(font), `${theme} : police ${seen.font}`);
      if (bg) assert.equal(seen.bg, bg, `${theme} : fond`);
      if (theme !== 'stade') assert.equal(await p.evaluate((f) => document.fonts.check(`16px "${f}"`), font), true, `${theme} : police chargée`);
      await shot(p, `61-theme-${theme}${suffix}`);
    }
  }
  // Téléphone : « Parier » au centre de la barre du bas, « Moi » sur l'avatar en haut.
  assert.equal(await lea.page.locator('.nav .nav-new').count(), 1);
  assert.equal(await lea.page.locator('.topbar .me-link').count(), 1);
  assert.equal(await lea.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de défilement horizontal');
  // PC large : la colonne de droite (classement, activité) à côté de la liste.
  await pcLea.page.locator('.home-rail .rail-card').first().waitFor();
  assert.ok(await pcLea.page.locator('.home-rail .rail-rank li').count() >= 2);
  await pcLea.context.close();
  await adm.context.close();
});

// La configuration de l'installation : son nom, son adresse publique, son hébergeur et son icône, dans tout le site.
await test('configuration : l’admin du site renomme l’installation, son adresse et son icône partout', async () => {
  const adm = await phone('Admin config (PC)');
  await adm.page.setViewportSize({ width: 1280, height: 860 });
  await adm.page.goto(`${ORIGIN}/admin/configuration`);
  await adm.page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await adm.page.getByRole('button', { name: 'Se connecter' }).click();
  // Les champs, par leur nom (leur libellé porte aussi l'explication).
  const input = (name) => adm.page.locator(`.adm-config [name="${name}"]`);
  await input('name').waitFor();
  assert.equal(await input('name').inputValue(), 'Pari tenu !');
  await input('name').fill('Paris entre Couilles');
  await input('shortName').fill('EntreCouilles');
  await input('publicUrl').fill('https://paris.entrecouilles.fr');
  await input('hostName').fill('Duck Platform');
  await input('hostUrl').fill('https://duckplatform.net');
  // Aperçu en direct, avant d'enregistrer.
  assert.match(await adm.page.locator('.adm-preview').innerText(), /Paris entre Couilles[\s\S]*EntreCouilles[\s\S]*https:\/\/paris\.entrecouilles\.fr\/invite\/…/);
  await adm.page.getByRole('button', { name: 'Enregistrer' }).click();
  await waitText(adm.page, 'Configuration enregistrée');
  await adm.page.locator('.adm-side .adm-brand', { hasText: 'Paris entre Couilles' }).waitFor();
  assert.equal(await adm.page.title(), 'Configuration · Admin — Paris entre Couilles');

  // Une icône : un carré jaune sur fond bleu nuit, recadrée et déclinée par le serveur.
  const side = 512;
  const data = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const inner = x > 140 && x < 372 && y > 140 && y < 372;
      data.set(inner ? [255, 196, 0, 255] : [11, 20, 38, 255], (y * side + x) * 4);
    }
  }
  await adm.page.getByRole('tab', { name: 'Icône' }).click();
  await adm.page.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: encodePng({ width: side, height: side, data }) });
  await waitText(adm.page, 'Nouvelle icône pour tout le site.');
  await adm.page.locator('.adm-side .adm-brand img[src^="/brand/icon-192.png?v="]').waitFor();
  await adm.page.getByRole('button', { name: 'Revenir à l’icône d’origine' }).waitFor();
  await shot(adm.page, '64-admin-configuration', { fullPage: true });

  // Un visiteur : l'accueil au nouveau nom, le crédit PariTenu et l'hébergeur en pied de page.
  const visitor = await phone('Visiteur');
  await visitor.page.goto(`${ORIGIN}/`);
  await visitor.page.locator('.landing-hero h1').waitFor();
  assert.equal(await visitor.page.title(), 'Paris entre Couilles · paris gratuits entre amis');
  assert.equal((await visitor.page.locator('.landing-top .brand').textContent()).trim(), 'Paris entre Couilles');
  assert.match(await visitor.page.locator('.landing-top .brand img').getAttribute('src'), /^\/brand\/icon-192\.png\?v=\d+$/);
  assert.equal(await visitor.page.locator('.landing-hero h1 em').textContent(), 'Sans miser un centime.');
  assert.match(await visitor.page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), /^\/brand\/icon-180\.png/);
  const credits = visitor.page.locator('.site-foot .credits');
  assert.equal(await credits.textContent(), 'Propulsé par PariTenu, logiciel libre · Hébergé par Duck Platform');
  assert.equal(await credits.getByRole('link', { name: 'Duck Platform' }).getAttribute('href'), 'https://duckplatform.net');
  const manifest = await visitor.page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  assert.deepEqual([manifest.name, manifest.short_name], ['Paris entre Couilles', 'EntreCouilles']);
  await shot(visitor.page, '65-accueil-renomme', { fullPage: true });
  await visitor.page.setViewportSize({ width: 1440, height: 900 });
  await shot(visitor.page, '66-accueil-renomme-pc');
  await visitor.page.goto(`${ORIGIN}/help`);
  await waitText(visitor.page, 'Paris entre Couilles est un jeu de pronostics entre amis');
  assert.match(await visitor.page.locator('.help-credits').innerText(), /Hébergé par Duck Platform/);
  await visitor.context.close();

  // Léa partage le lien de son groupe : il part sur l'adresse publique.
  const home = betUrl.split('/bet/')[0];
  await lea.page.goto(`${home}/admin`);
  await lea.page.reload();
  await lea.page.locator('.invite-link code').waitFor();
  assert.match(await lea.page.locator('.invite-link code').innerText(), /^https:\/\/paris\.entrecouilles\.fr\/invite\/[\w-]+$/); // jeton en base64url : « - » et « _ »
  await lea.page.getByRole('button', { name: 'Partager', exact: true }).click();
  const sent = await lea.page.evaluate(() => window.__shared.at(-1));
  assert.match(sent.url, /^https:\/\/paris\.entrecouilles\.fr\/invite\//);
  assert.match(sent.text, /sur Paris entre Couilles$/);
  assert.match(await lea.page.title(), / — Paris entre Couilles$/);

  // Retour aux valeurs de PariTenu (les tests suivants attendent « Pari tenu ! »).
  const reset = await adm.page.evaluate(async () => {
    const call = (method, path, body) => fetch(`/api/admin${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return [
      (await call('PATCH', '/branding', { name: 'Pari tenu !', shortName: 'Pari tenu', publicUrl: '', hostName: '', hostUrl: '' })).status,
      (await call('DELETE', '/icon', {})).status,
    ];
  });
  assert.deepEqual(reset, [200, 200]);
  await lea.page.reload();
  await lea.page.locator('.invite-link code').waitFor();
  assert.match(await lea.page.locator('.invite-link code').innerText(), new RegExp(`^${ORIGIN}/invite/`));
  assert.match(await lea.page.title(), / — Pari tenu !$/);
  await adm.context.close();
});

await test('un admin supprime son groupe, en retapant son nom', async () => {
  const { page } = max;
  const groupsOf = () => page.evaluate(async () => (await (await fetch('/api/account')).json()).groups);
  const jeudi = (await groupsOf()).find((g) => g.name === 'Le Foot du jeudi');
  await page.goto(`${ORIGIN}/${jeudi.id}/admin`);
  await page.getByRole('button', { name: 'Supprimer le groupe' }).click();
  const box = dialog(page);
  await box.getByLabel('Retape le nom du groupe pour confirmer').fill('le foot du jeudi');
  await shot(page, '55-supprimer-groupe', { keepOverlays: true });
  await box.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await waitText(page, 'Groupe « Le Foot du jeudi » supprimé.');
  await page.waitForURL(/\/groups$/);
  assert.ok(!(await groupsOf()).some((g) => g.name === 'Le Foot du jeudi'));
  assert.ok((await groupsOf()).some((g) => g.name === 'Les Potes'), 'ses autres groupes restent');
});

await test('accueil de Léa à la fin (récapitulatif)', async () => {
  const { page } = lea;
  await page.goto(betUrl.split('/bet/')[0]);
  await page.locator('.bet-card').first().waitFor();
  await shot(page, '20-accueil-fin', { fullPage: true });
});

// ——— Planche récapitulative : les écrans clés sur une seule image

const PLANCHE = [
  ['03-invitation', 'Rejoindre par le lien'], ['05-pari-lance', 'Pari lancé'], ['06-confirmer-pari', 'Parier : points potentiels'],
  ['09-trancher', 'L’arbitre tranche'], ['10-vote', 'Contestation et vote'], ['11-pari-regle', 'Pari réglé'],
  ['12-classement', 'Classement'], ['13-profil', 'Profil et badges'], ['14-activite', 'Fil d’activité'], ['18-mode-sombre', 'Mode sombre'],
  ['21-reglages-paris', 'Réglages des paris'], ['22-paris-auto', 'Paris ouverts tout seuls'], ['23-pari-auto', 'Un match de Ligue 1'],
  ['24-resultat-auto', 'Résultat automatique'], ['25-classement-ligue1', 'Classement de la Ligue 1'], ['26-competitions-proposees', 'Compétitions proposées'],
  ['27-pc-accueil', 'Sur PC'], ['28-pc-classements', 'Classements sur PC'], ['29-pc-site', 'Le site'],
  ['61-theme-tribune', 'Thème Tribune'], ['61-theme-nocturne', 'Thème Nocturne'], ['61-theme-recre', 'Thème Récré'],
  ['61-theme-arene', 'Thème Arène'], ['61-theme-vestiaire', 'Thème Vestiaire'],
];
if (results.every((r) => r.ok)) {
  const { readFile } = await import('node:fs/promises');
  const tiles = await Promise.all(PLANCHE.map(async ([file, caption]) => {
    const src = `data:image/png;base64,${(await readFile(`${OUT}${file}.png`)).toString('base64')}`;
    return `<figure><img src="${src}"><figcaption>${caption}</figcaption></figure>`;
  }));
  const page = await (await browser.newContext({ viewport: { width: 1376, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`<style>
    body{margin:0;padding:28px;background:#1d1b26;font:600 20px system-ui,sans-serif;color:#fff}
    h1{margin:0 0 20px;font-size:30px} h1 span{color:#ffcc33}
    main{display:grid;grid-template-columns:repeat(5,248px);gap:20px}
    figure{margin:0} img{display:block;width:248px;height:537px;object-fit:cover;object-position:top;border-radius:20px;border:3px solid #3a3750}
    figcaption{margin-top:8px;text-align:center}
  </style><h1>🎲 Pari tenu ! <span>— captures des tests de bout en bout</span></h1><main>${tiles.join('')}</main>`);
  await page.screenshot({ path: `${OUT}planche.png`, fullPage: true });
}

// ——— Bilan

await browser.close();
await new Promise((r) => server.close(r));
instance.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis. Captures : ${OUT}`);
process.exit(failed.length ? 1 : 0);
