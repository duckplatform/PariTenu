import { tx } from '../db.js';
import { naturalSeason, fixedSeason } from '../core/seasons.js';
import { notFound } from '../lib/errors.js';
import { DAY, newId } from '../lib/util.js';
import { sourceById } from '../sources/index.js';
import { addEvent } from './events.js';
import { publicMember } from './groups.js';

const UNFINISHED = "('open','closed','validating','voting')";
const CLOSE_ANYWAY = 35 * DAY; // une saison finie attend ses derniers résultats, mais pas indéfiniment

/**
 * Classements et saisons. Chaque pari compte dans un classement :
 *   · 'source:compétition' pour un pari ouvert par une source sportive (Ligue 1, NFL, F1…), saisons officielles ;
 *   · 'cat:catégorie' pour les autres (paris entre amis, météo, cryptos, actu), saisons de l'année.
 * Une saison finie est close quand ses derniers paris sont réglés : le meilleur score est sacré champion, et la saison
 * suivante repart de zéro. Les saisons closes gardent leur classement final et leurs paris (historique).
 */
export class SeasonService {
  constructor(db, clock, groups) {
    this.db = db;
    this.clock = clock;
    this.groups = groups;
  }

  /** { key, emoji, label, type } d'un classement, pour l'affichage. */
  info(groupId, ranking, settings = this.groups.settings(groupId)) {
    const i = ranking.indexOf(':');
    const [kind, id] = [ranking.slice(0, i), ranking.slice(i + 1)];
    if (kind === 'cat') {
      const c = settings.categories.find((x) => x.id === id);
      return { key: ranking, emoji: c?.emoji ?? '🎲', label: c?.label ?? 'Autre', type: 'category' };
    }
    const source = sourceById(kind);
    const comp = source?.competitions?.find((c) => c.id === id);
    return { key: ranking, emoji: comp?.emoji ?? source?.emoji ?? '📡', label: comp?.label ?? id, type: 'competition', sport: source?.name ?? null };
  }

  /** Id de la saison (créée au besoin). Une saison en cours prend les dernières dates connues de sa source. */
  ensure(groupId, ranking, season) {
    const row = this.db.prepare('SELECT * FROM seasons WHERE group_id = ? AND ranking = ? AND label = ?').get(groupId, ranking, season.label);
    if (!row) {
      const id = newId();
      this.db.prepare('INSERT INTO seasons (id, group_id, ranking, label, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, groupId, ranking, season.label, season.startsAt, season.endsAt);
      return id;
    }
    if (row.closed_at == null && (season.endsAt !== row.ends_at || season.startsAt < row.starts_at)) {
      this.db.prepare('UPDATE seasons SET starts_at = ?, ends_at = ? WHERE id = ?').run(Math.min(row.starts_at, season.startsAt), season.endsAt, row.id);
    }
    return row.id;
  }

  /** Pari d'une catégorie : il compte dans la saison de l'année où son résultat est attendu. */
  forCategory(groupId, category, referenceTime) {
    const ranking = `cat:${category}`;
    return { ranking, seasonId: this.ensure(groupId, ranking, naturalSeason(referenceTime)) };
  }

  /** Paris d'avant les classements par saison : rangés d'après leur source (dates fixes) ou leur catégorie. */
  backfill() {
    const rows = this.db.prepare('SELECT id, group_id, category, source, source_ref, closes_at, expected_at FROM bets WHERE season_id IS NULL').all();
    for (const b of rows) {
      const at = Math.max(b.closes_at, b.expected_at ?? 0);
      const source = b.source ? sourceById(b.source) : null;
      const ref = b.source_ref ? JSON.parse(b.source_ref) : {};
      const compId = source?.competitionOf?.(ref);
      const comp = compId && source.competitions.find((c) => c.id === compId);
      const { ranking, seasonId } = comp
        ? { ranking: `${source.id}:${comp.id}`, seasonId: this.ensure(b.group_id, `${source.id}:${comp.id}`, fixedSeason(at, comp.fallbackMonth ?? 1)) }
        : this.forCategory(b.group_id, b.category, at);
      this.db.prepare('UPDATE bets SET ranking = ?, season_id = ? WHERE id = ?').run(ranking, seasonId, b.id);
    }
    return rows.length;
  }

  // ——— Classement d'une saison

  /** Classement : points des paris de la saison (corrections comprises), réussite sur les paris réglés. */
  standings(seasonId) {
    const scores = new Map(this.db.prepare(`SELECT p.member_id, SUM(p.amount) AS s FROM points p JOIN bets b ON b.id = p.bet_id
        WHERE b.season_id = ? GROUP BY p.member_id`).all(seasonId).map((r) => [r.member_id, r.s]));
    const played = new Map(this.db.prepare(`SELECT pk.member_id, COUNT(*) AS n, SUM(pk.option_id = b.winning_option_id) AS c
        FROM picks pk JOIN bets b ON b.id = pk.bet_id WHERE b.season_id = ? AND b.status = 'settled' GROUP BY pk.member_id`)
      .all(seasonId).map((r) => [r.member_id, r]));
    const ids = new Set([...scores.keys(), ...this.db.prepare(`SELECT DISTINCT pk.member_id FROM picks pk JOIN bets b ON b.id = pk.bet_id
        WHERE b.season_id = ?`).all(seasonId).map((r) => r.member_id)]);
    const rows = [...ids].map((id) => {
      const p = played.get(id);
      return { memberId: id, score: scores.get(id) ?? 0, played: p?.n ?? 0, correct: p?.c ?? 0 };
    });
    const rate = (r) => (r.played ? r.correct / r.played : -1);
    const pseudo = (r) => this.groups.member(r.memberId)?.pseudo ?? '';
    rows.sort((a, b) => b.score - a.score || rate(b) - rate(a) || b.played - a.played || pseudo(a).localeCompare(pseudo(b), 'fr'));
    rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  #withMembers(rows) {
    return rows.map((r) => {
      const m = this.groups.member(r.memberId);
      return { ...r, member: m ? publicMember(m) : { id: r.memberId, pseudo: '?', avatar: '❔', status: 'removed' }, rate: r.played ? r.correct / r.played : null };
    });
  }

  #champions(rows) {
    return rows.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.memberId);
  }

  #pending(seasonId) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM bets WHERE season_id = ? AND status IN ${UNFINISHED}`).get(seasonId).n;
  }

  #view(row) {
    const closed = row.closed_at != null;
    const rows = closed ? JSON.parse(row.standings) : this.standings(row.id);
    const counts = this.db.prepare(`SELECT COUNT(*) AS n, SUM(status IN ${UNFINISHED}) AS pending FROM bets WHERE season_id = ?`).get(row.id);
    const now = this.clock.now();
    return {
      id: row.id, ranking: row.ranking, label: row.label, startsAt: row.starts_at, endsAt: row.ends_at, closedAt: row.closed_at,
      state: closed ? 'closed' : now >= row.ends_at ? 'ending' : now >= row.starts_at ? 'current' : 'upcoming',
      bets: counts.n, pending: counts.pending ?? 0,
      champions: closed ? this.#champions(rows) : [],
      standings: this.#withMembers(rows),
    };
  }

  /** Les saisons finies dont tous les paris sont terminés : classement figé, champion sacré, annonce dans le fil. */
  closeDue() {
    const now = this.clock.now();
    const due = this.db.prepare('SELECT * FROM seasons WHERE closed_at IS NULL AND ends_at <= ?').all(now);
    let closed = 0;
    for (const s of due) {
      if (this.#pending(s.id) && now < s.ends_at + CLOSE_ANYWAY) continue;
      tx(this.db, () => {
        const rows = this.standings(s.id);
        this.db.prepare('UPDATE seasons SET closed_at = ?, standings = ? WHERE id = ?').run(now, JSON.stringify(rows), s.id);
        if (!rows.length) return;
        const info = this.info(s.group_id, s.ranking);
        addEvent(this.db, now, {
          groupId: s.group_id, type: 'season_closed',
          data: { seasonId: s.id, ranking: s.ranking, emoji: info.emoji, name: info.label, label: s.label, champions: this.#champions(rows), score: rows[0].score },
        });
      });
      closed++;
    }
    return closed;
  }

  // ——— Vues pour l'API

  /** Tous les classements du groupe (ceux qui ont des paris), avec la saison à afficher et ma place. */
  rankings(groupId, meId) {
    const settings = this.groups.settings(groupId);
    const rows = this.db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM bets b WHERE b.season_id = s.id) AS n FROM seasons s
        WHERE s.group_id = ? ORDER BY s.starts_at`).all(groupId).filter((s) => s.n > 0);
    const byRanking = new Map();
    for (const s of rows) {
      if (!byRanking.has(s.ranking)) byRanking.set(s.ranking, []);
      byRanking.get(s.ranking).push(s);
    }
    const now = this.clock.now();
    return [...byRanking].map(([ranking, seasons]) => {
      // La saison à montrer : la dernière commencée (sinon la première à venir).
      const shown = seasons.filter((s) => s.starts_at <= now).at(-1) ?? seasons[0];
      const view = this.#view(shown);
      const mine = view.standings.find((r) => r.memberId === meId);
      return {
        ...this.info(groupId, ranking, settings),
        season: { id: view.id, label: view.label, state: view.state, endsAt: view.endsAt },
        leader: view.standings[0] && view.standings[0].score > 0 ? view.standings[0] : null,
        me: mine ? { rank: mine.rank, score: mine.score, of: view.standings.length } : null,
        players: view.standings.length,
        seasons: seasons.length,
        bets: seasons.reduce((n, s) => n + s.n, 0),
      };
    // D'abord les classements où l'on joue (et où je suis), puis les plus fournis.
    }).sort((a, b) => (b.season.state !== 'closed') - (a.season.state !== 'closed') || (b.players > 0) - (a.players > 0)
      || (b.me != null) - (a.me != null) || b.bets - a.bets);
  }

  /** Un classement : la saison choisie (ou celle à montrer) et la liste de toutes ses saisons avec leurs champions. */
  ranking(groupId, ranking, seasonId = null) {
    const seasons = this.db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM bets b WHERE b.season_id = s.id) AS n FROM seasons s
        WHERE s.group_id = ? AND s.ranking = ? ORDER BY s.starts_at DESC`).all(groupId, ranking).filter((s) => s.n > 0);
    if (!seasons.length) throw notFound('Ce classement n’a pas encore de paris.');
    const now = this.clock.now();
    const chosen = seasonId ? seasons.find((s) => s.id === seasonId) : seasons.find((s) => s.starts_at <= now) ?? seasons.at(-1);
    if (!chosen) throw notFound('Saison introuvable.');
    return {
      ...this.info(groupId, ranking),
      season: this.#view(chosen),
      seasons: seasons.map((s) => ({
        id: s.id, label: s.label, startsAt: s.starts_at, endsAt: s.ends_at, closedAt: s.closed_at, bets: s.n,
        champions: s.closed_at != null ? this.#champions(JSON.parse(s.standings)) : [],
      })),
    };
  }

  /** Saisons closes gagnées par un membre (badges 🏆) et dernière place des saisons closes récentes (🐌). */
  honours(groupId, memberId) {
    const closed = this.db.prepare('SELECT * FROM seasons WHERE group_id = ? AND closed_at IS NOT NULL ORDER BY ends_at').all(groupId);
    const settings = this.groups.settings(groupId);
    const titles = [];
    const lanterns = [];
    const lastOf = new Map();
    for (const s of closed) {
      const rows = JSON.parse(s.standings);
      const info = this.info(groupId, s.ranking, settings);
      const name = `${info.emoji} ${info.label} · ${s.label}`;
      if (this.#champions(rows).includes(memberId)) titles.push({ seasonId: s.id, ranking: s.ranking, name, label: s.label });
      lastOf.set(s.ranking, { s, rows, name });
    }
    for (const { s, rows, name } of lastOf.values()) {
      const worst = rows.at(-1);
      if (rows.length >= 3 && worst.memberId === memberId && rows[0].score > worst.score) lanterns.push({ seasonId: s.id, name });
    }
    return { titles, lanterns };
  }

  /** Mes saisons en cours : score et place dans chaque classement où j'ai joué. */
  current(groupId, memberId) {
    const now = this.clock.now();
    const settings = this.groups.settings(groupId);
    const seasons = this.db.prepare(`SELECT DISTINCT s.* FROM seasons s JOIN bets b ON b.season_id = s.id JOIN picks pk ON pk.bet_id = b.id
        WHERE s.group_id = ? AND s.closed_at IS NULL AND s.starts_at <= ? AND pk.member_id = ?`).all(groupId, now, memberId);
    return seasons.map((s) => {
      const rows = this.standings(s.id);
      const mine = rows.find((r) => r.memberId === memberId);
      return { ...this.info(groupId, s.ranking, settings), seasonId: s.id, season: s.label, score: mine?.score ?? 0, rank: mine?.rank ?? null, of: rows.length };
    }).sort((a, b) => b.score - a.score);
  }
}
