import { tx } from '../db.js';
import { isUnanimous, MIN_PARTICIPANTS, oddsByOption, pointsFor, settle, tallyVotes } from '../core/scoring.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { DAY, HOUR, MINUTE, newId } from '../lib/util.js';
import { siteName } from '../sources/http.js';
import { sourceById } from '../sources/index.js';
import { mediaUrl } from './media.js';
import { addEvent, parseEvent } from './events.js';
import { feedOf } from './follows.js';

export const MIN_CLOSE_DELAY = 5 * MINUTE;
export const MAX_CLOSE_DELAY = 366 * DAY;
export const REMIND_AFTER = DAY; // l'arbitre est relancé 24 h après la date du résultat attendu
export const ARBITER_GRACE = 7 * DAY; // ensuite un admin peut trancher à sa place
export const ABANDON_AFTER = 30 * DAY; // ensuite le pari est annulé
export const SOURCE_GRACE = DAY; // pari relié à une source muette : un admin sans pronostic peut trancher à la main
const FINISHED_KEPT = 30 * DAY; // « Terminés récemment »

/**
 * Cycle de vie d'un pari (cahier des charges § 7.5) :
 *   open → closed → validating (24 h) → settled
 *                        └→ voting (48 h) → settled | cancelled
 *   open | closed → cancelled
 * Les échéances sont appliquées par sweep(), appelé avant chaque requête du groupe et toutes les minutes.
 * Un pari relié à une source de données (bets.source) n'a pas d'arbitre : le résultat arrive par applySourceResult().
 * Ces paris s'ouvrent tout seuls (createAuto, sans créateur) ; ceux que personne n'a joués disparaissent à la clôture.
 * Chaque pari compte dans un classement et une saison (bets.ranking, bets.season_id : voir SeasonService).
 * Points : cote du groupe pour un pari entre amis ; cote fixe pour un pari sportif (bets.scoring, bet_options.odds).
 * Un joueur présent dans plusieurs groupes (members.player_id) parie une fois : son pronostic sur un pari de source
 * vaut dans tous ses groupes où ce même pari est ouvert et dont il suit la compétition.
 */
export class BetService {
  // Pendant sweep(), l'échéance appliquée : clôtures et points sont datés de l'échéance, pas du passage du balayage.
  #at = null;

  constructor(db, clock, groups, seasons, follows, live = null) {
    this.db = db;
    this.clock = clock;
    this.groups = groups;
    this.seasons = seasons;
    this.follows = follows;
    this.live = live; // LiveStore : équipes, pilotes et score des rencontres (paris de source)
  }

  #now() {
    return this.#at ?? this.clock.now();
  }

  // ——— Lecture brute

  get(betId) {
    const bet = this.db.prepare('SELECT * FROM bets WHERE id = ?').get(String(betId));
    if (!bet) throw notFound("Ce pari n'existe pas (ou plus).");
    return bet;
  }

  #inGroup(me, betId) {
    const bet = this.get(betId);
    if (bet.group_id !== me.group_id) throw notFound("Ce pari n'existe pas (ou plus).");
    return bet;
  }

  options(betId) {
    return this.db.prepare('SELECT * FROM bet_options WHERE bet_id = ? ORDER BY position').all(betId);
  }

  picks(betId) {
    return this.db.prepare('SELECT member_id, option_id, created_at FROM picks WHERE bet_id = ? ORDER BY created_at').all(betId)
      .map((p) => ({ memberId: p.member_id, optionId: p.option_id, createdAt: p.created_at }));
  }

  #pickOf(betId, memberId) {
    return this.db.prepare('SELECT option_id FROM picks WHERE bet_id = ? AND member_id = ?').get(betId, memberId) ?? null;
  }

  #option(bet, optionId) {
    const option = this.db.prepare('SELECT * FROM bet_options WHERE id = ? AND bet_id = ?').get(String(optionId), bet.id);
    if (!option) throw badRequest('Option inconnue pour ce pari.');
    return option;
  }

  #event(bet, type, memberId = null, data = {}) {
    addEvent(this.db, this.#now(), { groupId: bet.group_id, betId: bet.id, memberId, type, data });
  }

  #touch(betId, fields) {
    const all = { ...fields, updated_at: this.#now() };
    const keys = Object.keys(all);
    this.db.prepare(`UPDATE bets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => all[k]), betId);
  }

  /** L'heure à partir de laquelle on attend le verdict : la clôture, ou la date du résultat attendu si elle est plus tard. */
  referenceTime(bet) {
    return Math.max(bet.closes_at, bet.expected_at ?? 0);
  }

  // ——— Création et modification (créateur)

  // current : la valeur actuelle d'un pari modifié, acceptée même si elle a été désactivée entre-temps.
  #checkCategory(groupId, category, current = null) {
    const { categories } = this.groups.settings(groupId);
    const cat = categories.find((c) => c.id === category);
    if (cat && (!cat.hidden || category === current)) return;
    throw badRequest(categories.some((c) => !c.hidden) ? 'Choisis une catégorie de la liste.' : 'Les paris maison sont désactivés dans ce groupe.');
  }

  #checkKind(groupId, kind, current = null) {
    const { kinds } = this.groups.settings(groupId);
    if (kinds[kind] || kind === current) return;
    if (!Object.values(kinds).some(Boolean)) throw badRequest('Les paris maison sont désactivés dans ce groupe.');
    throw badRequest(kind === 'multi' ? 'Les paris à choix multiples sont désactivés dans ce groupe.' : 'Les paris Oui / Non sont désactivés dans ce groupe.');
  }

  #checkDates(closesAt, expectedAt) {
    const now = this.clock.now();
    if (closesAt < now + MIN_CLOSE_DELAY - 1000) throw badRequest('La clôture doit être au moins 5 minutes plus tard.');
    if (closesAt > now + MAX_CLOSE_DELAY) throw badRequest('La clôture ne peut pas être dans plus d’un an.');
    if (expectedAt != null && expectedAt < closesAt) throw badRequest('Le résultat est attendu après la clôture des pronostics.');
  }

  #labels(kind, options) {
    if (kind === 'yesno') return ['Oui', 'Non'];
    const labels = (options ?? []).map((s) => s.trim()).filter(Boolean);
    if (labels.length < 2 || labels.length > 8) throw badRequest('Il faut entre 2 et 8 options.');
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw badRequest('Deux options ont le même nom.');
    return labels;
  }

  #checkArbiter(groupId, arbiterId, betId = null) {
    const m = this.groups.member(arbiterId);
    if (!m || m.group_id !== groupId || m.status !== 'active') throw badRequest("L'arbitre doit être un membre du groupe.");
    if (betId && this.#pickOf(betId, arbiterId)) throw badRequest('Ce membre a déjà parié : il ne peut pas arbitrer ce pari.');
  }

  /**
   * options : [{ label, key, odds }] ; key = réponse de la source qui fait gagner l'option (null pour un pari libre) ;
   * odds = cote fixe de l'option (paris sportifs).
   */
  #insertOptions(betId, options) {
    const insert = this.db.prepare('INSERT INTO bet_options (id, bet_id, label, position, source_key, odds) VALUES (?, ?, ?, ?, ?, ?)');
    options.forEach((o, i) => insert.run(newId(), betId, o.label, i, o.key ?? null, o.odds ?? null));
  }

  /** Classement et saison d'un pari libre : sa catégorie, la saison de l'année où le résultat est attendu. */
  #placeOf(groupId, category, closesAt, expectedAt) {
    return this.seasons.forCategory(groupId, category, Math.max(closesAt, expectedAt ?? 0));
  }

  #insert(groupId, creatorId, arbiterId, input, { ranking, seasonId }, link = null) {
    const id = newId();
    const now = this.clock.now();
    this.db.prepare(`INSERT INTO bets (id, group_id, creator_id, arbiter_id, category, question, details, kind, status, closes_at, expected_at,
        created_at, updated_at, source, source_ref, ranking, season_id, scoring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, groupId, creatorId, arbiterId, input.category, input.question, input.details ?? '', input.kind, input.closesAt, input.expectedAt ?? null,
        now, now, link?.source ?? null, link ? JSON.stringify(link.ref) : null, ranking, seasonId, link?.scoring ?? 'group');
    return id;
  }

  /** Pari libre lancé par un membre : il choisit l'arbitre (lui-même par défaut). */
  create(me, input) {
    this.#checkCategory(me.group_id, input.category);
    this.#checkKind(me.group_id, input.kind);
    this.#checkDates(input.closesAt, input.expectedAt);
    const options = this.#labels(input.kind, input.options).map((label) => ({ label, key: null }));
    const arbiterId = input.arbiterId || me.id;
    this.#checkArbiter(me.group_id, arbiterId);
    return tx(this.db, () => {
      const id = this.#insert(me.group_id, me.id, arbiterId, input, this.#placeOf(me.group_id, input.category, input.closesAt, input.expectedAt));
      this.#insertOptions(id, options);
      this.#event({ id, group_id: me.group_id }, 'created', me.id, { arbiterId });
      return id;
    });
  }

  /**
   * Pari ouvert automatiquement par une source de données : pas de créateur ni d'arbitre, tout le monde peut parier.
   * link : { source, ref, options: [{ label, key, odds }], ranking, season, scoring } ; season (sources sportives) :
   * saison officielle, sinon la saison de l'année dans le classement de la catégorie ; scoring : 'bookmaker' | 'fixed'
   * (paris sportifs, cote fixe de chaque option) ou 'group'. Les pronostics déjà faits sur ce même pari dans un autre
   * groupe par les joueurs de celui-ci y sont repris.
   */
  createAuto(groupId, input, link) {
    this.#checkDates(input.closesAt, input.expectedAt);
    return tx(this.db, () => {
      const place = link.season
        ? { ranking: link.ranking, seasonId: this.seasons.ensure(groupId, link.ranking, link.season) }
        : this.#placeOf(groupId, input.category, input.closesAt, input.expectedAt);
      const id = this.#insert(groupId, null, null, input, place, link);
      this.#insertOptions(id, link.options);
      this.#event({ id, group_id: groupId }, 'created', null, { source: link.source, auto: true });
      this.#inheritPicks(this.get(id));
      return id;
    });
  }

  /** Une cote de bookmaker est arrivée pour un pari sportif encore sans pronostic : elle remplace le barème fixe. */
  setBookmakerOdds(betId, oddsByKey) {
    tx(this.db, () => {
      const bet = this.get(betId);
      if (bet.status !== 'open' || bet.scoring !== 'fixed' || this.picks(bet.id).length) return;
      const update = this.db.prepare('UPDATE bet_options SET odds = ? WHERE id = ?');
      for (const o of this.options(bet.id)) update.run(oddsByKey[o.source_key] ?? o.odds, o.id);
      this.#touch(bet.id, { scoring: 'bookmaker' });
    });
  }

  // ——— Un joueur, plusieurs groupes : un pronostic vaut partout où le même pari est ouvert

  #refKey(bet) {
    return bet.source_ref ? JSON.parse(bet.source_ref).key : null;
  }

  /** Enregistre un pronostic (et la compétition comme suivie). shared : repris d'un autre groupe du même joueur. */
  #insertPick(bet, memberId, option, shared = null) {
    this.db.prepare('INSERT INTO picks (bet_id, member_id, option_id, created_at) VALUES (?, ?, ?, ?)').run(bet.id, memberId, option.id, this.clock.now());
    this.#event(bet, 'picked', memberId, { optionId: option.id, label: option.label, ...(shared ? { shared } : {}) });
    const feed = feedOf(bet);
    if (feed) this.follows.setIfUnset(memberId, feed, 'in');
  }

  /** Changement d'avis (pronostics ouverts) : la nouvelle option remplace l'ancienne, à sa place dans l'ordre des paris. */
  #changePick(bet, memberId, fromOptionId, option, shared = null) {
    const from = this.db.prepare('SELECT label FROM bet_options WHERE id = ?').get(fromOptionId)?.label ?? '';
    this.db.prepare('UPDATE picks SET option_id = ? WHERE bet_id = ? AND member_id = ?').run(option.id, bet.id, memberId);
    this.#event(bet, 'pick_changed', memberId, { optionId: option.id, label: option.label, from, ...(shared ? { shared } : {}) });
  }

  /**
   * Reprend un pronostic dans les autres groupes du joueur : même pari (même clé de source), ouvert, compétition suivie.
   * Un changement d'avis y suit aussi (le joueur n'a qu'un pronostic par match).
   */
  #sharePick(bet, member, option) {
    const key = this.#refKey(bet);
    if (!key || !member.player_id || option.source_key == null) return;
    const from = this.groups.find(bet.group_id)?.name ?? '';
    const others = this.db.prepare("SELECT * FROM members WHERE player_id = ? AND id != ? AND status = 'active'").all(member.player_id, member.id);
    for (const other of others) {
      const twin = this.db.prepare(`SELECT * FROM bets WHERE group_id = ? AND source = ? AND json_extract(source_ref, '$.key') = ?
          AND status = 'open' AND closes_at > ?`).get(other.group_id, bet.source, key, this.clock.now());
      if (!twin || !this.follows.follows(other.id, feedOf(twin))) continue;
      const twinOption = this.db.prepare('SELECT * FROM bet_options WHERE bet_id = ? AND source_key = ?').get(twin.id, option.source_key);
      const already = this.#pickOf(twin.id, other.id);
      if (!twinOption || already?.option_id === twinOption.id) continue;
      if (already) this.#changePick(twin, other.id, already.option_id, twinOption, from);
      else this.#insertPick(twin, other.id, twinOption, from);
    }
  }

  /** Nouveau pari de source : les membres du groupe qui ont déjà parié dessus ailleurs (même joueur) y retrouvent leur pronostic. */
  #inheritPicks(bet) {
    const key = this.#refKey(bet);
    if (!key) return;
    const feed = feedOf(bet);
    const earlier = this.db.prepare(`SELECT m.id AS member_id, o.source_key, g.name AS group_name FROM members m
        JOIN members mo ON mo.player_id = m.player_id AND mo.id != m.id
        JOIN picks p ON p.member_id = mo.id
        JOIN bets b ON b.id = p.bet_id AND b.source = ? AND json_extract(b.source_ref, '$.key') = ?
        JOIN bet_options o ON o.id = p.option_id
        JOIN groups g ON g.id = b.group_id
        WHERE m.group_id = ? AND m.status = 'active' AND m.player_id IS NOT NULL`).all(bet.source, key, bet.group_id);
    for (const e of earlier) {
      if (this.#pickOf(bet.id, e.member_id) || !this.follows.follows(e.member_id, feed)) continue;
      const option = this.db.prepare('SELECT * FROM bet_options WHERE bet_id = ? AND source_key = ?').get(bet.id, e.source_key);
      if (option) this.#insertPick(bet, e.member_id, option, e.group_name);
    }
  }

  #requireCreator(bet, me) {
    if (bet.creator_id !== me.id) throw forbidden('Seul le créateur du pari peut faire ça.');
  }

  update(me, betId, input) {
    const bet = this.#inGroup(me, betId);
    this.#requireCreator(bet, me);
    if (bet.source) throw conflict('Ce pari vient d’une source de données : il ne se modifie pas.');
    if (bet.status !== 'open' || this.picks(bet.id).length) throw conflict("Quelqu'un a déjà parié : la question et les options ne changent plus.");
    this.#checkCategory(me.group_id, input.category, bet.category);
    this.#checkKind(me.group_id, input.kind, bet.kind);
    this.#checkDates(input.closesAt, input.expectedAt);
    const labels = this.#labels(input.kind, input.options).map((label) => ({ label, key: null }));
    const arbiterId = input.arbiterId || me.id;
    this.#checkArbiter(me.group_id, arbiterId);
    tx(this.db, () => {
      const place = this.#placeOf(bet.group_id, input.category, input.closesAt, input.expectedAt);
      this.#touch(bet.id, {
        question: input.question, details: input.details ?? '', category: input.category, kind: input.kind,
        closes_at: input.closesAt, expected_at: input.expectedAt ?? null, arbiter_id: arbiterId, ranking: place.ranking, season_id: place.seasonId,
      });
      this.db.prepare('DELETE FROM bet_options WHERE bet_id = ?').run(bet.id);
      this.#insertOptions(bet.id, labels);
      this.#event(bet, 'edited', me.id);
    });
  }

  remove(me, betId) {
    const bet = this.#inGroup(me, betId);
    this.#requireCreator(bet, me);
    if (bet.status !== 'open' || this.picks(bet.id).length) throw conflict("Quelqu'un a déjà parié : annule le pari plutôt que de le supprimer.");
    this.db.prepare('DELETE FROM bets WHERE id = ?').run(bet.id);
  }

  addDetail(me, betId, text) {
    const bet = this.#inGroup(me, betId);
    this.#requireCreator(bet, me);
    if (!['open', 'closed'].includes(bet.status)) throw conflict('Ce pari est déjà tranché.');
    tx(this.db, () => {
      this.#touch(bet.id, {});
      this.#event(bet, 'detail_added', me.id, { text });
    });
  }

  postpone(me, betId, closesAt) {
    const bet = this.#inGroup(me, betId);
    this.#requireCreator(bet, me);
    if (bet.source) throw conflict('Ce pari ferme au début de l’événement : sa clôture ne se repousse pas.');
    if (bet.status !== 'open' || this.clock.now() >= bet.closes_at) throw conflict('Les pronostics sont déjà clos.');
    if (closesAt <= bet.closes_at) throw badRequest('La nouvelle clôture doit être plus tard que l’actuelle.');
    if (closesAt > this.clock.now() + MAX_CLOSE_DELAY) throw badRequest('La clôture ne peut pas être dans plus d’un an.');
    if (bet.expected_at != null && bet.expected_at < closesAt) throw badRequest('La clôture ne peut pas dépasser la date du résultat attendu.');
    tx(this.db, () => {
      const place = bet.source ? { seasonId: bet.season_id } : this.#placeOf(bet.group_id, bet.category, closesAt, bet.expected_at);
      this.#touch(bet.id, { closes_at: closesAt, season_id: place.seasonId });
      this.#event(bet, 'postponed', me.id, { from: bet.closes_at, to: closesAt });
    });
  }

  setArbiter(me, betId, arbiterId) {
    const bet = this.#inGroup(me, betId);
    this.#requireCreator(bet, me);
    if (bet.source) throw conflict('Le résultat de ce pari arrive tout seul : il n’a pas d’arbitre.');
    if (!['open', 'closed'].includes(bet.status)) throw conflict('Ce pari est déjà tranché.');
    this.#checkArbiter(me.group_id, arbiterId, bet.id);
    tx(this.db, () => {
      this.#touch(bet.id, { arbiter_id: arbiterId });
      this.#event(bet, 'arbiter_changed', me.id, { arbiterId });
    });
  }

  withdrawArbiter(me, betId) {
    const bet = this.#inGroup(me, betId);
    if (bet.arbiter_id !== me.id || bet.creator_id === me.id) throw forbidden("Seul un arbitre désigné par quelqu'un d'autre peut se désister.");
    if (bet.status !== 'open') throw conflict('Les pronostics sont clos : il est trop tard pour se désister.');
    tx(this.db, () => {
      this.#touch(bet.id, { arbiter_id: null });
      this.#event(bet, 'arbiter_withdrew', me.id);
    });
  }

  // ——— Parier

  /** Parier, ou changer d'avis tant que les pronostics sont ouverts (le même choix : rien ne change). */
  pick(me, betId, optionId) {
    const bet = this.#inGroup(me, betId);
    if (bet.status !== 'open' || this.clock.now() >= bet.closes_at) throw conflict('Trop tard : les pronostics sont clos.');
    if (bet.arbiter_id === me.id) throw forbidden("Tu es l'arbitre de ce pari : tu ne peux pas parier dessus.");
    const option = this.#option(bet, optionId);
    const before = this.#pickOf(bet.id, me.id);
    if (before?.option_id === option.id) return;
    tx(this.db, () => {
      if (before) this.#changePick(bet, me.id, before.option_id, option);
      else this.#insertPick(bet, me.id, option);
      this.#sharePick(bet, this.groups.member(me.id), option);
    });
  }

  // ——— Clôturer, annuler (arbitre ou admin)

  #requireArbiterOrAdmin(bet, me) {
    if (bet.arbiter_id !== me.id && me.role !== 'admin') throw forbidden("Seul l'arbitre du pari (ou un admin) peut faire ça.");
  }

  close(me, betId) {
    const bet = this.#inGroup(me, betId);
    this.#requireArbiterOrAdmin(bet, me);
    if (bet.status !== 'open') throw conflict('Les pronostics sont déjà clos.');
    tx(this.db, () => this.#close(bet, me.id));
  }

  /**
   * Clôture : un pari automatique que personne n'a joué disparaît. Un pari entre amis sans débat (moins de 2
   * participants, ou tous du même avis) est annulé d'office ; un pari sportif (cote fixe) jamais : chaque bon
   * pronostic rapporte sa cote, même seul.
   */
  #close(bet, memberId) {
    const picks = this.picks(bet.id);
    if (!picks.length && bet.source && !bet.creator_id) {
      this.db.prepare('DELETE FROM bets WHERE id = ?').run(bet.id);
      return;
    }
    if (bet.scoring !== 'group') {
      this.#touch(bet.id, { status: 'closed', closed_at: this.#now() });
      this.#event(bet, 'closed', memberId, { auto: !memberId });
      return;
    }
    if (picks.length < MIN_PARTICIPANTS) return this.#cancel(bet, 'too_few', '', memberId);
    if (isUnanimous(picks)) return this.#cancel(bet, 'unanimous', '', memberId);
    this.#touch(bet.id, { status: 'closed', closed_at: this.#now() });
    this.#event(bet, 'closed', memberId, { auto: !memberId });
  }

  cancel(me, betId, note = '') {
    const bet = this.#inGroup(me, betId);
    this.#requireArbiterOrAdmin(bet, me);
    if (!['open', 'closed'].includes(bet.status)) throw conflict('Ce pari est déjà tranché : un admin peut corriger le résultat.');
    tx(this.db, () => this.#cancel(bet, 'arbiter', note, me.id));
  }

  #cancel(bet, reason, note, memberId) {
    const now = this.#now();
    this.#touch(bet.id, { status: 'cancelled', cancel_reason: reason, cancel_note: note ?? '', closed_at: bet.closed_at ?? now, settled_at: now });
    this.#event(bet, 'cancelled', memberId, { reason, note });
  }

  // ——— Trancher, contester, voter

  /**
   * L'arbitre (sans pronostic), ou un admin sans pronostic si l'arbitre est parti, s'est désisté ou se tait depuis 7 jours.
   * Pari relié à une source : un admin sans pronostic, si la source n'a rien donné 24 h après l'heure prévue.
   */
  canResolve(bet, me) {
    if (bet.status !== 'closed') return false;
    if (this.#pickOf(bet.id, me.id)) return false;
    if (bet.source) return me.role === 'admin' && this.clock.now() >= this.referenceTime(bet) + SOURCE_GRACE;
    const arbiter = bet.arbiter_id ? this.groups.member(bet.arbiter_id) : null;
    const arbiterActive = arbiter?.status === 'active';
    if (arbiterActive && bet.arbiter_id === me.id) return true;
    return me.role === 'admin' && (!arbiterActive || this.clock.now() >= this.referenceTime(bet) + ARBITER_GRACE);
  }

  resolve(me, betId, { optionId, note = '' }) {
    const bet = this.#inGroup(me, betId);
    if (bet.status === 'open') throw conflict('Attends la clôture des pronostics pour trancher.');
    if (bet.status !== 'closed') throw conflict('Ce pari est déjà tranché.');
    if (!this.canResolve(bet, me)) throw forbidden("Seul l'arbitre peut trancher ce pari (ou un admin s'il est absent depuis 7 jours).");
    const option = this.#option(bet, optionId);
    const { validationHours } = this.groups.settings(bet.group_id);
    const now = this.clock.now();
    tx(this.db, () => {
      this.#touch(bet.id, {
        status: 'validating', winning_option_id: option.id, resolution_note: note, resolved_by: me.id, resolved_at: now,
        validation_ends_at: now + validationHours * HOUR,
      });
      this.#event(bet, 'resolved', me.id, { optionId: option.id, label: option.label, note });
    });
  }

  // ——— Résultat apporté par une source de données (src/services/sources.js)

  markChecked(betId) {
    this.db.prepare('UPDATE bets SET source_checked_at = ? WHERE id = ?').run(this.clock.now(), betId);
  }

  /**
   * outcome : { state: 'final', key, note } → résultat officiel, points aussitôt : ni validation, ni contestation, ni vote
   *           (le groupe ne vote pas contre un score officiel ; une erreur de la source, un admin la corrige) ;
   *           { state: 'void', note } → pari annulé (match reporté, question annulée…).
   * Rend false si le pari n'attend plus de résultat (déjà tranché à la main, annulé…).
   */
  /**
   * Pari de source annulé avant son résultat (l'affiche a changé : forfait remplacé par un autre joueur), qu'il soit
   * encore ouvert ou déjà clos : aucun point. Rend false s'il était déjà réglé ou annulé.
   */
  cancelForSource(betId, note) {
    return tx(this.db, () => {
      const bet = this.get(betId);
      if (!bet.source || !['open', 'closed'].includes(bet.status)) return false;
      this.#cancel(bet, 'source', note, null);
      return true;
    });
  }

  applySourceResult(betId, outcome, sourceName) {
    return tx(this.db, () => {
      const bet = this.get(betId);
      if (!bet.source || bet.status !== 'closed') return false;
      if (outcome.state === 'void') {
        this.#cancel(bet, 'source', outcome.note ?? '', null);
        return true;
      }
      const option = this.db.prepare('SELECT * FROM bet_options WHERE bet_id = ? AND source_key = ?').get(bet.id, String(outcome.key));
      if (!option) throw new Error(`Réponse « ${outcome.key} » de la source sans option dans le pari ${bet.id}`);
      const now = this.clock.now();
      this.#touch(bet.id, {
        status: 'validating', winning_option_id: option.id, resolution_note: outcome.note ?? '', resolved_by: null, resolved_at: now,
        validation_ends_at: now,
      });
      this.#event(bet, 'resolved', null, { optionId: option.id, label: option.label, note: outcome.note ?? '', auto: true, source: sourceName });
      this.#settle(this.get(bet.id), { contested: false });
      return true;
    });
  }

  contest(me, betId, reason) {
    const bet = this.#inGroup(me, betId);
    if (bet.source) throw conflict('C’est le résultat officiel : il ne se conteste pas. Une erreur de la source ? Un admin du groupe peut le corriger.');
    if (bet.status !== 'validating' || this.clock.now() >= bet.validation_ends_at) throw conflict('Le délai de contestation est passé.');
    if (!this.#pickOf(bet.id, me.id)) throw forbidden('Seuls les participants peuvent contester le résultat.');
    const { voteHours } = this.groups.settings(bet.group_id);
    const now = this.clock.now();
    tx(this.db, () => {
      this.db.prepare('INSERT INTO disputes (bet_id, member_id, reason, created_at) VALUES (?, ?, ?, ?)').run(bet.id, me.id, reason, now);
      this.#touch(bet.id, { status: 'voting', contested: 1, vote_ends_at: now + voteHours * HOUR });
      this.#event(bet, 'contested', me.id, { reason });
    });
  }

  eligibleVoters(bet) {
    return this.groups.activeMembers(bet.group_id).filter((m) => m.id !== bet.resolved_by);
  }

  votes(betId) {
    return this.db.prepare('SELECT member_id, choice, created_at FROM votes WHERE bet_id = ? ORDER BY created_at').all(betId)
      .map((v) => ({ memberId: v.member_id, choice: v.choice, createdAt: v.created_at }));
  }

  vote(me, betId, choice) {
    const bet = this.#inGroup(me, betId);
    if (bet.status !== 'voting' || this.clock.now() >= bet.vote_ends_at) throw conflict('Le vote est terminé.');
    if (me.id === bet.resolved_by) throw forbidden("L'arbitre ne vote pas sur sa propre décision.");
    if (this.votes(bet.id).some((v) => v.memberId === me.id)) throw conflict('Tu as déjà voté.');
    const label = choice === 'cancel' ? 'Annuler' : this.#option(bet, choice).label;
    tx(this.db, () => {
      this.db.prepare('INSERT INTO votes (bet_id, member_id, choice, created_at) VALUES (?, ?, ?, ?)').run(bet.id, me.id, choice, this.clock.now());
      this.#event(bet, 'voted', me.id, { choice, label });
      const voted = new Set(this.votes(bet.id).map((v) => v.memberId));
      if (this.eligibleVoters(bet).every((m) => voted.has(m.id))) this.#finishVote(this.get(bet.id));
    });
  }

  #finishVote(bet) {
    const { result, reason, counts } = tallyVotes(this.votes(bet.id), bet.winning_option_id);
    this.#event(bet, 'vote_ended', null, { result, reason, counts });
    if (result === 'cancel') return this.#cancel(bet, reason === 'tie' ? 'vote_tie' : 'vote', '', null);
    this.#touch(bet.id, { winning_option_id: result });
    this.#settle(this.get(bet.id), { contested: true });
  }

  /** Attribue les points (nouveau « round » du journal) et passe le pari en « réglé ». */
  #settle(bet, { contested }) {
    const now = this.#now();
    const fixedOdds = bet.scoring === 'group' ? null : new Map(this.options(bet.id).map((o) => [o.id, o.odds]));
    const r = settle({
      picks: this.picks(bet.id), winningOptionId: bet.winning_option_id, settings: this.groups.settings(bet.group_id),
      resolverId: bet.resolved_by, contested, fixedOdds,
    });
    const round = bet.round + 1;
    const insert = this.db.prepare('INSERT INTO points (group_id, member_id, bet_id, round, kind, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const a of r.awards) insert.run(bet.group_id, a.memberId, bet.id, round, a.kind, a.amount, now);
    this.#touch(bet.id, { status: 'settled', settled_at: now, round });
    const prime = r.awards.find((a) => a.kind === 'prime') ?? null;
    this.#event(bet, 'settled', null, {
      outcome: r.outcome, odds: r.odds, each: r.each, winningOptionId: bet.winning_option_id,
      winners: r.awards.filter((a) => a.kind === 'gain').map((a) => a.memberId), prime,
    });
  }

  /** Correction par un admin : écritures inverses pour le dernier règlement, puis nouveau règlement (sans prime). */
  correct(me, betId, { optionId, reason }) {
    if (me.role !== 'admin') throw forbidden('Seul un admin peut corriger un résultat.');
    const bet = this.#inGroup(me, betId);
    const correctable = bet.status === 'settled' || (bet.status === 'cancelled' && bet.resolved_at != null);
    if (!correctable) throw conflict('Seul un pari déjà réglé peut être corrigé.');
    if (optionId !== 'cancel') this.#option(bet, optionId);
    const from = bet.status === 'settled' ? bet.winning_option_id : 'cancel';
    if (from === optionId) throw badRequest("C'est déjà le résultat enregistré.");
    tx(this.db, () => {
      const now = this.clock.now();
      const rows = this.db.prepare("SELECT member_id, amount FROM points WHERE bet_id = ? AND round = ? AND kind != 'reversal'").all(bet.id, bet.round);
      const insert = this.db.prepare("INSERT INTO points (group_id, member_id, bet_id, round, kind, amount, created_at) VALUES (?, ?, ?, ?, 'reversal', ?, ?)");
      for (const r of rows) insert.run(bet.group_id, r.member_id, bet.id, bet.round, -r.amount, now);
      this.#event(bet, 'corrected', me.id, { from, to: optionId, reason });
      if (optionId === 'cancel') return this.#cancel(bet, 'correction', reason, me.id);
      this.#touch(bet.id, { winning_option_id: optionId, cancel_reason: null, cancel_note: '' });
      this.#settle(this.get(bet.id), { contested: true });
    });
  }

  // ——— Commentaires

  comment(me, betId, body) {
    const bet = this.#inGroup(me, betId);
    if (!this.groups.settings(bet.group_id).comments) throw forbidden('Les commentaires sont désactivés dans ce groupe.');
    const id = newId();
    tx(this.db, () => {
      this.db.prepare('INSERT INTO comments (id, bet_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, bet.id, me.id, body, this.clock.now());
      this.#event(bet, 'commented', me.id, { excerpt: body.slice(0, 60) });
    });
    return id;
  }

  deleteComment(me, betId, commentId) {
    const bet = this.#inGroup(me, betId);
    const c = this.db.prepare('SELECT * FROM comments WHERE id = ? AND bet_id = ?').get(String(commentId), bet.id);
    if (!c) throw notFound('Commentaire introuvable.');
    if (c.member_id !== me.id && me.role !== 'admin') throw forbidden('Tu ne peux supprimer que tes propres commentaires.');
    this.db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  }

  // ——— Échéances

  /** Applique les échéances passées : clôtures, fins de validation et de vote, paris abandonnés. */
  sweep(groupId) {
    const now = this.clock.now();
    const due = this.db.prepare(`SELECT * FROM bets WHERE group_id = ? AND (
        (status = 'open' AND closes_at <= ?) OR (status = 'validating' AND validation_ends_at <= ?)
        OR (status = 'voting' AND vote_ends_at <= ?) OR status = 'closed')`).all(groupId, now, now, now);
    for (const { id } of due) {
      const bet = this.get(id);
      const abandonAt = this.referenceTime(bet) + ABANDON_AFTER;
      const [at, apply] =
        bet.status === 'open' && bet.closes_at <= now ? [bet.closes_at, () => this.#close(bet, null)]
          : bet.status === 'validating' && bet.validation_ends_at <= now ? [bet.validation_ends_at, () => this.#settle(bet, { contested: false })]
            : bet.status === 'voting' && bet.vote_ends_at <= now ? [bet.vote_ends_at, () => this.#finishVote(bet)]
              : bet.status === 'closed' && now >= abandonAt ? [abandonAt, () => this.#cancel(bet, 'abandoned', '', null)]
                : [null, null];
      if (!apply) continue;
      this.#at = at;
      try {
        tx(this.db, apply);
      } finally {
        this.#at = null;
      }
    }
  }

  sweepAll() {
    for (const { id } of this.db.prepare('SELECT id FROM groups').all()) this.sweep(id);
  }

  // ——— Vues pour l'API

  permissions(bet, me, picks = this.picks(bet.id)) {
    const now = this.clock.now();
    const mine = picks.find((p) => p.memberId === me.id);
    const isCreator = bet.creator_id === me.id;
    const isArbiter = bet.arbiter_id === me.id;
    const isAdmin = me.role === 'admin';
    const open = bet.status === 'open' && now < bet.closes_at;
    const beforeVerdict = ['open', 'closed'].includes(bet.status);
    return {
      pick: open && !isArbiter, // parier, ou changer d'avis jusqu'à la clôture
      edit: isCreator && !bet.source && bet.status === 'open' && picks.length === 0,
      delete: isCreator && bet.status === 'open' && picks.length === 0,
      addDetail: isCreator && beforeVerdict,
      postpone: isCreator && open && !bet.source,
      setArbiter: isCreator && beforeVerdict && !bet.source,
      withdrawArbiter: isArbiter && !isCreator && bet.status === 'open',
      close: open && (isArbiter || isAdmin),
      cancel: beforeVerdict && (isArbiter || isAdmin),
      resolve: this.canResolve(bet, me),
      contest: !bet.source && bet.status === 'validating' && now < bet.validation_ends_at && !!mine,
      vote: bet.status === 'voting' && now < bet.vote_ends_at && me.id !== bet.resolved_by
        && !this.votes(bet.id).some((v) => v.memberId === me.id),
      correct: isAdmin && (bet.status === 'settled' || (bet.status === 'cancelled' && bet.resolved_at != null)),
      check: !!bet.source && bet.status === 'closed',
    };
  }

  /** Points du dernier règlement, par membre (gain + prime). */
  awards(bet) {
    if (!bet.round) return [];
    return this.db.prepare("SELECT member_id, kind, amount FROM points WHERE bet_id = ? AND round = ? AND kind != 'reversal'").all(bet.id, bet.round)
      .map((r) => ({ memberId: r.member_id, kind: r.kind, amount: r.amount }));
  }

  /**
   * Pari relié à une source : d'où vient le résultat (name), avec le lien vers l'événement et le site qu'il ouvre (site :
   * la page Wikipédia d'un Grand Prix de F1, alors que le résultat vient de Jolpica).
   */
  sourceInfo(bet) {
    if (!bet.source) return null;
    const ref = JSON.parse(bet.source_ref);
    const source = sourceById(bet.source);
    const url = ref.url ?? null;
    return {
      id: bet.source, emoji: source?.emoji ?? '📡', name: source?.provider.name ?? bet.source,
      label: ref.label, url, site: url ? siteName(url) : null, checkedAt: bet.source_checked_at,
    };
  }

  /**
   * La rencontre d'un pari de source, pour l'affichage : { layout, competitors, live } (images servies par /media),
   * ou null (pari maison, source sans visuel comme la météo).
   */
  eventInfo(bet) {
    if (!bet.source || !this.live) return null;
    const info = this.live.get(JSON.parse(bet.source_ref).key);
    if (!info?.media && !info?.live) return null;
    const competitors = (info.media?.competitors ?? []).map((c) => ({
      key: c.key, name: c.name, abbr: c.abbr || null, number: c.number ?? null, team: c.team || null, country: c.country ?? null,
      color: c.color ?? null, img: mediaUrl(c.logo ?? c.img), flag: mediaUrl(c.flag), record: c.record ?? null,
    }));
    // factsRead (factsTried avant le 2026-11-01) : marque interne du direct (SourceService.refreshLive), pas pour l'app.
    const { factsRead, factsTried, ...live } = info.live ?? {};
    return { layout: info.media?.layout ?? 'versus', competitors, live: info.live ? live : null, liveAt: info.liveAt ?? null };
  }

  summary(bet, me, settings = this.groups.settings(bet.group_id)) {
    const picks = this.picks(bet.id);
    const odds = new Map(oddsByOption(this.options(bet.id).map((o) => o.id), picks).map((o) => [o.optionId, o]));
    const awards = this.awards(bet);
    const can = this.permissions(bet, me, picks);
    return {
      id: bet.id,
      question: bet.question,
      categoryId: bet.category,
      ranking: this.seasons.info(bet.group_id, bet.ranking ?? `cat:${bet.category}`, settings),
      seasonId: bet.season_id,
      auto: !bet.creator_id,
      scoring: bet.scoring,
      kind: bet.kind,
      status: bet.status,
      creatorId: bet.creator_id,
      arbiterId: bet.arbiter_id,
      resolvedBy: bet.resolved_by,
      closesAt: bet.closes_at,
      expectedAt: bet.expected_at,
      createdAt: bet.created_at,
      closedAt: bet.closed_at,
      resolvedAt: bet.resolved_at,
      validationEndsAt: bet.validation_ends_at,
      voteEndsAt: bet.vote_ends_at,
      settledAt: bet.settled_at,
      contested: !!bet.contested,
      winningOptionId: bet.winning_option_id,
      cancelReason: bet.cancel_reason,
      source: this.sourceInfo(bet),
      event: this.eventInfo(bet),
      participants: picks.length,
      options: this.options(bet.id).map((o) => {
        const { count, odds: groupOdds } = odds.get(o.id);
        const value = bet.scoring === 'group' ? (picks.length >= MIN_PARTICIPANTS ? groupOdds : null) : o.odds;
        return {
          id: o.id, label: o.label, key: o.source_key, count, odds: value,
          points: value ? pointsFor(value, settings) : null,
          pickers: picks.filter((p) => p.optionId === o.id).map((p) => p.memberId),
        };
      }),
      myPick: picks.find((p) => p.memberId === me.id)?.optionId ?? null,
      myPoints: awards.filter((a) => a.memberId === me.id).reduce((s, a) => s + a.amount, 0),
      awards,
      overdue: bet.status === 'closed' && this.clock.now() > this.referenceTime(bet) + REMIND_AFTER,
      can,
    };
  }

  list(me, { all = false } = {}) {
    const since = all ? 0 : this.clock.now() - FINISHED_KEPT;
    const rows = this.db.prepare(`SELECT * FROM bets WHERE group_id = ?
        AND (status IN ('open','closed','validating','voting') OR COALESCE(settled_at, updated_at) >= ?)
        ORDER BY created_at DESC`).all(me.group_id, since);
    const settings = this.groups.settings(me.group_id);
    const choices = this.follows.choices(me.id);
    return rows.filter((bet) => {
      const feed = feedOf(bet);
      return !feed || choices.get(feed) === 'in' || this.#pickOf(bet.id, me.id);
    }).map((bet) => this.summary(bet, me, settings));
  }

  /** Les paris d'une saison (historique d'un classement), du plus récent au plus ancien. */
  listSeason(me, seasonId) {
    const season = this.db.prepare('SELECT group_id FROM seasons WHERE id = ?').get(String(seasonId));
    if (season?.group_id !== me.group_id) throw notFound('Saison introuvable.');
    const settings = this.groups.settings(me.group_id);
    return this.db.prepare('SELECT * FROM bets WHERE season_id = ? ORDER BY closes_at DESC').all(String(seasonId))
      .map((bet) => this.summary(bet, me, settings));
  }

  detail(me, betId) {
    const bet = this.#inGroup(me, betId);
    const dispute = this.db.prepare('SELECT * FROM disputes WHERE bet_id = ?').get(bet.id);
    return {
      ...this.summary(bet, me),
      details: bet.details,
      resolutionNote: bet.resolution_note,
      cancelNote: bet.cancel_note,
      dispute: dispute ? { memberId: dispute.member_id, reason: dispute.reason, createdAt: dispute.created_at } : null,
      votes: this.votes(bet.id),
      eligibleVoters: bet.status === 'voting' ? this.eligibleVoters(bet).map((m) => m.id) : [],
      events: this.db.prepare('SELECT * FROM events WHERE bet_id = ? ORDER BY id').all(bet.id).map(parseEvent),
      comments: this.db.prepare('SELECT * FROM comments WHERE bet_id = ? ORDER BY created_at').all(bet.id)
        .map((c) => ({ id: c.id, memberId: c.member_id, body: c.body, createdAt: c.created_at })),
    };
  }
}
