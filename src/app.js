import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { DEFAULT_THEME, themeOf } from './core/themes.js';
import { openDatabase } from './db.js';
import { createClock } from './lib/clock.js';
import { HttpError } from './lib/errors.js';
import { RateLimiter } from './lib/rateLimit.js';
import { apiRouter } from './routes/api.js';
import { AccountService } from './services/accounts.js';
import { ActivityService } from './services/activity.js';
import { AdminService } from './services/admin.js';
import { BrandingService } from './services/branding.js';
import { BetService } from './services/bets.js';
import { CouponService } from './services/coupons.js';
import { FollowService } from './services/follows.js';
import { GroupService } from './services/groups.js';
import { LiveStore } from './services/live.js';
import { MediaService } from './services/media.js';
import { SeasonService } from './services/seasons.js';
import { SourceService } from './services/sources.js';
import { StatsService } from './services/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');

const silentLogger = { info() {}, warn() {}, error() {} };

/** fetch : remplaçable en test par un faux fournisseur de données (test/fake-upstream.js). */
export function createApp(config, { db, clock = createClock(), logger = silentLogger, fetch = globalThis.fetch } = {}) {
  db ??= openDatabase(config.dbPath);
  const accounts = new AccountService(db, clock, { pinParams: config.pinParams });
  const groups = new GroupService(db, clock, accounts);
  // Le nom, l'adresse, les textes et l'icône de l'installation (page Configuration de l'admin du site).
  const branding = new BrandingService(db, { dir: config.dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(config.dbPath)), 'branding') });
  const coupons = new CouponService(db, clock, { siteName: () => branding.get().name });
  const seasons = new SeasonService(db, clock, groups);
  const follows = new FollowService(db, clock);
  const live = new LiveStore(db, clock);
  const bets = new BetService(db, clock, groups, seasons, follows, live);
  const stats = new StatsService(db, clock, groups, seasons);
  const activity = new ActivityService(db, clock, { bets, seasons, groups });
  const sources = new SourceService(db, clock, groups, bets, { fetch, logger, live, keys: config.sourceKeys });
  const admin = new AdminService(db, clock, { accounts, groups, coupons, sources, seasons, pinParams: config.pinParams });
  // Logos et photos des sources : gardés sur disque à côté de la base (en mémoire seulement pour une base en mémoire).
  const media = new MediaService({ fetch, clock, logger, dir: config.dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(config.dbPath)), 'media') });
  const deps = { config, db, clock, accounts, groups, coupons, admin, branding, bets, seasons, follows, stats, activity, sources, live, media, logger };
  seasons.backfill(); // paris d'avant les classements par saison
  // Paris automatiques qu'une source ne propose plus (ou d'une compétition coupée), encore sans pronostic : retirés.
  for (const { id } of db.prepare('SELECT id FROM groups').all()) sources.prune(id);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // Sur le réseau local en http, un HSTS ou un upgrade-insecure-requests casserait l'app.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Moteurs de recherche : seul l'accueil (/) peut être indexé. Tout le reste (groupes, invitations, mes groupes, aide,
  // admin, API, images) porte « noindex », et robots.txt interdit d'y aller (les robots polis ne chargent même pas un
  // lien d'invitation, qui montrerait le nom du groupe et les pseudos de ses membres).
  app.use((req, res, next) => {
    if (req.path !== '/') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.get('/robots.txt', (req, res) => {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }).send(ROBOTS_TXT);
  });

  app.use('/api', apiRouter(deps));

  // Images des sources (logos, drapeaux, photos de pilotes) : relayées et réduites, gardées une semaine par le navigateur.
  const mediaLimiter = new RateLimiter({ limit: 900, windowMs: 5 * 60_000 });
  app.get('/media/:id', async (req, res) => {
    if (!mediaLimiter.take(req.ip)) return res.status(429).type('text/plain').send('Trop de requêtes.');
    const image = await media.get(req.params.id);
    if (!image) return res.status(404).set('Cache-Control', 'public, max-age=3600').type('text/plain').send('Image introuvable.');
    res.set({ 'Content-Type': image.type, 'Cache-Control': 'public, max-age=604800, immutable' }).send(image.body);
  });

  // Le thème choisi par l'admin du site, chargé par chaque page après app.css (vide pour l'habillage d'origine).
  app.get('/theme.css', (req, res) => {
    const theme = admin.theme();
    res.set({ 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    if (theme === DEFAULT_THEME) return res.send(`/* Thème « ${themeOf(theme).name} » : public/css/app.css seule. */\n`);
    // Sans date ni ETag : une même adresse sert plusieurs fichiers, un « 304 » garderait l'ancien thème en cache.
    res.sendFile(path.join(PUBLIC_DIR, 'css', 'themes', `${theme}.css`), { lastModified: false, etag: false, headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  });

  // La coquille de l'app et de l'admin, le manifeste et l'icône : au nom de l'installation (page Configuration).
  const shells = { index: readShell('index.html'), admin: readShell('admin.html') };
  const sendIndex = (req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.send(renderShell(shells.index, branding));
  };
  app.get('/manifest.webmanifest', (req, res) => {
    res.set({ 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
    res.send(JSON.stringify(manifest(branding), null, 2));
  });
  // L'icône téléversée, dans ses tailles : l'adresse porte sa version (?v=), elle peut rester en cache.
  app.get('/brand/:file', (req, res) => {
    const body = branding.iconFile(req.params.file);
    if (!body) return res.status(404).type('text/plain').send('Icône introuvable.');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(body);
  });
  // Les adresses de l'app, en anglais (/, /groups, /groups/new[/<coupon>], /help[/<section>], /invite/<lien>,
  // /<groupe>/…) : la même coquille, le routeur de public/js/main.js choisit l'écran. Un groupe = 16 caractères
  // hexadécimaux (newId).
  app.get(['/', '/groups', '/groups/new', '/groups/new/:code', '/help', '/help/:section', '/invite/:token'], sendIndex);
  app.get(/^\/[0-9a-f]{16}(\/.*)?$/, sendIndex);
  // Les anciennes adresses, déjà partagées (WhatsApp, favoris) : vers leur équivalent.
  const to = (res, path, query = '') => res.redirect(302, path + query);
  app.get('/c/:code', (req, res) => to(res, `/groups/new/${encodeURIComponent(req.params.code)}`));
  app.get('/g/:token', (req, res) => {
    const bet = req.query.pari ?? req.query.bet;
    to(res, `/invite/${encodeURIComponent(req.params.token)}`, typeof bet === 'string' ? `?bet=${encodeURIComponent(bet)}` : '');
  });
  app.get(['/aide', '/aide/:section'], (req, res) => to(res, req.params.section ? `/help/${encodeURIComponent(req.params.section)}` : '/help'));
  // Admin de l'instance (/admin, /admin/users, /admin/groups/<id>…) : une page à part, jamais en cache ni indexée.
  app.get(/^\/admin(\/.*)?$/, (req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.send(renderShell(shells.admin, branding, { admin: true }));
  });
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    },
  }));
  app.use((req, res) => res.status(404).type('text/plain').send('Page introuvable.'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON illisible.', code: 'bad_json' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.', code: 'too_large' });
    // Adresse illisible (« %% » mal encodé…) : Express la refuse avec un statut 400.
    if (err?.status === 400) return res.status(400).json({ error: 'Adresse invalide.', code: 'bad_request' });
    logger.error({ err: err?.stack ?? String(err), path: req.path }, 'Erreur inattendue');
    res.status(500).json({ error: 'Oups, une erreur inattendue. Réessaie.', code: 'internal' });
  });

  const timer = config.sweepEveryMs ? setInterval(() => {
    try {
      bets.sweepAll();
      seasons.closeDue();
    } catch (err) {
      logger.error({ err: err.stack }, 'Échéances : échec');
    }
  }, config.sweepEveryMs) : null;
  timer?.unref();

  // Résultats des paris reliés à une source (match fini, relevé météo…) : une vérification à la fois.
  let checking = false;
  const sourceTimer = config.sourceCheckEveryMs ? setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      bets.sweepAll();
      await sources.checkDue();
    } catch (err) {
      logger.error({ err: err.stack }, 'Résultats des sources : échec');
    } finally {
      checking = false;
    }
  }, config.sourceCheckEveryMs) : null;
  sourceTimer?.unref();

  // Scores en direct des rencontres en cours (rien à faire quand aucun match ne se joue).
  let refreshing = false;
  const liveTimer = config.liveEveryMs ? setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await sources.refreshLive();
    } catch (err) {
      logger.error({ err: err.stack }, 'Direct : échec');
    } finally {
      refreshing = false;
    }
  }, config.liveEveryMs) : null;
  liveTimer?.unref();

  // Paris des compétitions activées : ouverts tout seuls au démarrage, puis toutes les 30 minutes ; les liens des paris
  // déjà ouverts sont corrigés au passage (SourceService.relink).
  let opening = false;
  const openAll = async () => {
    if (opening) return;
    opening = true;
    try {
      await sources.autoOpen();
      await sources.relink();
      sources.repairMatchups(); // visuels d'une rencontre à deux dont l'affiche a changé
    } catch (err) {
      logger.error({ err: err.stack }, 'Ouverture automatique : échec');
    } finally {
      opening = false;
    }
  };
  const openTimer = config.autoOpenEveryMs ? setInterval(openAll, config.autoOpenEveryMs) : null;
  openTimer?.unref();
  const firstOpen = config.autoOpenEveryMs ? setTimeout(openAll, 5_000) : null;
  firstOpen?.unref();

  return {
    app,
    deps,
    close() {
      if (timer) clearInterval(timer);
      if (sourceTimer) clearInterval(sourceTimer);
      if (openTimer) clearInterval(openTimer);
      if (liveTimer) clearInterval(liveTimer);
      if (firstOpen) clearTimeout(firstOpen);
      db.close();
    },
  };
}

// L'accueil seul (« $ » : l'adresse exacte, compris par Google, Bing, DuckDuckGo, Qwant, Yandex), avec de quoi l'afficher
// (feuilles de style, scripts, polices, icônes, le catalogue des sports) ; tout le reste est interdit.
const ROBOTS_TXT = `# PariTenu : seul l'accueil se laisse indexer ; les groupes, les invitations et l'admin restent privés.
User-agent: *
Allow: /$
Allow: /css/
Allow: /js/
Allow: /theme.css
Allow: /fonts/
Allow: /icons/
Allow: /img/
Allow: /brand/
Allow: /manifest.webmanifest
Allow: /api/instance$
Disallow: /
`;

// ——— Coquille de l'app au nom de l'installation (services/branding.js)

const readShell = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * index.html ou admin.html au nom de l'installation : titre, description, nom sous l'icône, icônes, et la balise
 * <meta name="instance"> que lit l'app (public/js/state.js : brand). Pas de script en ligne : la CSP ne bouge pas.
 */
export function renderShell(html, branding, { admin = false } = {}) {
  const b = branding.get();
  const tab = branding.iconUrl(32);
  const phone = branding.iconUrl(180);
  // Remplacements par fonction : un « $& » tapé dans un texte de l'admin reste du texte.
  let out = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(admin ? `Admin — ${b.name}` : b.name)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (all, start, end) => `${start}${esc(b.intro)}${end}`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(">)/, (all, start, end) => `${start}${esc(b.shortName)}${end}`)
    .replace('<meta charset="utf-8">', () => `<meta charset="utf-8">\n  <meta name="instance" content="${esc(JSON.stringify(branding.public()))}">`);
  if (tab) out = out.replace('<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">', () => `<link rel="icon" href="${tab}" type="image/png">`);
  if (phone) out = out.replace('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">', () => `<link rel="apple-touch-icon" href="${phone}">`);
  return out;
}

const BASE_MANIFEST = JSON.parse(readShell('manifest.webmanifest'));

/** Le manifeste de l'app installable, au nom de l'installation (et avec son icône s'il y en a une). */
export function manifest(branding) {
  const b = branding.get();
  const icons = b.icon ? [
    { src: branding.iconUrl(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: branding.iconUrl(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: branding.iconUrl(512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ] : BASE_MANIFEST.icons;
  return { ...BASE_MANIFEST, name: b.name, short_name: b.shortName, description: b.intro, icons };
}
