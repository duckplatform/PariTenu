import { tx } from '../db.js';
import { newGroupSettings, readSettings } from '../core/settings.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { newId } from '../lib/util.js';
import { addEvent } from './events.js';

const pseudosIn = (db, groupId) => new Set(db.prepare('SELECT pseudo FROM members WHERE group_id = ?').all(groupId).map((m) => m.pseudo.toLowerCase()));

/** « Ancien membre 3 » : le premier numéro libre dans le groupe, pour un membre qui quitte le groupe. */
function anonymousPseudo(db, groupId) {
  const used = pseudosIn(db, groupId);
  let n = 1;
  while (used.has(`ancien membre ${n}`)) n++;
  return `Ancien membre ${n}`;
}

/** Le pseudo d'un compte supprimé : « Max (supprimé) », réservé (personne ne peut le choisir ni s'y connecter). */
export const DELETED_PSEUDO = /\(supprimé(?: \d+)?\)$/i;

/** « Max (supprimé) » dans ce groupe, « Max (supprimé 2) » s'il y a déjà eu un Max supprimé. */
function deletedPseudo(db, groupId, pseudo) {
  const used = pseudosIn(db, groupId);
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

  /** L'adresse d'un groupe ouverte sans en être membre : son nom et son emoji, jamais ses membres. */
  entry(address, account = null) {
    const group = this.byAddress(address);
    return { group: { id: group.address, name: group.name, emoji: group.emoji }, signedIn: !!this.memberOf(account, group.id) };
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

  /** Entre dans le groupe : retiré puis revenu, il retrouve sa place et son historique. */
  #enter(groupId, player, role, data, mine = false) {
    const removed = this.db.prepare("SELECT id FROM members WHERE group_id = ? AND player_id = ? AND status = 'removed' ORDER BY created_at DESC LIMIT 1")
      .get(groupId, player.id);
    this.#assertPseudoFree(groupId, player.pseudo, removed?.id, mine);
    let memberId = removed?.id;
    if (memberId) {
      this.db.prepare("UPDATE members SET status = 'active', role = ?, pseudo = ?, avatar = ? WHERE id = ?").run(role, player.pseudo, player.avatar, memberId);
    } else {
      memberId = this.#insertMember(groupId, player, role);
    }
    this.#event(groupId, 'member_joined', memberId, data);
    return memberId;
  }

  // ——— Mon groupe

  /** Quitter le groupe : le pseudo est anonymisé, les pronostics sur les paris encore ouverts sont retirés. */
  leave(me) {
    tx(this.db, () => this.#anonymize(me, {}));
  }

  #anonymize(member, data) {
    this.db.prepare("UPDATE members SET status = 'left', pseudo = ?, avatar = '👤', pin_hash = NULL, role = 'member' WHERE id = ?")
      .run(anonymousPseudo(this.db, member.group_id), member.id);
    this.#detach(member.id);
    if (member.role === 'admin') this.#ensureAdmin(member.group_id);
    this.#event(member.group_id, 'member_left', member.id, data);
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

  #remove(target, data) {
    tx(this.db, () => {
      this.db.prepare("UPDATE members SET status = 'removed', role = 'member' WHERE id = ?").run(target.id);
      this.#detach(target.id);
      if (target.role === 'admin') this.#ensureAdmin(target.group_id);
      this.#event(target.group_id, 'member_removed', target.id, data);
    });
  }

  /** Coupe les sessions et retire les pronostics sur les paris encore ouverts. */
  #detach(memberId) {
    this.db.prepare('DELETE FROM sessions WHERE member_id = ?').run(memberId);
    this.db.prepare("DELETE FROM picks WHERE member_id = ? AND bet_id IN (SELECT id FROM bets WHERE status = 'open')").run(memberId);
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

  /** Ajoute un compte au groupe (rôle au choix) ; data.admin : l'historique du groupe dit « par l'admin du site ». */
  addPlayer(groupId, player, role = 'member') {
    return tx(this.db, () => {
      if (!this.find(groupId)) throw notFound('Groupe introuvable.');
      if (this.memberOf(player, groupId)) throw conflict('Ce compte est déjà dans le groupe.');
      return this.#enter(groupId, player, role, { admin: true });
    });
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
   * encore, toujours « retiré » là où il l'avait été ; son historique reste lisible et ses membres se détachent du compte.
   * Personne ne peut plus s'y connecter, et « Max » se libère pour un autre, sans confusion. Là où il avait quitté le
   * groupe de lui-même, il est déjà « Ancien membre N ».
   */
  forgetPlayer(playerId) {
    tx(this.db, () => {
      for (const m of this.db.prepare("SELECT * FROM members WHERE player_id = ? AND status IN ('active', 'removed')").all(playerId)) {
        this.db.prepare("UPDATE members SET pseudo = ?, pin_hash = NULL, role = 'member', status = CASE status WHEN 'active' THEN 'left' ELSE status END WHERE id = ?")
          .run(deletedPseudo(this.db, m.group_id, m.pseudo), m.id);
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
