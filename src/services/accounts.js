import { tx } from '../db.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { hashPin, PIN_PARAMS, verifyPin } from '../lib/pin.js';
import { DAY, HOUR, MINUTE, newId, newToken, sha256 } from '../lib/util.js';
import { memberPseudo, RESERVED_PSEUDO } from './groups.js';

export const SESSION_TTL = 365 * DAY;
export const MAX_PIN_FAILURES = 5;
// Premier blocage après 5 PIN faux ; chacun des suivants dure deux fois plus (24 h au plus) : un PIN à 4 chiffres ne se
// devine plus en essayant tout, même sans le lien d'un groupe (la connexion se fait aussi depuis l'accueil).
export const PIN_LOCK_MS = 15 * MINUTE;
export const MAX_LOCK_MS = DAY;
// PIN oublié : les réinitialisations des admins des groupes du joueur doivent arriver dans la semaine.
export const RESET_TTL = 7 * DAY;

export const publicAccount = (p) => ({ id: p.id, pseudo: p.pseudo, avatar: p.avatar });

/**
 * Le compte d'un joueur : son pseudo (unique sur toute l'instance), son avatar, son PIN et ses connexions, les mêmes dans
 * tous ses groupes (members recopie le pseudo et l'avatar pour l'affichage). Une session par appareil (cookie pt_session).
 *
 * Comptes d'avant (v8) : un joueur à plusieurs PIN (un par groupe, members.pin_hash) se connecte avec n'importe lequel, qui
 * devient celui du compte ; une session de groupe (cookie pt_<groupe>) devient une session de compte à la première visite.
 */
export class AccountService {
  constructor(db, clock, { pinParams = PIN_PARAMS } = {}) {
    this.db = db;
    this.clock = clock;
    this.pinParams = pinParams;
  }

  find(playerId) {
    return this.db.prepare('SELECT * FROM players WHERE id = ?').get(String(playerId)) ?? null;
  }

  byPseudo(pseudo) {
    return this.db.prepare('SELECT * FROM players WHERE pseudo = ? COLLATE NOCASE').get(String(pseudo)) ?? null;
  }

  hashPin(pin) {
    return hashPin(pin, this.pinParams);
  }

  // ——— Créer un compte (en créant ou en rejoignant un groupe)

  /** Le pseudo d'un nouveau compte doit être libre partout (vérifié avant de calculer le PIN, puis dans la transaction). */
  assertPseudoFree(pseudo, playerId = null) {
    // Réservés : « Ancien membre 3 » (les anciens départs), « Max (parti) », « Max (banni) », « Max (supprimé) ».
    if (/^ancien membre \d+$/i.test(pseudo) || RESERVED_PSEUDO.test(pseudo)) throw badRequest('Ce pseudo est réservé : choisis-en un autre.');
    const other = this.byPseudo(pseudo);
    if (other && other.id !== playerId) throw conflict('Ce pseudo est déjà pris : choisis-en un autre.');
  }

  insert({ pseudo, avatar, pinHash }) {
    this.assertPseudoFree(pseudo);
    const id = newId();
    this.db.prepare('INSERT INTO players (id, pseudo, avatar, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, pseudo, avatar, pinHash, this.clock.now());
    return id;
  }

  // ——— Sessions

  createSession(playerId) {
    const token = newToken(32);
    const now = this.clock.now();
    this.db.prepare('INSERT INTO player_sessions (id_hash, player_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), playerId, now, now, now + SESSION_TTL);
    return token;
  }

  /**
   * Le compte qui détient ce jeton de session, ou null. La session glisse d'un an à chaque visite (notée au plus une fois
   * par heure : l'admin du site voit qui est passé dans les dernières 24 h).
   */
  authenticate(token) {
    if (!token) return null;
    const idHash = sha256(String(token));
    const session = this.db.prepare('SELECT * FROM player_sessions WHERE id_hash = ?').get(idHash);
    const now = this.clock.now();
    if (!session || session.expires_at <= now) return null;
    if (now - session.last_seen_at > HOUR) {
      this.db.prepare('UPDATE player_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(now, now + SESSION_TTL, idHash);
    }
    return this.find(session.player_id);
  }

  /** Session d'un groupe d'avant les comptes (cookie pt_<groupe>) : le compte de son membre, ou null. */
  legacyPlayer(token) {
    if (!token) return null;
    const row = this.db.prepare(`SELECT m.player_id FROM sessions s JOIN members m ON m.id = s.member_id
        WHERE s.id_hash = ? AND s.expires_at > ? AND m.status = 'active' AND m.player_id IS NOT NULL`).get(sha256(String(token)), this.clock.now());
    return row ? this.find(row.player_id) : null;
  }

  logout(token, legacyTokens = []) {
    if (token) this.db.prepare('DELETE FROM player_sessions WHERE id_hash = ?').run(sha256(String(token)));
    for (const t of legacyTokens) this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(String(t)));
  }

  /** Coupe toutes les connexions du compte, sur tous les appareils (PIN réinitialisé). Rend le nombre d'appareils. */
  endSessions(playerId) {
    const n = this.db.prepare('DELETE FROM player_sessions WHERE player_id = ?').run(playerId).changes;
    return n + this.db.prepare('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE player_id = ?)').run(playerId).changes;
  }

  // ——— Se connecter : pseudo + PIN

  /** PIN d'avant les comptes : ceux de ses groupes, tant que le compte n'a pas le sien. */
  #legacyPins(playerId) {
    return this.db.prepare("SELECT pin_hash FROM members WHERE player_id = ? AND status = 'active' AND pin_hash IS NOT NULL")
      .all(playerId).map((r) => r.pin_hash);
  }

  /** PIN réinitialisé : le prochain PIN tapé (depuis le lien d'un de ses groupes) devient le nouveau. */
  needsNewPin(player) {
    return !player.pin_hash && this.#legacyPins(player.id).length === 0;
  }

  #inGroup(playerId, groupId) {
    return this.db.prepare("SELECT 1 FROM members WHERE player_id = ? AND group_id = ? AND status = 'active'").get(playerId, groupId) != null;
  }

  /**
   * Connexion : rend { player, token, newPin, unified }. Pseudo + PIN, seulement depuis l'adresse d'un groupe (groupId :
   * ce groupe), jamais depuis l'accueil du site. N'importe quelle adresse valable : un joueur d'un autre groupe s'y
   * connecte, puis rejoint ce groupe. Seule l'adresse d'un de ses groupes (secrète, contrairement au pseudo) permet de
   * choisir un nouveau PIN après une réinitialisation. newPin : le joueur a confirmé son nouveau PIN.
   */
  async login({ pseudo, pin, newPin = false }, { groupId = null } = {}) {
    if (!groupId) throw new HttpError(403, 'Pour te connecter, ouvre le lien d’un de tes groupes (demande-le à un ami du groupe).', 'group_link_required');
    const player = this.byPseudo(pseudo);
    if (!player) throw notFound('Aucun compte avec ce pseudo. Vérifie l’orthographe, ou crée ton compte (« Je suis nouveau »).');
    this.#assertNotLocked(player);

    if (this.needsNewPin(player)) {
      if (!this.#inGroup(player.id, groupId)) {
        throw new HttpError(403, 'Ton PIN a été réinitialisé : ouvre le lien d’un de tes groupes pour en choisir un nouveau.', 'pin_reset');
      }
      if (!newPin) throw new HttpError(409, 'Ton PIN a été réinitialisé : choisis-en un nouveau.', 'choose_pin');
      this.#setPin(player.id, await this.hashPin(pin));
      return { player: this.find(player.id), token: this.createSession(player.id), newPin: true, unified: false };
    }

    const candidates = player.pin_hash ? [player.pin_hash] : this.#legacyPins(player.id);
    let match = null;
    for (const hash of candidates) {
      if (await verifyPin(pin, hash)) { match = hash; break; }
    }
    const fresh = this.find(player.id); // relu après l'attente : d'autres essais ont pu arriver entre-temps
    this.#assertNotLocked(fresh);
    if (!match) throw this.#failed(fresh);
    this.#setPin(player.id, match);
    return { player: this.find(player.id), token: this.createSession(player.id), newPin: false, unified: candidates.length > 1 };
  }

  /** Le PIN du compte (et plus ceux des groupes) ; les essais ratés et les réinitialisations en cours s'effacent. */
  #setPin(playerId, pinHash) {
    tx(this.db, () => {
      this.db.prepare('UPDATE players SET pin_hash = ?, failed_pins = 0, locked_until = 0, lock_level = 0 WHERE id = ?').run(pinHash, playerId);
      this.db.prepare('UPDATE members SET pin_hash = NULL WHERE player_id = ?').run(playerId);
      this.db.prepare('DELETE FROM pin_resets WHERE player_id = ?').run(playerId);
    });
  }

  #failed(player) {
    const now = this.clock.now();
    const failures = player.failed_pins + 1;
    if (failures >= MAX_PIN_FAILURES) {
      // Revenu plus d'un jour après son dernier blocage : on repart du blocage le plus court.
      const level = player.locked_until && now - player.locked_until > DAY ? 0 : player.lock_level;
      const until = now + Math.min(PIN_LOCK_MS * 2 ** level, MAX_LOCK_MS);
      this.db.prepare('UPDATE players SET failed_pins = 0, locked_until = ?, lock_level = ? WHERE id = ?').run(until, level + 1, player.id);
      return this.#lockedError(until);
    }
    this.db.prepare('UPDATE players SET failed_pins = ? WHERE id = ?').run(failures, player.id);
    const left = MAX_PIN_FAILURES - failures;
    return new HttpError(401, `PIN incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant le blocage.`, 'bad_pin', { attemptsLeft: left });
  }

  #assertNotLocked(player) {
    if (player.locked_until > this.clock.now()) throw this.#lockedError(player.locked_until);
  }

  #lockedError(until) {
    const minutes = Math.max(1, Math.ceil((until - this.clock.now()) / MINUTE));
    const wait = minutes < 60 ? `${minutes} min` : `${Math.ceil((until - this.clock.now()) / HOUR)} h`;
    return new HttpError(423, `Trop d'essais ratés : ce compte est bloqué. Réessaie dans ${wait}.`, 'locked', { lockedUntil: until });
  }

  // ——— Mon compte : pseudo, avatar, PIN

  /** Le joueur prend ce pseudo et cet avatar dans tous ses groupes ; le pseudo doit être libre partout. */
  updateIdentity(playerId, { pseudo, avatar }) {
    tx(this.db, () => {
      const player = this.find(playerId);
      pseudo ??= player.pseudo;
      avatar ??= player.avatar;
      if (pseudo.toLowerCase() !== String(player.pseudo).toLowerCase()) this.assertPseudoFree(pseudo, playerId);
      // Dans ses groupes (même ceux qu'il a quittés ou d'où il a été banni), quelqu'un d'autre peut encore porter ce pseudo.
      const taken = this.db.prepare(`SELECT g.name FROM members m JOIN members o ON o.group_id = m.group_id AND o.id != m.id
          JOIN groups g ON g.id = m.group_id WHERE m.player_id = ? AND m.status = 'active' AND o.pseudo = ? LIMIT 1`).get(playerId, pseudo);
      if (taken) throw conflict(`Ce pseudo est déjà pris dans « ${taken.name} », un de tes groupes.`);
      this.db.prepare('UPDATE players SET pseudo = ?, avatar = ? WHERE id = ?').run(pseudo, avatar, playerId);
      // Son nom suit le compte dans tous ses groupes, avec la mention là où il n'est plus (« Maxime (parti) ») : les lignes
      // d'événements le nomment à jour. OR IGNORE : une ancienne place en double (d'avant 2026-11-04) garde son nom.
      const rename = this.db.prepare('UPDATE OR IGNORE members SET pseudo = ?, avatar = ? WHERE id = ?');
      for (const m of this.db.prepare("SELECT id, status FROM members WHERE player_id = ? AND status IN ('active', 'left', 'removed')").all(playerId)) {
        rename.run(memberPseudo(pseudo, m.status), avatar, m.id);
      }
    });
  }

  /** Changer de PIN (connecté) : les essais ratés comptent comme à la connexion (sinon un appareil volé devinerait le PIN). */
  async changePin(playerId, { current, next }) {
    const player = this.find(playerId);
    this.#assertNotLocked(player);
    const candidates = player.pin_hash ? [player.pin_hash] : this.#legacyPins(playerId);
    let ok = false;
    for (const hash of candidates) if (!ok) ok = await verifyPin(current, hash);
    const fresh = this.find(playerId);
    this.#assertNotLocked(fresh);
    if (!ok) throw this.#failed(fresh);
    this.#setPin(playerId, await this.hashPin(next));
  }

  // ——— PIN oublié

  /**
   * Un admin réinitialise le PIN d'un membre. Le compte vaut dans tous ses groupes : la réinitialisation n'aboutit que
   * quand un admin de chacun de ses groupes l'a demandée (sinon l'admin d'un groupe prendrait le compte dans les autres).
   * Un admin qui l'est aussi dans d'autres groupes du joueur les couvre d'un coup.
   * Rend { done, waiting } : waiting = nombre de groupes dont un admin doit encore le faire.
   */
  requestReset(admin, target) {
    const now = this.clock.now();
    return tx(this.db, () => {
      this.db.prepare('DELETE FROM pin_resets WHERE created_at <= ?').run(now - RESET_TTL);
      const groupsOf = this.db.prepare("SELECT group_id FROM members WHERE player_id = ? AND status = 'active'").all(target.player_id).map((r) => r.group_id);
      const adminIn = new Map(this.db.prepare("SELECT group_id, id FROM members WHERE player_id = ? AND status = 'active' AND role = 'admin'")
        .all(admin.player_id).map((r) => [r.group_id, r.id]));
      adminIn.set(admin.group_id, admin.id);
      for (const groupId of groupsOf.filter((g) => adminIn.has(g))) {
        this.db.prepare('INSERT OR REPLACE INTO pin_resets (player_id, group_id, by_member, created_at) VALUES (?, ?, ?, ?)')
          .run(target.player_id, groupId, adminIn.get(groupId), now);
      }
      const asked = new Set(this.db.prepare('SELECT group_id FROM pin_resets WHERE player_id = ?').all(target.player_id).map((r) => r.group_id));
      const waiting = groupsOf.filter((g) => !asked.has(g)).length;
      if (waiting) return { done: false, waiting };
      this.forceReset(target.player_id);
      return { done: true, waiting: 0 };
    });
  }

  /**
   * PIN à choisir de nouveau, depuis le lien d'un de ses groupes ; connexions coupées. Directement pour l'admin de
   * l'instance, qui n'a pas à réunir les admins de chaque groupe.
   */
  forceReset(playerId) {
    tx(this.db, () => {
      this.db.prepare('UPDATE players SET pin_hash = NULL, failed_pins = 0, locked_until = 0, lock_level = 0 WHERE id = ?').run(playerId);
      this.db.prepare('UPDATE members SET pin_hash = NULL WHERE player_id = ?').run(playerId);
      this.db.prepare('DELETE FROM pin_resets WHERE player_id = ?').run(playerId);
      this.endSessions(playerId);
    });
  }

  /** Bloqué après trop de PIN faux : l'admin de l'instance le débloque (et efface les blocages d'affilée). */
  unlock(playerId) {
    this.db.prepare('UPDATE players SET failed_pins = 0, locked_until = 0, lock_level = 0 WHERE id = ?').run(playerId);
  }
}
