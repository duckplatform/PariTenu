import express from 'express';
import { z } from 'zod';
import { THEME_IDS, THEMES } from '../core/themes.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { ADMIN_MAX_MS } from '../services/admin.js';
import { avatar, Branding, emoji, groupName, id, parse, PlaceQuery, pseudo, readCookies, Settings } from './inputs.js';

// Cookie de l'admin : réservé à /api/admin, jamais envoyé depuis un autre site (SameSite=Strict).
export const ADMIN_COOKIE = 'pt_admin';

const role = z.enum(['admin', 'member'], { error: 'Rôle inconnu.' });
const NewPlayer = z.object({ pseudo, avatar, groupId: id, role: role.default('member') });
const Identity = z.object({ pseudo: pseudo.optional(), avatar: avatar.optional() });
const GroupInput = z.object({ name: groupName, emoji });
const NewGroup = GroupInput.extend({ playerId: id });
const GroupEdit = GroupInput.extend({ settings: Settings.optional() });
const NewCoupon = z.object({
  note: z.string().trim().max(60, 'La note fait au plus 60 caractères.').default(''),
  days: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]).default(30),
});
// Supprimer : on retape le nom (pseudo ou groupe), comme sur GitHub.
const Confirm = z.object({ confirm: z.string().max(60) });

/**
 * Admin de l'instance (/admin) : comptes, groupes, coupons et journal. Tout passe par une session admin (mot de passe
 * choisi sur le serveur) ; les garde-fous CSRF du routeur parent (JSON obligatoire, même origine) s'appliquent aussi.
 */
export function adminRouter(deps, { isSecure, authLimit }) {
  const { admin, branding, config, logger } = deps;
  const r = express.Router();
  const ip = (req) => req.ip ?? '';
  // L'icône telle que la montrent l'onglet, l'écran du téléphone et l'en-tête (null : celle de PariTenu).
  const iconUrls = () => (branding.get().icon ? { tab: branding.iconUrl(32), phone: branding.iconUrl(180), logo: branding.iconUrl(192) } : null);
  const token = (req) => readCookies(req)[ADMIN_COOKIE];
  const ok = (res) => res.json({ ok: true });

  r.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  r.get('/session', (req, res) => {
    res.json({ signedIn: !!admin.authenticate(token(req)), hasPassword: admin.hasPassword() });
  });

  r.post('/login', authLimit, async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1, 'Tape le mot de passe.').max(200) }), req.body);
    const session = await admin.login(password, { ip: ip(req), userAgent: req.headers['user-agent'] ?? '' });
    res.cookie(ADMIN_COOKIE, session, { httpOnly: true, sameSite: 'strict', secure: isSecure(req), maxAge: ADMIN_MAX_MS, path: '/api/admin' });
    ok(res);
  });

  r.post('/logout', (req, res) => {
    admin.logout(token(req), ip(req));
    res.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
    ok(res);
  });

  // Tout le reste : session admin obligatoire.
  r.use((req, res, next) => {
    if (!admin.authenticate(token(req))) throw new HttpError(401, 'Session admin fermée : reconnecte-toi.', 'admin_unauthorized');
    next();
  });

  r.get('/overview', (req, res) => res.json(admin.overview()));
  r.get('/nav', (req, res) => res.json(admin.nav()));
  r.get('/log', (req, res) => res.json({ entries: admin.logEntries(), sessions: admin.adminSessions() }));

  // ——— Comptes

  r.get('/players', (req, res) => res.json({ players: admin.playerList() }));
  r.get('/players/:id', (req, res) => res.json({ player: admin.player(req.params.id) }));

  r.post('/players', (req, res) => {
    res.status(201).json({ id: admin.createPlayer(parse(NewPlayer, req.body), ip(req)) });
  });

  r.patch('/players/:id', (req, res) => {
    admin.updatePlayer(req.params.id, parse(Identity, req.body), ip(req));
    ok(res);
  });

  r.post('/players/:id/unlock', (req, res) => { admin.unlockPlayer(req.params.id, ip(req)); ok(res); });
  r.post('/players/:id/reset-pin', (req, res) => { admin.resetPlayerPin(req.params.id, ip(req)); ok(res); });
  r.post('/players/:id/logout', (req, res) => res.json({ devices: admin.logoutPlayer(req.params.id, ip(req)) }));

  r.delete('/players/:id', (req, res) => {
    const { confirm } = parse(Confirm, req.body);
    if (confirm.trim().toLowerCase() !== String(admin.player(req.params.id).pseudo).toLowerCase()) throw badRequest('Tape le pseudo exact pour confirmer.');
    admin.deletePlayer(req.params.id, ip(req));
    ok(res);
  });

  // ——— Groupes et membres

  r.get('/groups', (req, res) => res.json({ groups: admin.groupList() }));
  r.get('/groups/:id', (req, res) => res.json({ group: admin.group(req.params.id) }));

  r.post('/groups', async (req, res) => {
    res.status(201).json({ id: await admin.createGroup(parse(NewGroup, req.body), ip(req)) });
  });

  r.get('/groups/:id/settings', (req, res) => res.json(admin.groupSettings(req.params.id)));

  r.patch('/groups/:id', (req, res) => {
    const input = parse(GroupEdit, req.body);
    const removed = admin.updateGroup(req.params.id, input, ip(req));
    // Compétitions activées : leurs paris s'ouvrent tout de suite (en tâche de fond).
    if (input.settings && config.autoOpenEveryMs) deps.sources.autoOpen(req.params.id).catch((err) => logger.error({ err: err.stack }, 'Ouverture automatique : échec'));
    res.json({ ok: true, removed });
  });

  r.post('/groups/:id/address', (req, res) => res.json({ address: admin.changeAddress(req.params.id, ip(req)) }));

  r.delete('/groups/:id', (req, res) => {
    const { confirm } = parse(Confirm, req.body);
    if (confirm.trim().toLowerCase() !== admin.group(req.params.id).name.toLowerCase()) throw badRequest('Tape le nom exact du groupe pour confirmer.');
    admin.deleteGroup(req.params.id, ip(req));
    ok(res);
  });

  r.get('/groups/:id/rankings', (req, res) => res.json({ rankings: admin.groupRankings(req.params.id) }));

  r.get('/groups/:id/rankings/:ranking', (req, res) => {
    const season = req.query.season ? parse(id, req.query.season) : null;
    res.json(admin.groupRanking(req.params.id, req.params.ranking, season));
  });

  r.post('/groups/:id/members', (req, res) => {
    const { playerId, role: as } = parse(z.object({ playerId: id, role: role.default('member') }), req.body);
    res.status(201).json({ memberId: admin.addMember(req.params.id, playerId, as, ip(req)) });
  });

  r.patch('/members/:id', (req, res) => {
    admin.setRole(req.params.id, parse(z.object({ role }), req.body).role, ip(req));
    ok(res);
  });

  r.delete('/members/:id', (req, res) => {
    admin.removeMember(req.params.id, ip(req));
    ok(res);
  });

  r.post('/members/:id/reinstate', (req, res) => {
    admin.reinstateMember(req.params.id, ip(req));
    ok(res);
  });

  // ——— Sources de données, pour tout le site

  r.get('/sources', (req, res) => res.json({ sources: admin.sourceList() }));
  r.get('/places', async (req, res) => res.json({ places: await deps.sources.places(parse(PlaceQuery, req.query).q) }));

  r.patch('/sources/:id', (req, res) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const removed = admin.setSource(req.params.id, enabled, ip(req));
    // Rallumée : ses paris se rouvrent tout de suite là où elle était réglée (en tâche de fond).
    if (enabled && config.autoOpenEveryMs) deps.sources.autoOpen().catch((err) => logger.error({ err: err.stack }, 'Ouverture automatique : échec'));
    res.json({ removed });
  });

  // ——— Configuration de l'installation : nom, adresse publique, textes de l'accueil, hébergeur, icône, thème

  r.get('/configuration', (req, res) => res.json({ branding: branding.get(), icons: iconUrls(), theme: admin.theme(), themes: THEMES }));

  r.patch('/branding', (req, res) => {
    const changes = branding.update(parse(Branding, req.body));
    if (changes.length) admin.log('branding_changed', { target: 'instance', summary: changes.map((c) => c.text).join(' ; '), ip: ip(req) });
    // brand : ce que voient les pages (public/js/brand.js), que la page Configuration recopie aussitôt.
    res.json({ branding: branding.get(), brand: branding.public(), changed: changes.map((c) => c.field) });
  });

  // L'icône arrive en base64 dans du JSON (le routeur parent accepte 3 Mo sur ce seul chemin).
  r.put('/icon', (req, res) => {
    const { png } = parse(z.object({ png: z.string().min(1, 'Choisis une image.').max(3_000_000, 'L’image fait plus de 2 Mo.') }), req.body);
    branding.setIcon(Buffer.from(png, 'base64'), deps.clock.now());
    admin.log('icon_changed', { target: 'instance', summary: 'Nouvelle icône pour tout le site', ip: ip(req) });
    res.json({ icons: iconUrls(), brand: branding.public() });
  });

  r.delete('/icon', (req, res) => {
    if (branding.resetIcon()) admin.log('icon_changed', { target: 'instance', summary: 'Icône d’origine remise pour tout le site', ip: ip(req) });
    res.json({ icons: iconUrls(), brand: branding.public() });
  });

  // ——— Apparence : le thème de l'appli, pour tout le site

  r.get('/appearance', (req, res) => res.json({ theme: admin.theme(), themes: THEMES }));

  r.put('/theme', (req, res) => {
    const { theme } = parse(z.object({ theme: z.enum(THEME_IDS, { error: 'Thème inconnu.' }) }), req.body);
    admin.setTheme(theme, ip(req));
    res.json({ theme: admin.theme() });
  });

  // ——— Coupons de création de groupe

  r.get('/coupons', (req, res) => res.json({ coupons: deps.coupons.list() }));

  r.post('/coupons', (req, res) => {
    res.status(201).json(admin.createCoupon(parse(NewCoupon, req.body), ip(req)));
  });

  r.post('/coupons/:id/revoke', (req, res) => {
    admin.revokeCoupon(req.params.id, ip(req));
    ok(res);
  });

  return r;
}
