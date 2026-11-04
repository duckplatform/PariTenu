import express from 'express';
import { z } from 'zod';
import { forbidden, HttpError, notFound } from '../lib/errors.js';
import { RateLimiter } from '../lib/rateLimit.js';
import { DAY } from '../lib/util.js';
import { publicAccount } from '../services/accounts.js';
import { PLAYER } from '../services/admin.js';
import { normalizeCoupon } from '../services/coupons.js';
import { feedOf } from '../services/follows.js';
import { publicMember } from '../services/groups.js';
import { adminRouter } from './admin.js';
import { avatar, emoji, groupName, id, parse, pin, PlaceQuery, pseudo, readCookies, Settings } from './inputs.js';

// ——— Schémas des entrées (messages affichés tels quels dans l'interface)

const timestamp = z.number({ error: 'Choisis une date.' }).int().positive();

// Sans compte sur l'appareil, créer ou rejoindre un groupe crée le compte : pseudo, avatar et PIN.
const NewAccount = z.object({ pseudo, avatar, pin });
// Créer un groupe demande un coupon, généré par l'admin de l'instance (à usage unique).
const CreateGroup = z.object({ name: groupName, emoji, coupon: z.string().max(40).optional() });
const Login = z.object({
  pseudo: z.string().trim().min(1, 'Tape ton pseudo.').max(20, 'Ton pseudo fait au plus 20 caractères.'),
  pin,
  newPin: z.boolean().optional(),             // PIN réinitialisé : le joueur a confirmé son nouveau PIN
  group: z.string().max(60).optional(),       // l'adresse du groupe ouverte pour se connecter
});
const Identity = z.object({ pseudo: pseudo.optional(), avatar: avatar.optional() });
const question = z.string().trim().min(5, 'La question fait au moins 5 caractères.').max(140, 'La question fait au plus 140 caractères.');
const details = z.string().trim().max(500, 'Les précisions font au plus 500 caractères.');
const BetInput = z.object({
  question,
  details: details.default(''),
  category: id,
  kind: z.enum(['yesno', 'multi']),
  options: z.array(z.string().max(60, 'Une option fait au plus 60 caractères.')).max(8, 'Il faut entre 2 et 8 options.').optional(),
  closesAt: timestamp,
  expectedAt: timestamp.nullable().optional(),
  arbiterId: id.optional(),
});
const text = (max, empty) => z.string().trim().min(1, empty).max(max, `${max} caractères maximum.`);

// ——— Cookies : une session de compte par appareil, valable dans tous les groupes du joueur

export const SESSION_COOKIE = 'pt_session';
// D'avant les comptes : une session par groupe (pt_<groupe>) et le joueur de l'appareil (pt_player).
export const cookieName = (groupId) => `pt_${groupId}`;
export const PLAYER_COOKIE = 'pt_player';
const legacyCookies = (cookies) => Object.entries(cookies).filter(([name]) => /^pt_[0-9a-f]{16}$/.test(name));

export function apiRouter(deps) {
  const { config, clock, accounts, groups, coupons, admin, branding, bets, seasons, follows, stats, activity, sources, logger } = deps;
  const router = express.Router();
  const authLimiter = new RateLimiter({ limit: config.authRateLimit, windowMs: 5 * 60_000 });
  const apiLimiter = new RateLimiter({ limit: 1200, windowMs: 5 * 60_000 });

  // L'adresse publique réglée par l'admin du site (toujours en https), ou null.
  const publicUrl = () => (branding.get().publicUrl ? new URL(branding.get().publicUrl) : null);
  const publicHost = () => publicUrl()?.host ?? null;
  const isSecure = (req) => config.cookieSecure === 'always'
    || (config.cookieSecure === 'auto' && (req.secure || req.hostname.endsWith('.ts.net') || req.hostname === publicUrl()?.hostname));

  const setSession = (req, res, token) => {
    if (token) res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: 365 * DAY, path: '/' });
  };

  /**
   * Le compte connecté sur cet appareil, ou null. Un appareil d'avant les comptes (session d'un groupe) devient connecté
   * au compte de ce membre : le joueur ne retape rien.
   */
  const account = (req, res) => {
    if (req.account !== undefined) return req.account;
    const cookies = readCookies(req);
    let player = accounts.authenticate(cookies[SESSION_COOKIE]);
    if (!player) {
      for (const [, token] of legacyCookies(cookies)) {
        player = accounts.legacyPlayer(token);
        if (player) { setSession(req, res, accounts.createSession(player.id)); break; }
      }
    }
    req.account = player ?? null;
    return req.account;
  };
  const requireAccount = (req, res) => {
    const player = account(req, res);
    if (!player) throw new HttpError(401, 'Connecte-toi pour continuer.', 'unauthorized');
    return player;
  };

  const authLimit = (req, res, next) => {
    if (!authLimiter.take(req.ip)) throw new HttpError(429, 'Trop de tentatives depuis cet appareil. Patiente quelques minutes.', 'rate_limited');
    next();
  };

  // En-têtes communs, garde-fous CSRF : JSON obligatoire pour écrire, et pas de requête venue d'un autre site.
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!apiLimiter.take(req.ip)) throw new HttpError(429, 'Trop de requêtes. Patiente un peu.', 'rate_limited');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!req.is('application/json')) throw new HttpError(415, 'Requête JSON attendue.', 'unsupported_media_type');
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        let host = null;
        try { host = new URL(origin).host; } catch { /* origine illisible : refusée ci-dessous */ }
        // req.host suit X-Forwarded-Host quand le relais est de confiance (Tailscale Funnel, Caddy).
        // L'adresse publique de l'installation (derrière un relais qui ne transmet pas l'hôte) est la sienne aussi.
        if (host !== req.headers.host && host !== req.host && host !== publicHost()) throw forbidden('Requête refusée (origine inconnue).');
      }
    }
    next();
  });
  // 32 ko suffisent partout, sauf pour l'icône de l'installation (une image en base64) envoyée par l'admin du site.
  const smallJson = express.json({ limit: '32kb' });
  const iconJson = express.json({ limit: '3mb' });
  router.use((req, res, next) => (req.path === '/admin/icon' ? iconJson : smallJson)(req, res, next));

  const ok = (res) => res.json({ ok: true });

  // ——— Public

  // catalog : les sports et autres sources que l'instance sait proposer (page d'accueil).
  router.get('/instance', (req, res) => {
    const me = account(req, res);
    res.json({ account: me && publicAccount(me), catalog: sources.catalog(), theme: admin.theme(), brand: branding.public(), now: clock.now() });
  });

  // ——— Mon compte : le même dans tous mes groupes

  router.get('/account', (req, res) => {
    const me = account(req, res);
    res.json({
      account: me && publicAccount(me),
      // id : l'adresse du groupe (/<adresse>), la seule que l'app connaisse ; l'id interne ne sort pas du serveur.
      groups: groups.playerGroups(me).map((g) => ({ id: g.address, name: g.name, emoji: g.emoji, role: g.role })),
    });
  });

  // Se connecter (pseudo + PIN) : seulement depuis l'adresse d'un groupe. Un PIN de 4 chiffres se devine vite : sans
  // elle (secrète, partagée entre amis), personne ne peut essayer des pseudos depuis l'accueil du site.
  router.post('/account/login', authLimit, async (req, res) => {
    const input = parse(Login, req.body);
    if (!input.group) throw new HttpError(403, 'Pour te connecter, ouvre le lien d’un de tes groupes (demande-le à un ami du groupe).', 'group_link_required');
    const group = groups.byAddress(input.group); // adresse inconnue ou changée : 404
    const { player, token, newPin, unified } = await accounts.login(input, { groupId: group.id });
    setSession(req, res, token);
    res.json({ account: publicAccount(player), newPin, unified });
  });

  /** Se déconnecter de cet appareil : de tous ses groupes d'un coup. */
  router.post('/account/logout', (req, res) => {
    const cookies = readCookies(req);
    const legacy = legacyCookies(cookies);
    accounts.logout(cookies[SESSION_COOKIE], legacy.map(([, token]) => token));
    for (const name of [SESSION_COOKIE, PLAYER_COOKIE, ...legacy.map(([n]) => n)]) res.clearCookie(name, { path: '/' });
    ok(res);
  });

  router.patch('/account', (req, res) => {
    accounts.updateIdentity(requireAccount(req, res).id, parse(Identity, req.body));
    ok(res);
  });

  router.post('/account/pin', async (req, res) => {
    await accounts.changePin(requireAccount(req, res).id, parse(z.object({ current: pin, next: pin }), req.body));
    ok(res);
  });

  // Un groupe (et le compte qui va avec, sans compte sur l'appareil) : il faut un coupon, qui sert une seule fois.
  router.post('/groups', authLimit, async (req, res) => {
    const input = parse(CreateGroup, req.body);
    const me = account(req, res);
    const newAccount = me ? {} : parse(NewAccount, req.body);
    coupons.check(input.coupon); // avant de calculer le PIN
    let used = null;
    const { groupId, address, token } = await groups.createGroup({ name: input.name, emoji: input.emoji, ...newAccount }, me, {
      redeem: (created) => { coupons.redeem(input.coupon, created); used = created; },
    });
    admin.log('coupon_used', { target: `group:${groupId}`, player: { id: used.playerId, pseudo: used.pseudo }, summary: `Coupon …${normalizeCoupon(input.coupon).slice(-4)} utilisé par « ${PLAYER} » : groupe « ${used.groupName} » créé`, ip: req.ip });
    setSession(req, res, token);
    res.status(201).json({ groupId: address });
  });

  // L'adresse d'un groupe ouverte sans en être membre : de quoi y entrer ou s'y connecter (son nom, jamais ses membres).
  router.get('/groups/:gid/entry', (req, res) => {
    const me = account(req, res);
    res.json({ ...groups.entry(req.params.gid, me), account: me && publicAccount(me) });
  });

  // Connecté : on entre d'un geste, avec son pseudo et son avatar. Sinon pseudo + avatar + PIN créent le compte.
  router.post('/groups/:gid/join', authLimit, async (req, res) => {
    const me = account(req, res);
    const { token, already } = await groups.join(req.params.gid, me ? {} : parse(NewAccount, req.body), me);
    setSession(req, res, token);
    res.status(already ? 200 : 201).json({ already });
  });

  router.use('/admin', adminRouter(deps, { isSecure, authLimit }));

  if (config.testHooks) {
    // Déplacer l'horloge du serveur : uniquement pour les tests de bout en bout et la démo.
    router.post('/_test/clock', (req, res) => {
      const { advanceMs } = parse(z.object({ advanceMs: z.number().int() }), req.body);
      clock.advance(advanceMs);
      bets.sweepAll();
      seasons.closeDue();
      res.json({ now: clock.now() });
    });
  }

  // ——— Groupe (session obligatoire) : :gid est l'adresse du groupe (adresse inconnue ou changée : 404 group_not_found)

  const g = express.Router({ mergeParams: true });
  router.use('/groups/:gid', (req, res, next) => {
    const group = groups.byAddress(req.params.gid);
    req.me = groups.requireMember(group.id, account(req, res));
    req.group = group;
    bets.sweep(group.id);
    seasons.closeDue();
    next();
  }, g);

  g.get('/', (req, res) => {
    res.json({
      now: clock.now(),
      group: { id: req.group.address, name: req.group.name, emoji: req.group.emoji, createdAt: req.group.created_at },
      settings: groups.settings(req.group.id),
      me: publicMember(req.me),
      members: groups.members(req.group.id).map(publicMember),
    });
  });

  g.patch('/', (req, res) => {
    groups.updateGroup(req.me, parse(z.object({ name: groupName, emoji }), req.body));
    ok(res);
  });

  g.patch('/settings', (req, res) => {
    const input = parse(Settings, req.body);
    if (input.sources) input.sources = sources.normalizeConfig(input.sources);
    const before = new Set(sources.offered(req.group.id).map((f) => f.key));
    const settings = groups.updateSettings(req.me, input);
    // Compétitions activées : une ligne dans l'Activité ; chacun, l'admin compris, choisit d'y participer (l'annonce en
    // haut de la page du groupe). Personne n'y est inscrit d'office (demande du 2026-11-04).
    groups.competitionsAdded(req.group.id, req.me.id, sources.offered(req.group.id).filter((f) => !before.has(f.key)));
    // Compétitions coupées : leurs paris pas encore joués disparaissent ; activées : leurs paris s'ouvrent (en tâche de fond).
    const removed = sources.prune(req.group.id);
    if (config.autoOpenEveryMs) {
      sources.autoOpen(req.group.id).catch((err) => logger.error({ err: err.stack }, 'Ouverture automatique : échec'));
    }
    res.json({ settings, removed });
  });

  // ——— Sources de données : paris ouverts tout seuls et résultats automatiques

  g.get('/sources', (req, res) => {
    res.json({ sources: sources.forGroup(req.group.id) });
  });

  // ——— Compétitions proposées par le groupe : chacun choisit d'y participer (sinon leurs paris ne s'affichent pas)

  g.get('/feeds', (req, res) => {
    const choices = follows.choices(req.me.id);
    const open = new Map();
    for (const b of deps.db.prepare("SELECT source, ranking FROM bets WHERE group_id = ? AND status = 'open' AND source IS NOT NULL").all(req.group.id)) {
      const feed = feedOf(b);
      open.set(feed, (open.get(feed) ?? 0) + 1);
    }
    res.json({ feeds: sources.offered(req.group.id).map((f) => ({ ...f, choice: choices.get(f.key) ?? null, open: open.get(f.key) ?? 0 })) });
  });

  g.post('/feeds', (req, res) => {
    const { key, choice } = parse(z.object({ key: z.string().max(80), choice: z.enum(['in', 'out']) }), req.body);
    if (!sources.offered(req.group.id).some((f) => f.key === key)) throw notFound('Cette compétition n’est pas proposée dans le groupe.');
    follows.set(req.me.id, key, choice);
    // « Je participe » : ses pronostics des mêmes matchs, dans ses autres groupes, sont repris dans ce groupe.
    if (choice === 'in') bets.adoptPicks(req.me, key);
    ok(res);
  });

  g.post('/bets/:id/check', async (req, res) => {
    res.json(await sources.checkNow(req.me, req.params.id));
  });

  g.get('/places', async (req, res) => {
    if (req.me.role !== 'admin') throw forbidden('Réservé aux admins du groupe.');
    res.json({ places: await sources.places(parse(PlaceQuery, req.query).q) });
  });

  // « Changer le lien » (admin du groupe) : la nouvelle adresse ; l'ancienne ne mène plus à rien.
  g.post('/address', (req, res) => {
    res.json({ id: groups.changeAddress(req.me) });
  });

  g.get('/bets', (req, res) => {
    res.json({ now: clock.now(), bets: bets.list(req.me, { all: req.query.all === '1' }) });
  });

  g.post('/bets', (req, res) => {
    res.status(201).json({ id: bets.create(req.me, parse(BetInput, req.body)) });
  });

  g.get('/bets/:id', (req, res) => {
    res.json({ now: clock.now(), bet: bets.detail(req.me, req.params.id) });
  });

  g.patch('/bets/:id', (req, res) => {
    bets.update(req.me, req.params.id, parse(BetInput, req.body));
    ok(res);
  });

  g.delete('/bets/:id', (req, res) => {
    bets.remove(req.me, req.params.id);
    ok(res);
  });

  const betAction = (path, schema, fn) => g.post(`/bets/:id/${path}`, (req, res) => {
    fn(req.me, req.params.id, schema ? parse(schema, req.body) : {});
    ok(res);
  });

  betAction('pick', z.object({ optionId: id }), (me, betId, b) => bets.pick(me, betId, b.optionId));
  betAction('details', z.object({ text: text(500, 'Écris ta précision.') }), (me, betId, b) => bets.addDetail(me, betId, b.text));
  betAction('postpone', z.object({ closesAt: timestamp }), (me, betId, b) => bets.postpone(me, betId, b.closesAt));
  betAction('arbiter', z.object({ arbiterId: id }), (me, betId, b) => bets.setArbiter(me, betId, b.arbiterId));
  betAction('withdraw', null, (me, betId) => bets.withdrawArbiter(me, betId));
  betAction('close', null, (me, betId) => bets.close(me, betId));
  betAction('cancel', z.object({ note: z.string().trim().max(280).default('') }), (me, betId, b) => bets.cancel(me, betId, b.note));
  betAction('resolve', z.object({ optionId: id, note: z.string().trim().max(280, '280 caractères maximum.').default('') }),
    (me, betId, b) => bets.resolve(me, betId, b));
  betAction('contest', z.object({ reason: text(280, 'Explique pourquoi tu contestes.') }), (me, betId, b) => bets.contest(me, betId, b.reason));
  betAction('vote', z.object({ choice: id }), (me, betId, b) => bets.vote(me, betId, b.choice));
  betAction('correct', z.object({ optionId: id, reason: text(280, 'Explique la correction.') }), (me, betId, b) => bets.correct(me, betId, b));

  g.post('/bets/:id/comments', (req, res) => {
    const { body } = parse(z.object({ body: text(280, 'Écris un message.') }), req.body);
    res.status(201).json({ id: bets.comment(req.me, req.params.id, body) });
  });

  g.delete('/bets/:id/comments/:cid', (req, res) => {
    bets.deleteComment(req.me, req.params.id, req.params.cid);
    ok(res);
  });

  // ——— Classements : un par compétition (ou catégorie), saison par saison

  g.get('/rankings', (req, res) => {
    res.json({ now: clock.now(), rankings: seasons.rankings(req.group.id, req.me.id) });
  });

  g.get('/rankings/:ranking', (req, res) => {
    const season = req.query.season ? parse(id, req.query.season) : null;
    res.json({ now: clock.now(), ...seasons.ranking(req.group.id, req.params.ranking, season) });
  });

  g.get('/seasons/:sid/bets', (req, res) => {
    res.json({ now: clock.now(), bets: bets.listSeason(req.me, req.params.sid) });
  });

  g.get('/feed', (req, res) => res.json({ now: clock.now(), events: stats.feed(req.group.id) }));
  // La page Activité : le fil regroupé et « À la une » (src/services/activity.js).
  g.get('/activity', (req, res) => res.json({ now: clock.now(), ...activity.activity(req.group.id) }));

  g.get('/members/:mid', (req, res) => {
    const profile = stats.profile(req.group.id, req.params.mid);
    if (!profile) throw notFound('Membre introuvable.');
    res.json({ now: clock.now(), profile });
  });

  g.post('/members/:mid/role', (req, res) => {
    groups.setRole(req.me, req.params.mid, parse(z.object({ role: z.enum(['admin', 'member']) }), req.body).role);
    ok(res);
  });

  g.post('/members/:mid/reset-pin', (req, res) => {
    res.json(groups.resetPin(req.me, req.params.mid));
  });

  // Réintégrer un membre banni : il retrouve sa place (admin du groupe).
  g.post('/members/:mid/reinstate', (req, res) => {
    groups.reinstate(req.me, req.params.mid);
    ok(res);
  });

  g.post('/members/:mid/remove', (req, res) => {
    groups.removeMember(req.me, req.params.mid);
    ok(res);
  });

  // Quitter : le seul admin nomme d'abord un successeur ({ successor }) ; le dernier membre emporte le groupe.
  g.post('/me/leave', (req, res) => {
    const { successor } = parse(z.object({ successor: id.optional() }), req.body ?? {});
    const { deleted } = groups.leave(req.me, { successor });
    if (deleted) {
      admin.log('group_deleted', { target: `group:${deleted.id}`, player: { id: req.me.player_id, pseudo: req.me.pseudo }, summary: `Groupe « ${deleted.name} » supprimé : son dernier membre « ${PLAYER} » l’a quitté`, ip: req.ip ?? '' });
    }
    res.json({ deleted: !!deleted });
  });

  // Un admin du groupe le supprime (en retapant son nom) ; l'admin du site le voit dans son journal.
  g.delete('/', (req, res) => {
    const group = groups.removeGroup(req.me, parse(z.object({ confirm: z.string().max(80).default('') }), req.body).confirm);
    admin.log('group_deleted', { target: `group:${group.id}`, player: { id: req.me.player_id, pseudo: req.me.pseudo }, summary: `Groupe « ${group.name} » supprimé par son admin « ${PLAYER} »`, ip: req.ip ?? '' });
    ok(res);
  });

  g.get('/export', (req, res) => {
    if (req.me.role !== 'admin') throw forbidden('Réservé aux admins du groupe.');
    res.setHeader('Content-Disposition', `attachment; filename="pari-tenu-${req.group.id}.json"`);
    res.json(stats.export(req.group.id));
  });

  router.use((req, res) => {
    throw notFound('Adresse inconnue.');
  });

  return router;
}
