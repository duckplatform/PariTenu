import { DEFAULT_THEME, themeOf } from '../core/themes.js';
import { tx } from '../db.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { hashPin, PIN_PARAMS, verifyPin } from '../lib/pin.js';
import { DAY, HOUR, MINUTE, newToken, sha256 } from '../lib/util.js';
import { couponState } from './coupons.js';

export const MIN_PASSWORD = 12;
export const ADMIN_IDLE_MS = 2 * HOUR;  // sans activité, la session admin se ferme…
export const ADMIN_MAX_MS = 12 * HOUR;  // … et au plus tard 12 h après la connexion
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * MINUTE;     // puis deux fois plus à chaque nouveau blocage (24 h au plus)
const LOG_PAGE = 200;
const PICK_DAYS = 14; // tableau de bord : pronostics par jour
const COUPON_SOON = 3 * DAY; // « à traiter » : un coupon pas encore utilisé qui expire bientôt…
const IDLE_GROUP = 3 * DAY; // … un groupe toujours sans pari 3 jours après sa création

const PIN_STATE = (p, now, needsNewPin) => (p.locked_until > now ? 'locked' : needsNewPin ? 'new_pin' : 'ok');

/**
 * Admin de l'instance : la personne qui héberge Pari tenu ! (au-dessus des admins de groupe). Un mot de passe choisi sur
 * le serveur (npm run admin), jamais depuis le site ; sessions courtes ; chaque action et chaque connexion au journal.
 * Gère les comptes, les groupes et les coupons de création de groupe.
 */
export class AdminService {
  constructor(db, clock, { accounts, groups, coupons, sources = null, seasons = null, pinParams = PIN_PARAMS }) {
    this.db = db;
    this.clock = clock;
    this.accounts = accounts;
    this.groups = groups;
    this.coupons = coupons;
    this.sources = sources; // SourceService : sources coupées pour tout le site (pas dans npm run admin)
    this.seasons = seasons; // SeasonService : classements des groupes
    this.pinParams = pinParams;
  }

  log(action, { target = '', summary = '', ip = '' } = {}) {
    this.db.prepare('INSERT INTO admin_log (at, action, target, summary, ip) VALUES (?, ?, ?, ?, ?)')
      .run(this.clock.now(), action, target, summary, ip);
  }

  // ——— Mot de passe et sessions

  #auth() {
    return this.db.prepare('SELECT * FROM admin_auth WHERE id = 1').get() ?? null;
  }

  hasPassword() {
    return this.#auth() != null;
  }

  /** Depuis le serveur seulement (scripts/admin.mjs) : nouveau mot de passe, blocage levé, sessions fermées. */
  async setPassword(password) {
    if (String(password).length < MIN_PASSWORD) throw badRequest(`Le mot de passe fait au moins ${MIN_PASSWORD} caractères.`);
    if (String(password).length > 200) throw badRequest('Le mot de passe fait au plus 200 caractères.');
    const hash = await hashPin(String(password), this.pinParams);
    const first = !this.hasPassword();
    tx(this.db, () => {
      this.db.prepare(`INSERT INTO admin_auth (id, password_hash, updated_at) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, failed = 0, locked_until = 0, lock_level = 0, updated_at = excluded.updated_at`)
        .run(hash, this.clock.now());
      this.db.exec('DELETE FROM admin_sessions');
      this.log(first ? 'password_set' : 'password_changed', { summary: first ? 'Mot de passe admin choisi (serveur)' : 'Mot de passe admin changé (serveur)', ip: 'serveur' });
    });
  }

  /** Rend le jeton de la session ; 5 essais ratés bloquent la connexion 15 min, puis deux fois plus à chaque fois. */
  async login(password, { ip = '', userAgent = '' } = {}) {
    const auth = this.#auth();
    if (!auth) throw new HttpError(409, 'Pas encore de mot de passe admin : lance « npm run admin » sur le serveur.', 'no_password');
    this.#assertNotLocked(auth);
    const ok = await verifyPin(String(password), auth.password_hash);
    const fresh = this.#auth(); // relu après l'attente : d'autres essais ont pu arriver entre-temps
    this.#assertNotLocked(fresh);
    if (!ok) {
      this.log('login_failed', { summary: 'Mot de passe admin incorrect', ip });
      throw this.#failed(fresh);
    }
    const token = newToken(32);
    const now = this.clock.now();
    tx(this.db, () => {
      this.db.prepare('UPDATE admin_auth SET failed = 0, lock_level = 0 WHERE id = 1').run();
      this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - ADMIN_IDLE_MS);
      this.db.prepare('INSERT INTO admin_sessions (id_hash, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sha256(token), now, now, now + ADMIN_MAX_MS, ip, String(userAgent).slice(0, 200));
      this.log('login', { summary: 'Connexion à l’admin', ip });
    });
    return token;
  }

  #failed(auth) {
    const now = this.clock.now();
    const failures = auth.failed + 1;
    if (failures >= MAX_FAILURES) {
      const level = auth.locked_until && now - auth.locked_until > DAY ? 0 : auth.lock_level;
      const until = now + Math.min(LOCK_MS * 2 ** level, DAY);
      this.db.prepare('UPDATE admin_auth SET failed = 0, locked_until = ?, lock_level = ? WHERE id = 1').run(until, level + 1);
      return this.#lockedError(until);
    }
    this.db.prepare('UPDATE admin_auth SET failed = ? WHERE id = 1').run(failures);
    const left = MAX_FAILURES - failures;
    return new HttpError(401, `Mot de passe incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant le blocage.`, 'bad_password', { attemptsLeft: left });
  }

  #assertNotLocked(auth) {
    if (auth.locked_until > this.clock.now()) throw this.#lockedError(auth.locked_until);
  }

  #lockedError(until) {
    const minutes = Math.max(1, Math.ceil((until - this.clock.now()) / MINUTE));
    return new HttpError(423, `Trop d'essais ratés : l’admin est bloqué ${minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`}. `
      + 'Sur le serveur, « npm run admin » le débloque en changeant le mot de passe.', 'locked', { lockedUntil: until });
  }

  /** La session de ce jeton, ou null (fermée après 2 h sans activité, ou 12 h après la connexion). */
  authenticate(token) {
    if (!token) return null;
    const idHash = sha256(String(token));
    const session = this.db.prepare('SELECT * FROM admin_sessions WHERE id_hash = ?').get(idHash);
    const now = this.clock.now();
    if (!session) return null;
    if (session.expires_at <= now || now - session.last_seen_at > ADMIN_IDLE_MS) {
      this.db.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').run(idHash);
      return null;
    }
    if (now - session.last_seen_at > MINUTE) this.db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, idHash);
    return session;
  }

  logout(token, ip) {
    if (!token) return;
    if (this.db.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').run(sha256(String(token))).changes) this.log('logout', { summary: 'Déconnexion de l’admin', ip });
  }

  // ——— Lecture

  overview() {
    const now = this.clock.now();
    const count = (sql, ...args) => this.db.prepare(sql).get(...args).n;
    const coupons = this.db.prepare('SELECT used_at, revoked_at, expires_at FROM coupons').all().map((c) => couponState(c, now));
    // Pronostics des 14 derniers jours, du plus ancien à aujourd'hui (jours glissants de 24 h : pas de fuseau à choisir).
    const picksByDay = Array(PICK_DAYS).fill(0);
    for (const { d, n } of this.db.prepare('SELECT CAST((? - created_at) / ? AS INTEGER) AS d, COUNT(*) AS n FROM picks WHERE created_at > ? GROUP BY d').all(now, DAY, now - PICK_DAYS * DAY)) {
      if (d >= 0 && d < PICK_DAYS) picksByDay[PICK_DAYS - 1 - d] = n;
    }
    const groups = this.groupList();
    return {
      players: count('SELECT COUNT(*) AS n FROM players'),
      newPlayers: count('SELECT COUNT(*) AS n FROM players WHERE created_at > ?', now - 7 * DAY),
      groups: count('SELECT COUNT(*) AS n FROM groups'),
      groupsWithoutBets: groups.filter((g) => g.bets === 0).length,
      openBets: count("SELECT COUNT(*) AS n FROM bets WHERE status = 'open'"),
      closingSoon: count("SELECT COUNT(*) AS n FROM bets WHERE status = 'open' AND closes_at <= ?", now + DAY),
      activeToday: count('SELECT COUNT(DISTINCT player_id) AS n FROM player_sessions WHERE last_seen_at > ?', now - DAY),
      picksByDay,
      coupons: { available: coupons.filter((s) => s === 'available').length, used: coupons.filter((s) => s === 'used').length },
      attention: this.attention(),
      recentGroups: groups.slice(0, 5),
      activeGroups: [...groups].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, 6),
      sessions: this.adminSessions(),
      log: this.logEntries().slice(0, 8),
    };
  }

  adminSessions() {
    return this.db.prepare('SELECT created_at, last_seen_at, ip, user_agent FROM admin_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC').all(this.clock.now())
      .map((s) => ({ createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent }));
  }

  /**
   * Ce qui attend l'admin du site, le plus urgent d'abord ; chaque point dit de quoi il s'agit et mène à ce qui le règle.
   * Liste vide : tout va bien. Calculé à chaque demande (rien n'est enregistré, rien à « marquer comme lu »).
   */
  attention() {
    const now = this.clock.now();
    const items = [];
    for (const p of this.db.prepare('SELECT id, pseudo, avatar, locked_until FROM players WHERE locked_until > ? ORDER BY locked_until').all(now)) {
      items.push({ type: 'locked', player: { id: p.id, pseudo: p.pseudo, avatar: p.avatar }, until: p.locked_until });
    }
    // Sans PIN (compte créé par l'admin, ou PIN réinitialisé) : depuis la création ou la dernière réinitialisation.
    const waiting = this.db.prepare(`SELECT p.*, (SELECT MAX(created_at) FROM pin_resets r WHERE r.player_id = p.id) AS reset_at
        FROM players p WHERE p.pin_hash IS NULL ORDER BY p.created_at`).all()
      .filter((p) => this.accounts.needsNewPin(p) && !(p.locked_until > now))
      .map((p) => ({ id: p.id, pseudo: p.pseudo, avatar: p.avatar, since: Math.max(p.created_at, p.reset_at ?? 0) }));
    if (waiting.length) items.push({ type: 'new_pin', players: waiting });
    // Sources allumées : une clé manque (coupée, elle ne compte plus), ou elle ne répond plus depuis une heure.
    for (const s of this.sources?.overview() ?? []) {
      if (!s.enabled) continue;
      const source = { id: s.id, name: s.name, emoji: s.emoji };
      if (s.key === 'missing') items.push({ type: 'source_key', source, keyName: s.keyName });
      else if (s.failingSince && now - s.failingSince >= HOUR) items.push({ type: 'source_down', source, since: s.failingSince, readAt: s.readAt, error: s.error });
    }
    for (const c of this.db.prepare(`SELECT id, hint, note, expires_at FROM coupons WHERE used_at IS NULL AND revoked_at IS NULL
        AND expires_at > ? AND expires_at <= ? ORDER BY expires_at`).all(now, now + COUPON_SOON)) {
      items.push({ type: 'coupon_expiring', coupon: { id: c.id, hint: c.hint, note: c.note }, expiresAt: c.expires_at });
    }
    for (const g of this.groupList()) {
      const group = { id: g.id, name: g.name, emoji: g.emoji };
      if (g.members === 0) items.push({ type: 'empty_group', group, createdAt: g.createdAt });
      else if (g.bets === 0 && now - g.createdAt >= IDLE_GROUP) items.push({ type: 'idle_group', group, createdAt: g.createdAt });
    }
    return items;
  }

  /** Les compteurs du menu de l'admin : à chaque page, sans le reste du tableau de bord. */
  nav() {
    const now = this.clock.now();
    const count = (sql, ...args) => this.db.prepare(sql).get(...args).n;
    const attention = this.attention();
    return {
      players: count('SELECT COUNT(*) AS n FROM players'),
      groups: count('SELECT COUNT(*) AS n FROM groups'),
      coupons: count('SELECT COUNT(*) AS n FROM coupons WHERE used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)', now),
      attention: attention.length,
      sources: attention.filter((a) => a.type.startsWith('source_')).length,
      sessions: count('SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at > ?', now),
    };
  }

  playerList() {
    const now = this.clock.now();
    return this.db.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM members m WHERE m.player_id = p.id AND m.status = 'active') AS group_count,
        (SELECT MAX(last_seen_at) FROM player_sessions s WHERE s.player_id = p.id) AS last_seen
        FROM players p ORDER BY p.created_at DESC`).all()
      .map((p) => ({
        id: p.id, pseudo: p.pseudo, avatar: p.avatar, createdAt: p.created_at, groups: p.group_count, lastSeenAt: p.last_seen,
        state: PIN_STATE(p, now, this.accounts.needsNewPin(p)),
      }));
  }

  player(id) {
    const p = this.accounts.find(id);
    if (!p) throw notFound('Compte introuvable.');
    const now = this.clock.now();
    const groups = this.db.prepare(`SELECT m.id AS member_id, m.role, m.status, m.created_at, g.id, g.name, g.emoji,
        (SELECT COUNT(*) FROM picks k WHERE k.member_id = m.id) AS picks
        FROM members m JOIN groups g ON g.id = m.group_id WHERE m.player_id = ? ORDER BY m.status = 'active' DESC, m.created_at`).all(p.id);
    const sessions = this.db.prepare('SELECT COUNT(*) AS n, MAX(last_seen_at) AS last FROM player_sessions WHERE player_id = ? AND expires_at > ?').get(p.id, now);
    return {
      id: p.id, pseudo: p.pseudo, avatar: p.avatar, createdAt: p.created_at,
      state: PIN_STATE(p, now, this.accounts.needsNewPin(p)), lockedUntil: p.locked_until > now ? p.locked_until : null, failedPins: p.failed_pins,
      devices: sessions.n, lastSeenAt: sessions.last,
      groups: groups.map((g) => ({ memberId: g.member_id, id: g.id, name: g.name, emoji: g.emoji, role: g.role, status: g.status, joinedAt: g.created_at, picks: g.picks })),
      coupons: this.db.prepare('SELECT * FROM coupons WHERE used_by = ? ORDER BY used_at DESC').all(p.id).map((c) => ({ id: c.id, hint: c.hint, usedAt: c.used_at, groupName: c.group_name })),
    };
  }

  groupList() {
    return this.db.prepare(`SELECT g.id, g.name, g.emoji, g.created_at,
        (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id AND m.status = 'active') AS members,
        (SELECT COUNT(*) FROM bets b WHERE b.group_id = g.id) AS bets,
        (SELECT COUNT(*) FROM bets b WHERE b.group_id = g.id AND b.status = 'open') AS open_bets,
        (SELECT MAX(created_at) FROM events e WHERE e.group_id = g.id) AS last_activity
        FROM groups g ORDER BY g.created_at DESC`).all()
      .map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, createdAt: g.created_at, members: g.members, bets: g.bets, openBets: g.open_bets, lastActivityAt: g.last_activity }));
  }

  group(id) {
    const g = this.groups.find(id);
    if (!g) throw notFound('Groupe introuvable.');
    const count = (sql) => this.db.prepare(sql).get(g.id).n;
    const coupon = this.db.prepare('SELECT id, hint, note, used_at FROM coupons WHERE group_id = ?').get(g.id);
    return {
      id: g.id, name: g.name, emoji: g.emoji, createdAt: g.created_at, address: g.address,
      bets: count('SELECT COUNT(*) AS n FROM bets WHERE group_id = ?'),
      openBets: count("SELECT COUNT(*) AS n FROM bets WHERE group_id = ? AND status = 'open'"),
      lastActivityAt: this.db.prepare('SELECT MAX(created_at) AS t FROM events WHERE group_id = ?').get(g.id).t,
      coupon: coupon ? { id: coupon.id, hint: coupon.hint, note: coupon.note, usedAt: coupon.used_at } : null,
      settings: this.groups.settings(g.id),
      competitions: this.sources?.offered(g.id) ?? [],
      members: this.db.prepare(`SELECT m.id, m.pseudo, m.avatar, m.role, m.status, m.created_at, m.player_id,
          (SELECT COUNT(*) FROM picks k WHERE k.member_id = m.id) AS picks
          FROM members m WHERE m.group_id = ? ORDER BY m.status = 'active' DESC, m.role = 'admin' DESC, m.created_at`).all(g.id)
        .map((m) => ({ id: m.id, pseudo: m.pseudo, avatar: m.avatar, role: m.role, status: m.status, joinedAt: m.created_at, playerId: m.player_id, picks: m.picks })),
    };
  }

  /** Les classements du groupe (un par compétition ou catégorie), avec le meneur de la saison en cours. */
  groupRankings(id) {
    return this.seasons.rankings(this.#group(id).id, null);
  }

  /** Un classement du groupe : une saison (celle en cours par défaut) et la liste de ses saisons. */
  groupRanking(id, ranking, seasonId = null) {
    return this.seasons.ranking(this.#group(id).id, ranking, seasonId);
  }

  logEntries() {
    return this.db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?').all(LOG_PAGE)
      .map((e) => ({ id: e.id, at: e.at, action: e.action, target: e.target, summary: e.summary, ip: e.ip }));
  }

  // ——— Comptes

  #player(id) {
    const p = this.accounts.find(id);
    if (!p) throw notFound('Compte introuvable.');
    return p;
  }

  #group(id) {
    const g = this.groups.find(id);
    if (!g) throw notFound('Groupe introuvable.');
    return g;
  }

  /** Un compte sans PIN, dans un groupe : il le choisit en ouvrant le lien du groupe et en tapant son pseudo. */
  createPlayer({ pseudo, avatar, groupId, role }, ip) {
    this.accounts.assertPseudoFree(pseudo);
    const group = this.#group(groupId);
    return tx(this.db, () => {
      const id = this.accounts.insert({ pseudo, avatar, pinHash: null });
      this.groups.addPlayer(group.id, this.accounts.find(id), role);
      this.log('player_created', { target: `player:${id}`, summary: `Compte « ${pseudo} » créé dans « ${group.name} »${role === 'admin' ? ' (admin)' : ''}`, ip });
      return id;
    });
  }

  updatePlayer(id, { pseudo, avatar }, ip) {
    const before = this.#player(id);
    this.accounts.updateIdentity(before.id, { pseudo, avatar });
    const renamed = pseudo && pseudo !== before.pseudo ? `« ${before.pseudo} » devient « ${pseudo} »` : `« ${before.pseudo} » modifié`;
    this.log('player_updated', { target: `player:${id}`, summary: `Compte ${renamed}`, ip });
  }

  unlockPlayer(id, ip) {
    const p = this.#player(id);
    this.accounts.unlock(p.id);
    this.log('player_unlocked', { target: `player:${id}`, summary: `Compte « ${p.pseudo} » débloqué`, ip });
  }

  resetPlayerPin(id, ip) {
    const p = this.#player(id);
    this.accounts.forceReset(p.id);
    this.log('player_pin_reset', { target: `player:${id}`, summary: `PIN de « ${p.pseudo} » réinitialisé (à choisir depuis le lien d’un groupe)`, ip });
  }

  logoutPlayer(id, ip) {
    const p = this.#player(id);
    const devices = this.accounts.endSessions(p.id);
    this.log('player_logged_out', { target: `player:${id}`, summary: `« ${p.pseudo} » déconnecté de ${devices} appareil${devices > 1 ? 's' : ''}`, ip });
    return devices;
  }

  /** Il quitte ses groupes (pseudo anonymisé, historique et points gardés), puis le compte disparaît. */
  deletePlayer(id, ip) {
    const p = this.#player(id);
    tx(this.db, () => {
      this.groups.forgetPlayer(p.id);
      this.db.prepare('DELETE FROM players WHERE id = ?').run(p.id);
      this.log('player_deleted', { target: `player:${id}`, summary: `Compte « ${p.pseudo} » supprimé`, ip });
    });
  }

  // ——— Groupes

  /** Sans coupon : le groupe est créé pour un compte existant, qui en devient l'admin. */
  async createGroup({ name, emoji, playerId }, ip) {
    const owner = this.#player(playerId);
    const { groupId } = await this.groups.createGroup({ name, emoji }, owner);
    this.log('group_created', { target: `group:${groupId}`, summary: `Groupe « ${name} » créé pour « ${owner.pseudo} »`, ip });
    return groupId;
  }

  /** Réglages du groupe (page « Modifier ») : points et délais, types, catégories, et ses sources telles qu'il les a réglées. */
  groupSettings(id) {
    const g = this.#group(id);
    const off = this.sources.available.filter((s) => this.sources.disabled.has(s.id)).map(({ id: sourceId, emoji, name }) => ({ id: sourceId, emoji, name }));
    return { settings: this.groups.settings(g.id), sources: this.sources.forGroup(g.id), off };
  }

  /**
   * Nom, emoji et, s'ils sont envoyés, réglages (comme le ferait un admin du groupe). Rend le nombre de paris sans
   * pronostic retirés (compétitions coupées). Les membres choisissent eux-mêmes de suivre une compétition activée.
   */
  updateGroup(id, { name, emoji, settings = null }, ip) {
    const g = this.#group(id);
    const patch = settings?.sources ? { ...settings, sources: this.sources.normalizeConfig(settings.sources) } : settings;
    const snapshot = () => ({ settings: this.groups.settings(g.id), sources: this.#sourceChoices(g.id), offered: this.sources.offered(g.id) });
    const before = patch ? snapshot() : null;
    return tx(this.db, () => {
      this.groups.rename(g.id, { name, emoji });
      if (patch) this.groups.changeSettings(g.id, patch);
      const removed = patch ? this.sources.prune(g.id) : 0;
      const changes = [
        name !== g.name && `renommé « ${name} »`,
        emoji !== g.emoji && 'emoji',
        ...(patch ? this.#settingsChanges(before, snapshot()) : []),
      ].filter(Boolean);
      this.log('group_updated', { target: `group:${id}`, ip, summary: `Groupe « ${g.name} » ${changes.length ? `modifié : ${changes.join(', ')}` : 'enregistré sans changement'}` });
      return removed;
    });
  }

  /** Ce qui a changé dans les réglages, pour le journal : « points et délais », « compétitions (+ ⚽ Ligue 1) »… */
  #settingsChanges(before, after) {
    const same = (keys) => keys.every((k) => JSON.stringify(before.settings[k]) === JSON.stringify(after.settings[k]));
    const keys = (list) => new Set(list.map((f) => f.key));
    const [was, now] = [keys(before.offered), keys(after.offered)];
    const moves = [
      ...after.offered.filter((f) => !was.has(f.key)).map((f) => `+ ${f.emoji} ${f.label}`),
      ...before.offered.filter((f) => !now.has(f.key)).map((f) => `− ${f.emoji} ${f.label}`),
    ];
    return [
      !same(['basePoints', 'oddsCap', 'arbiterBonus', 'validationHours', 'voteHours']) && 'points et délais',
      !same(['kinds']) && 'types de paris',
      !same(['categories']) && 'catégories',
      moves.length ? `compétitions (${moves.join(', ')})` : before.sources !== after.sources && 'réglages des sources',
    ];
  }

  /** Compétitions choisies et paramètres (ville de la météo…) de chaque source, tels que le groupe les voit. */
  #sourceChoices(groupId) {
    return JSON.stringify(this.sources.forGroup(groupId).map((v) => [v.id, v.selected, v.values]));
  }

  /** « Changer le lien » d'un groupe : une nouvelle adresse ; l'ancienne ne permet plus ni d'entrer ni de se connecter. */
  changeAddress(id, ip) {
    const g = this.#group(id);
    const address = this.groups.newAddress(g.id);
    this.log('group_address', { target: `group:${id}`, summary: `Nouveau lien pour « ${g.name} » (l’ancien ne marche plus)`, ip });
    return address;
  }

  deleteGroup(id, ip) {
    const g = this.#group(id);
    tx(this.db, () => {
      this.groups.deleteGroup(g.id);
      this.log('group_deleted', { target: `group:${id}`, summary: `Groupe « ${g.name} » supprimé`, ip });
    });
  }

  addMember(groupId, playerId, role, ip) {
    const g = this.#group(groupId);
    const p = this.#player(playerId);
    const memberId = this.groups.addPlayer(g.id, p, role);
    this.log('member_added', { target: `group:${g.id}`, summary: `« ${p.pseudo} » ajouté à « ${g.name} »${role === 'admin' ? ' (admin)' : ''}`, ip });
    return memberId;
  }

  setRole(memberId, role, ip) {
    const m = this.groups.member(memberId);
    if (!m) throw notFound('Membre introuvable.');
    this.groups.changeRole(m.id, role);
    const g = this.groups.find(m.group_id);
    this.log('member_role', { target: `group:${g.id}`, summary: `« ${m.pseudo} » ${role === 'admin' ? 'devient admin' : 'n’est plus admin'} de « ${g.name} »`, ip });
  }

  removeMember(memberId, ip) {
    const m = this.groups.expel(memberId);
    const g = this.groups.find(m.group_id);
    this.log('member_removed', { target: `group:${g.id}`, summary: `« ${m.pseudo} » retiré de « ${g.name} »`, ip });
  }

  // ——— Sources de données, pour tout le site

  sourceList() {
    return this.sources.overview();
  }

  /** Coupe ou rallume une source dans tous les groupes ; rend le nombre de paris sans pronostic retirés. */
  setSource(id, enabled, ip) {
    const source = this.sources.overview().find((s) => s.id === id);
    if (!source) throw notFound('Source de données inconnue.');
    if (source.enabled === enabled) return 0;
    const removed = this.sources.setEnabled(id, enabled);
    this.log(enabled ? 'source_enabled' : 'source_disabled', {
      target: `source:${id}`, ip,
      summary: enabled ? `Source « ${source.emoji} ${source.name} » rallumée pour tous les groupes`
        : `Source « ${source.emoji} ${source.name} » coupée pour tous les groupes${removed ? ` (${removed} pari${removed > 1 ? 's' : ''} sans pronostic retiré${removed > 1 ? 's' : ''})` : ''}`,
    });
    return removed;
  }

  // ——— Apparence : l'habillage de l'appli, le même pour tout le site

  /** L'id du thème choisi (gardé en mémoire : /theme.css le demande à chaque page). */
  theme() {
    if (this.currentTheme === undefined) {
      const row = this.db.prepare("SELECT value FROM instance_settings WHERE key = 'theme'").get();
      this.currentTheme = themeOf(row?.value ?? DEFAULT_THEME).id;
    }
    return this.currentTheme;
  }

  setTheme(id, ip) {
    const before = themeOf(this.theme());
    const after = themeOf(id);
    if (after.id !== id) throw notFound('Thème inconnu.');
    if (after.id === before.id) return;
    this.db.prepare(`INSERT INTO instance_settings (key, value) VALUES ('theme', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(after.id);
    this.currentTheme = after.id;
    this.log('theme_changed', { target: `theme:${after.id}`, summary: `Thème « ${before.name} » remplacé par « ${after.name} » pour tout le site`, ip });
  }

  // ——— Coupons

  createCoupon({ note, days }, ip) {
    const coupon = this.coupons.create({ note, days });
    this.log('coupon_created', { target: `coupon:${coupon.id}`, summary: `Coupon …${coupon.code.slice(-4)} créé${note ? ` (${note})` : ''}`, ip });
    return coupon;
  }

  revokeCoupon(id, ip) {
    const c = this.coupons.revoke(id);
    this.log('coupon_revoked', { target: `coupon:${id}`, summary: `Coupon …${c.hint} annulé${c.note ? ` (${c.note})` : ''}`, ip });
  }
}
