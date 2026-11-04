import { tx } from '../db.js';
import { newGroupSettings, readSettings } from '../core/settings.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { newId } from '../lib/util.js';
import { addEvent } from './events.js';

/**
 * Le nom d'un membre qui n'est plus dans le groupe suit son pseudo, avec la raison (demande du 2026-11-04) : parti de
 * lui-même (il revient quand il veut), banni par un admin (seul un admin le réintègre), compte supprimé.
 */
const GONE = { left: 'parti', removed: 'banni' };
export const memberPseudo = (pseudo, status) => (GONE[status] ? `${pseudo} (${GONE[status]})` : pseudo);

/** Ces mentions sont réservées : personne ne peut choisir « Max (parti) », « Max (banni) » ni « Max (supprimé) ». */
export const RESERVED_PSEUDO = /\((?:parti|banni|supprimé(?: \d+)?)\)$/i;

/** « Max (supprimé) » dans ce groupe, « Max (supprimé 2) » s'il y a déjà eu un Max supprimé. */
function deletedPseudo(db, groupId, pseudo) {
  const used = new Set(db.prepare('SELECT pseudo FROM members WHERE group_id = ?').all(groupId).map((m) => m.pseudo.toLowerCase()));
  let name = `${pseudo} (supprimé)`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${pseudo} (supprimé ${n})`;
  return name;
}

export const publicMember = (m) => ({
  id: m.id,
  pseudo: m.pseudo,
  avatar: m.avatar,
  role: m.role,
  status: m.status,
  createdAt: m.created_at,
});

/** Groupes, membres (le compte d'un joueur dans chacun de ses groupes), adresse du groupe et administration du groupe. */
export class GroupService {
  constructor(db, clock, accounts) {
    this.db = db;
    this.clock = clock;
    this.accounts = accounts; // AccountService : pseudo, avatar, PIN et connexions du joueur
  }

  // ——— Lecture

  find(groupId) {
    return this.db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) ?? null;
  }

  /** Le groupe d'une adresse (/<adresse>) : elle sert à entrer et à se connecter ; un admin peut la changer. */
  byAddress(address) {
    const group = this.db.prepare('SELECT * FROM groups WHERE address = ?').get(String(address));
    if (!group) throw new HttpError(404, 'Ce lien ne mène à aucun groupe : il a peut-être été changé. Demande le lien à jour à un membre du groupe.', 'group_not_found');
    return group;
  }

  settings(groupId) {
    return readSettings(this.find(groupId)?.settings);
  }

  member(memberId) {
    return this.db.prepare('SELECT * FROM members WHERE id = ?').get(String(memberId)) ?? null;
  }

  members(groupId) {
    return this.db.prepare('SELECT * FROM members WHERE group_id = ? ORDER BY created_at').all(groupId);
  }

  activeMembers(groupId) {
    return this.db.prepare("SELECT * FROM members WHERE group_id = ? AND status = 'active' ORDER BY created_at").all(groupId);
  }

  #event(groupId, type, memberId, data) {
    addEvent(this.db, this.clock.now(), { groupId, memberId, type, data });
  }

  // ——— Créer, rejoindre (account : le compte connecté sur l'appareil ; sans compte, pseudo + avatar + PIN en créent un)

  /**
   * redeem : consomme le coupon de création dans la même transaction (src/services/coupons.js) ; s'il ne sert plus, rien
   * n'est créé. L'admin de l'instance crée sans coupon (pour un compte existant).
   */
  async createGroup({ name, emoji, pseudo, avatar, pin }, account = null, { redeem = null } = {}) {
    if (!account) this.accounts.assertPseudoFree(pseudo);
    const pinHash = account ? null : await this.accounts.hashPin(pin);
    return tx(this.db, () => {
      const playerId = account?.id ?? this.accounts.insert({ pseudo, avatar, pinHash });
      const groupId = newId();
      // L'adresse du groupe est d'abord son id ; « Changer le lien » en tire une autre.
      this.db.prepare('INSERT INTO groups (id, name, emoji, address, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(groupId, name, emoji, groupId, JSON.stringify(newGroupSettings()), this.clock.now());
      const player = this.accounts.find(playerId);
      const memberId = this.#insertMember(groupId, player, 'admin');
      this.#event(groupId, 'group_created', memberId, { name });
      redeem?.({ playerId, pseudo: player.pseudo, groupId, groupName: name });
      return { groupId, address: groupId, memberId, playerId, token: account ? null : this.accounts.createSession(playerId) };
    });
  }

  /**
   * L'adresse d'un groupe ouverte sans en être membre : son nom et son emoji, jamais ses membres ; banned : le compte
   * connecté en a été banni (seul un admin peut le réintégrer).
   */
  entry(address, account = null) {
    const group = this.byAddress(address);
    const banned = !!account && this.#formerPlace(group.id, account.id)?.status === 'removed';
    return { group: { id: group.address, name: group.name, emoji: group.emoji }, signedIn: !!this.memberOf(account, group.id), banned };
  }

  /** Entrer dans un groupe par son adresse : avec le compte connecté, sinon pseudo + avatar + PIN en créent un. */
  async join(address, { pseudo, avatar, pin } = {}, account = null) {
    if (!account) {
      this.accounts.assertPseudoFree(pseudo);
      this.#assertPseudoFree(this.byAddress(address).id, pseudo);
    }
    const pinHash = account ? null : await this.accounts.hashPin(pin);
    return tx(this.db, () => {
      const group = this.byAddress(address);
      const already = this.memberOf(account, group.id);
      if (already) return { groupId: group.id, memberId: already.id, playerId: account.id, token: null, already: true };
      const playerId = account?.id ?? this.accounts.insert({ pseudo, avatar, pinHash });
      const memberId = this.#enter(group.id, this.accounts.find(playerId), 'member', {}, !!account);
      return { groupId: group.id, memberId, playerId, token: account ? null : this.accounts.createSession(playerId), already: false };
    });
  }

  /** Mon membre actif dans ce groupe, ou null. */
  memberOf(account, groupId) {
    if (!account) return null;
    return this.db.prepare("SELECT * FROM members WHERE player_id = ? AND group_id = ? AND status = 'active'").get(account.id, groupId) ?? null;
  }

  /** Mes groupes : de quoi passer de l'un à l'autre. */
  playerGroups(account) {
    if (!account) return [];
    return this.db.prepare(`SELECT g.id, g.name, g.emoji, g.address, m.id AS member_id, m.role FROM members m
        JOIN groups g ON g.id = m.group_id WHERE m.player_id = ? AND m.status = 'active' ORDER BY g.created_at`).all(account.id);
  }

  #assertPseudoFree(groupId, pseudo, exceptId = null, mine = false) {
    const taken = this.db.prepare('SELECT 1 FROM members WHERE group_id = ? AND pseudo = ? AND id != ?').get(groupId, pseudo, exceptId ?? '');
    if (!taken) return;
    throw conflict(mine ? `Le pseudo « ${pseudo} » est déjà pris dans ce groupe : change-le (page « Moi » d’un de tes groupes) pour entrer.`
      : 'Ce pseudo est déjà pris dans le groupe.');
  }

  #insertMember(groupId, player, role) {
    const id = newId();
    this.db.prepare('INSERT INTO members (id, group_id, pseudo, avatar, role, created_at, player_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, groupId, player.pseudo, player.avatar, role, this.clock.now(), player.id);
    return id;
  }

  /** Sa dernière place dans le groupe s'il n'y est plus (partie ou bannie), sinon null. */
  #formerPlace(groupId, playerId) {
    return this.db.prepare(`SELECT id, status FROM members WHERE group_id = ? AND player_id = ? AND status IN ('left', 'removed')
        ORDER BY created_at DESC LIMIT 1`).get(groupId, playerId) ?? null;
  }

  /**
   * Entre dans le groupe. Parti puis revenu, il retrouve sa place : ses points, ses pronostics, son historique. Banni par un
   * admin, il ne revient pas de lui-même : seul un admin le réintègre (reinstate), et il retrouve tout pareil.
   */
  #enter(groupId, player, role, data, mine = false, { reinstate = false } = {}) {
    const former = this.#formerPlace(groupId, player.id);
    if (former?.status === 'removed' && !reinstate) {
      throw new HttpError(403, 'Un admin t’a banni de ce groupe : seul un admin peut te réintégrer.', 'banned');
    }
    this.#assertPseudoFree(groupId, player.pseudo, former?.id, mine);
    let memberId = former?.id;
    if (memberId) {
      this.db.prepare("UPDATE members SET status = 'active', role = ?, pseudo = ?, avatar = ? WHERE id = ?").run(role, player.pseudo, player.avatar, memberId);
    } else {
      memberId = this.#insertMember(groupId, player, role);
    }
    this.#event(groupId, 'member_joined', memberId, former ? { ...data, back: true } : data);
    return memberId;
  }

  // ——— Mon groupe

  /**
   * Quitter le groupe : il y devient « Max (parti) », ses pronostics sur les paris encore ouverts sont retirés. Il peut
   * revenir quand il veut par le lien du groupe et retrouve sa place, ses points et son historique.
   */
  leave(me) {
    tx(this.db, () => {
      this.#depart(me, 'left');
      this.#event(me.group_id, 'member_left', me.id, {});
    });
  }

  /** Un membre actif qui n'est plus dans le groupe (parti, banni) : son nom le dit, il est déconnecté du groupe. */
  #depart(member, status) {
    this.db.prepare("UPDATE members SET status = ?, pseudo = ?, role = 'member' WHERE id = ?").run(status, memberPseudo(member.pseudo, status), member.id);
    this.#detach(member.id);
    if (member.role === 'admin') this.#ensureAdmin(member.group_id);
  }

  // ——— Administration

  #requireAdmin(me) {
    if (me.role !== 'admin') throw forbidden('Réservé aux admins du groupe.');
  }

  #target(me, memberId) {
    const target = this.member(memberId);
    if (!target || target.group_id !== me.group_id) throw notFound('Membre introuvable.');
    if (target.status !== 'active') throw conflict("Ce membre n'est plus dans le groupe.");
    return target;
  }

  updateGroup(me, { name, emoji }) {
    this.#requireAdmin(me);
    this.rename(me.group_id, { name, emoji });
  }

  updateSettings(me, patch) {
    this.#requireAdmin(me);
    return this.changeSettings(me.group_id, patch);
  }

  /** Réglages, champ par champ (un admin du groupe ou l'admin du site) : ceux absents de patch ne changent pas. */
  changeSettings(groupId, patch) {
    const current = this.settings(groupId);
    const next = { ...current, ...patch };
    if (patch.categories) {
      const ids = new Set();
      next.categories = patch.categories.map((c) => {
        const id = c.id || newId().slice(0, 8);
        if (ids.has(id)) throw badRequest('Deux catégories ont le même identifiant.');
        ids.add(id);
        return { id, emoji: c.emoji, label: c.label, hidden: !!c.hidden };
      });
      const missing = current.categories.filter((c) => !ids.has(c.id));
      if (missing.length) throw badRequest('Une catégorie ne se supprime pas : désactive-la plutôt.');
      // Toutes désactivées : pas de paris maison, le groupe ne vit que des compétitions activées.
    }
    if (patch.kinds) {
      // Aucun type : pas de paris maison (les compétitions ne dépendent pas des types).
      next.kinds = { ...current.kinds, ...patch.kinds };
    }
    // Les réglages des sources arrivent déjà vérifiés (SourceService.normalizeConfig) ; on garde ceux qui ne changent pas.
    if (patch.sources) next.sources = { ...current.sources, ...patch.sources };
    this.db.prepare('UPDATE groups SET settings = ? WHERE id = ?').run(JSON.stringify(next), groupId);
    return this.settings(groupId);
  }

  /**
   * Des compétitions activées (réglages des paris, ou l'admin du site : data.admin) : une ligne dans l'Activité. Chacun,
   * l'admin qui les active compris, choisit ensuite d'y participer (l'annonce en haut de la page du groupe).
   */
  competitionsAdded(groupId, memberId, feeds, data = {}) {
    if (feeds.length) this.#event(groupId, 'competitions_added', memberId, { ...data, labels: feeds.map((f) => `${f.emoji} ${f.label}`) });
  }

  /** « Changer le lien » : une nouvelle adresse ; l'ancienne ne permet plus ni d'entrer ni de se connecter. */
  changeAddress(me) {
    this.#requireAdmin(me);
    return this.#newAddress(me.group_id, me.id, {});
  }

  #newAddress(groupId, memberId, data) {
    const address = newId();
    this.db.prepare('UPDATE groups SET address = ? WHERE id = ?').run(address, groupId);
    this.#event(groupId, 'address_changed', memberId, data);
    return address;
  }

  setRole(me, memberId, role) {
    this.#requireAdmin(me);
    this.#changeRole(this.#target(me, memberId), role);
  }

  #changeRole(target, role) {
    if (target.role === role) return;
    tx(this.db, () => {
      this.db.prepare('UPDATE members SET role = ? WHERE id = ?').run(role, target.id);
      const admins = this.db.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active' AND role = 'admin'").get(target.group_id).n;
      if (admins === 0) throw conflict('Le groupe doit garder au moins un admin.');
    });
  }

  /** PIN oublié : voir AccountService.requestReset (un admin de chacun des groupes du joueur doit le demander). */
  resetPin(me, memberId) {
    this.#requireAdmin(me);
    const target = this.#target(me, memberId);
    return tx(this.db, () => {
      const result = this.accounts.requestReset(me, target);
      if (result.done) this.#event(me.group_id, 'pin_reset', target.id, { by: me.id });
      return result;
    });
  }

  removeMember(me, memberId) {
    this.#requireAdmin(me);
    if (memberId === me.id) throw badRequest('Pour partir toi-même, utilise « Quitter le groupe ».');
    this.#remove(this.#target(me, memberId), { by: me.id });
  }

  /** Bannir : « Max (banni) » ; il ne revient pas de lui-même, seul un admin le réintègre. */
  #remove(target, data) {
    tx(this.db, () => {
      this.#depart(target, 'removed');
      this.#event(target.group_id, 'member_removed', target.id, data);
    });
  }

  /** Réintégrer un membre banni (admin du groupe) : il retrouve sa place, ses points et son historique. */
  reinstate(me, memberId) {
    this.#requireAdmin(me);
    const target = this.member(memberId);
    if (!target || target.group_id !== me.group_id || target.status !== 'removed') throw notFound('Membre banni introuvable.');
    return this.#reinstate(target, { by: me.id });
  }

  #reinstate(target, data) {
    const player = target.player_id ? this.accounts.find(target.player_id) : null;
    if (!player) throw conflict('Son compte a été supprimé : il ne peut plus revenir.');
    return tx(this.db, () => this.#enter(target.group_id, player, 'member', data, false, { reinstate: true }));
  }

  /**
   * Coupe les sessions et retire les pronostics sur les paris encore ouverts. Un pari dont la clôture est passée reste
   * « open » jusqu'au prochain balayage : ses pronostics sont joués, ils restent (d'où closes_at, pas seulement status).
   */
  #detach(memberId) {
    this.db.prepare('DELETE FROM sessions WHERE member_id = ?').run(memberId);
    this.db.prepare("DELETE FROM picks WHERE member_id = ? AND bet_id IN (SELECT id FROM bets WHERE status = 'open' AND closes_at > ?)")
      .run(memberId, this.clock.now());
  }

  #ensureAdmin(groupId) {
    const admins = this.db.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active' AND role = 'admin'").get(groupId).n;
    if (admins > 0) return;
    const oldest = this.db.prepare("SELECT id FROM members WHERE group_id = ? AND status = 'active' ORDER BY created_at LIMIT 1").get(groupId);
    if (oldest) this.db.prepare("UPDATE members SET role = 'admin' WHERE id = ?").run(oldest.id);
  }

  // ——— Admin de l'instance (src/services/admin.js) : les mêmes règles, sans être admin du groupe

  #active(memberId) {
    const member = this.member(memberId);
    if (!member) throw notFound('Membre introuvable.');
    if (member.status !== 'active') throw conflict("Ce membre n'est plus dans le groupe.");
    return member;
  }

  /**
   * Ajoute un compte au groupe (rôle au choix) ; data.admin : l'historique du groupe dit « par l'admin du site ». Parti ou
   * banni, il retrouve sa place (l'admin du site peut réintégrer un banni).
   */
  addPlayer(groupId, player, role = 'member') {
    return tx(this.db, () => {
      if (!this.find(groupId)) throw notFound('Groupe introuvable.');
      if (this.memberOf(player, groupId)) throw conflict('Ce compte est déjà dans le groupe.');
      return this.#enter(groupId, player, role, { admin: true }, false, { reinstate: true });
    });
  }

  /** Réintégrer un membre banni, depuis l'admin du site. */
  adminReinstate(memberId) {
    const target = this.member(memberId);
    if (!target || target.status !== 'removed') throw notFound('Membre banni introuvable.');
    return this.#reinstate(target, { admin: true });
  }

  changeRole(memberId, role) {
    this.#changeRole(this.#active(memberId), role);
  }

  /** Retire un membre ; le dernier admin retiré, le plus ancien membre le devient. */
  expel(memberId) {
    const target = this.#active(memberId);
    this.#remove(target, { admin: true });
    return target;
  }

  rename(groupId, { name, emoji }) {
    this.db.prepare('UPDATE groups SET name = ?, emoji = ? WHERE id = ?').run(name, emoji, groupId);
  }

  newAddress(groupId) {
    return this.#newAddress(groupId, null, { admin: true });
  }

  /**
   * Compte supprimé (demande du 2026-11-04) : dans chacun de ses groupes il devient « Max (supprimé) », parti s'il y était
   * encore, toujours parti ou banni là où il l'était ; son historique reste lisible et ses membres se détachent du compte.
   * Personne ne peut plus s'y connecter, et « Max » se libère pour un autre, sans confusion.
   */
  forgetPlayer(playerId) {
    const pseudo = this.accounts.find(playerId)?.pseudo;
    tx(this.db, () => {
      for (const m of this.db.prepare('SELECT * FROM members WHERE player_id = ?').all(playerId)) {
        this.db.prepare("UPDATE members SET pseudo = ?, pin_hash = NULL, role = 'member', status = CASE status WHEN 'active' THEN 'left' ELSE status END WHERE id = ?")
          .run(deletedPseudo(this.db, m.group_id, pseudo ?? m.pseudo), m.id);
        if (m.status !== 'active') continue;
        this.#detach(m.id);
        if (m.role === 'admin') this.#ensureAdmin(m.group_id);
        this.#event(m.group_id, 'member_left', m.id, { admin: true });
      }
      this.db.prepare('UPDATE members SET player_id = NULL WHERE player_id = ?').run(playerId);
    });
  }

  /** Supprime le groupe et tout ce qu'il contient (paris, points, classements, historique). */
  deleteGroup(groupId) {
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  }

  /**
   * Un admin du groupe le supprime, en retapant son nom (sans tenir compte des majuscules ni des espaces en trop) :
   * tout disparaît pour tous ses membres ; leurs comptes et leurs autres groupes restent. Rend le groupe supprimé.
   */
  removeGroup(me, confirmName) {
    this.#requireAdmin(me);
    const group = this.find(me.group_id);
    const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
    if (norm(confirmName) !== norm(group.name)) throw badRequest('Retape exactement le nom du groupe pour confirmer.');
    this.deleteGroup(group.id);
    return group;
  }

  requireMember(groupId, account) {
    if (!account) throw unauthorized();
    const me = this.memberOf(account, groupId);
    if (!me) throw new HttpError(403, "Tu n'es pas (ou plus) dans ce groupe.", 'not_member');
    return me;
  }
}
