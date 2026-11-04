// La page Activité du groupe : le fil regroupé (résultats en cartes, pronostics d'une même personne ensemble, nouveaux
// paris en une ligne) et « À la une » (ce qui s'est passé depuis 24 h). Le fil brut (/feed) reste pour le reste de l'app.
import { DAY, HOUR } from '../lib/util.js';
import { dayKey } from '../lib/time.js';
import { parseEvent } from './events.js';

const RAW = 400; // événements relus pour composer le fil
const ITEMS = 80; // éléments du fil au plus
const PICKS_GAP = 3 * HOUR; // pronostics d'une même personne à moins de 3 h d'écart, le même jour : regroupés
const FLAIR_ODDS = 2.5; // « coup de flair » : un bon pronostic à cette cote au moins
// Sans intérêt pour le fil : les votes un par un, les retouches, les réglages ; la clôture et le résultat officiel d'un
// pari de source (sa carte de résultat dit tout).
const hidden = (e) => ['voted', 'edited', 'pin_reset', 'invite_regenerated', 'address_changed'].includes(e.type)
  || (e.type === 'closed' && !e.memberId) || (e.type === 'resolved' && e.data.auto);
const RESULTS_GROUP = 3; // résultats d'une même compétition le même jour : une seule carte à partir de 3

/**
 * Les résultats d'une même compétition le même jour (souvent réglés d'un coup) : une carte « results » avec le bilan de
 * chacun ({ memberId, played, won, points }) et la liste des résultats, à la place du plus récent.
 */
function groupResults(items) {
  const groups = new Map();
  for (const it of items) {
    if (it.kind !== 'result') continue;
    const key = `${it.ranking.key}|${dayKey(it.at)}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const merged = new Map();
  for (const list of groups.values()) {
    if (list.length < RESULTS_GROUP) continue;
    const tally = new Map();
    const of = (id) => tally.get(id) ?? tally.set(id, { memberId: id, played: 0, won: 0, points: 0 }).get(id);
    for (const r of list) {
      for (const g of r.gains) Object.assign(of(g.memberId), { played: of(g.memberId).played + 1, won: of(g.memberId).won + 1, points: of(g.memberId).points + g.amount });
      for (const id of r.missed) of(id).played += 1;
    }
    const group = { kind: 'results', at: list[0].at, ranking: list[0].ranking, results: list, players: [...tally.values()].sort((a, b) => b.points - a.points || b.won - a.won) };
    for (const r of list) merged.set(r, r === list[0] ? group : null);
  }
  return items.flatMap((it) => (merged.has(it) ? (merged.get(it) ? [merged.get(it)] : []) : [it]));
}

/**
 * Éléments du fil (kind) : result (un pari réglé : la rencontre, le résultat, les points de chacun), picks (les
 * pronostics d'une même personne), opened (nouveaux paris ouverts tout seuls), comment, season (fin de saison), line
 * (le reste, raconté par l'événement d'origine).
 */
export class ActivityService {
  constructor(db, clock, { bets, seasons, groups }) {
    this.db = db;
    this.clock = clock;
    this.bets = bets;
    this.seasons = seasons;
    this.groups = groups;
  }

  activity(groupId) {
    return { highlights: this.highlights(groupId), items: this.items(groupId) };
  }

  #bet(betId) {
    return betId ? this.db.prepare('SELECT * FROM bets WHERE id = ?').get(betId) ?? null : null;
  }

  #ranking(groupId, bet) {
    const info = this.seasons.info(groupId, bet.ranking ?? `cat:${bet.category}`);
    return { key: info.key, emoji: info.emoji, label: info.label };
  }

  #option(optionId) {
    return optionId ? this.db.prepare('SELECT id, label, odds FROM bet_options WHERE id = ?').get(optionId) ?? null : null;
  }

  items(groupId) {
    const comments = this.groups.settings(groupId).comments; // désactivés : leurs traces disparaissent du fil
    const events = this.db.prepare(`SELECT * FROM events WHERE group_id = ? AND NOT (type = 'created' AND member_id IS NULL)
        ORDER BY id DESC LIMIT ?`).all(groupId, RAW).map(parseEvent).filter((e) => !hidden(e) && (comments || e.type !== 'commented'));
    const items = [];
    const openPicks = new Map(); // memberId → l'élément « picks » où ranger ses pronostics plus anciens
    let lastOpened = null;
    for (const e of events) {
      if (e.type === 'picked' || e.type === 'pick_changed') {
        this.#addPick(items, openPicks, e);
        continue;
      }
      if (e.type === 'auto_opened') {
        if (lastOpened && dayKey(lastOpened.at) === dayKey(e.createdAt)) this.#mergeOpened(groupId, lastOpened, e);
        else items.push(lastOpened = this.#mergeOpened(groupId, { kind: 'opened', at: e.createdAt, count: 0, rankings: [] }, e));
        continue;
      }
      const item = this.#item(groupId, e);
      if (item) items.push(item);
    }
    return groupResults(items.sort((a, b) => b.at - a.at)).slice(0, ITEMS);
  }

  #addPick(items, openPicks, e) {
    let item = openPicks.get(e.memberId);
    if (!item || dayKey(item.since) !== dayKey(e.createdAt) || item.since - e.createdAt > PICKS_GAP) {
      item = { kind: 'picks', at: e.createdAt, since: e.createdAt, memberId: e.memberId, picks: [] };
      openPicks.set(e.memberId, item);
      items.push(item);
    }
    item.since = e.createdAt;
    const known = item.picks.find((p) => p.betId === e.betId);
    // Le plus récent d'abord : un pronostic plus ancien sur le même pari est un changement d'avis.
    if (known) {
      known.changed = true;
      return;
    }
    const bet = this.#bet(e.betId);
    if (!bet) return;
    const option = this.#option(e.data.optionId);
    item.picks.push({
      betId: bet.id, question: bet.question, label: e.data.label, odds: option?.odds ?? null,
      changed: e.type === 'pick_changed', from: e.type === 'pick_changed' ? e.data.from ?? null : null, shared: e.data.shared ?? null,
    });
  }

  #mergeOpened(groupId, item, e) {
    item.count += e.data.count ?? 0;
    for (const { ranking, n } of e.data.rankings ?? []) {
      const known = item.rankings.find((r) => r.key === ranking);
      if (known) known.n += n;
      else {
        const info = this.seasons.info(groupId, ranking);
        item.rankings.push({ key: ranking, emoji: info.emoji, label: info.label, n });
      }
    }
    // Ouvertures d'avant le détail par classement : leur texte suffit.
    if (!e.data.rankings && e.data.labels) item.labels = [item.labels, e.data.labels].filter(Boolean).join(', ');
    return item;
  }

  #item(groupId, e) {
    const bet = this.#bet(e.betId);
    switch (e.type) {
      case 'settled': return bet ? this.#result(groupId, bet, e) : null;
      case 'commented': return bet ? { kind: 'comment', at: e.createdAt, memberId: e.memberId, betId: bet.id, question: bet.question, text: e.data.excerpt } : null;
      case 'season_closed': return { kind: 'season', at: e.createdAt, ...e.data };
      default: return { kind: 'line', at: e.createdAt, event: { ...e, question: bet?.question ?? null } };
    }
  }

  /** Un pari réglé : sa rencontre (écussons, score final), la réponse gagnante, les points de chacun, qui s'est trompé. */
  #result(groupId, bet, e) {
    const d = e.data;
    const winning = this.#option(d.winningOptionId);
    const pickers = this.db.prepare('SELECT member_id, option_id FROM picks WHERE bet_id = ?').all(bet.id);
    const winners = new Set(d.winners ?? []);
    const event = this.bets.eventInfo(bet);
    return {
      kind: 'result', at: e.createdAt, betId: bet.id, question: bet.question, ranking: this.#ranking(groupId, bet),
      event: event ? { layout: event.layout, competitors: event.competitors, scores: event.live?.scores ?? null } : null,
      winning: winning?.label ?? null, outcome: d.outcome, odds: d.odds ?? null,
      gains: [...winners].map((memberId) => ({ memberId, amount: d.each ?? 0 })),
      missed: pickers.filter((p) => !winners.has(p.member_id)).map((p) => p.member_id),
      prime: d.prime ?? null,
    };
  }

  /**
   * « À la une » : depuis 24 h, les paris réglés, qui a gagné le plus, le coup de flair (un bon pronostic à grosse cote),
   * les leaders des classements qui ont bougé (et qui passe en tête), les champions sacrés. null s'il ne s'est rien passé.
   */
  highlights(groupId) {
    const since = this.clock.now() - DAY;
    const settled = this.db.prepare("SELECT * FROM events WHERE group_id = ? AND type = 'settled' AND created_at >= ? ORDER BY id DESC")
      .all(groupId, since).map(parseEvent);
    const champions = this.db.prepare("SELECT * FROM events WHERE group_id = ? AND type = 'season_closed' AND created_at >= ? ORDER BY id DESC")
      .all(groupId, since).map((e) => parseEvent(e).data);
    if (!settled.length && !champions.length) return null;
    const gains = this.db.prepare(`SELECT member_id, SUM(amount) AS s FROM points WHERE group_id = ? AND created_at >= ?
        GROUP BY member_id HAVING s > 0 ORDER BY s DESC LIMIT 3`).all(groupId, since).map((r) => ({ memberId: r.member_id, amount: r.s }));

    const scored = settled.filter((e) => e.data.outcome === 'scored' && e.data.odds >= FLAIR_ODDS && e.data.winners?.length);
    const best = scored.sort((a, b) => b.data.odds - a.data.odds || b.data.each - a.data.each)[0];
    let flair = null;
    if (best) {
      const bet = this.#bet(best.betId);
      flair = bet && {
        memberIds: best.data.winners, betId: bet.id, question: bet.question, label: this.#option(best.data.winningOptionId)?.label ?? null,
        odds: best.data.odds, amount: best.data.each,
      };
    }
    return { since, settled: new Set(settled.map((e) => e.betId)).size, gains, flair, leaders: this.#leaders(groupId, settled, since), champions };
  }

  /** Les classements où des paris ont été réglés : leur leader, et s'il vient de passer en tête. */
  #leaders(groupId, settled, since) {
    const keys = new Set(settled.map((e) => this.#bet(e.betId)).filter(Boolean).map((b) => b.ranking ?? `cat:${b.category}`));
    const out = [];
    for (const r of this.seasons.rankings(groupId, null).filter((x) => keys.has(x.key) && x.leader)) {
      const standings = this.seasons.standings(r.season.id);
      const recent = new Map(this.db.prepare(`SELECT pt.member_id, SUM(pt.amount) AS s FROM points pt JOIN bets b ON b.id = pt.bet_id
          WHERE b.season_id = ? AND pt.created_at >= ? GROUP BY pt.member_id`).all(r.season.id, since).map((x) => [x.member_id, x.s]));
      const before = standings.map((x) => ({ memberId: x.memberId, score: x.score - (recent.get(x.memberId) ?? 0) }))
        .filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0] ?? null;
      // « passe en tête » : seulement s'il dépasse quelqu'un (un premier leader n'a doublé personne).
      out.push({ key: r.key, emoji: r.emoji, label: r.label, memberId: r.leader.memberId, score: r.leader.score, change: before != null && before.memberId !== r.leader.memberId });
    }
    return out.sort((a, b) => b.change - a.change).slice(0, 4);
  }
}
