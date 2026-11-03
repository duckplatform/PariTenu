// 🎾 Tennis : les matchs en simple des tournois ATP et WTA (ESPN), dès que leur horaire est connu.
import { frDateTime } from '../lib/time.js';
import { HOUR, MINUTE } from '../lib/util.js';
import { athleteMedia, daysAround, duelLive, ESPN, ESPN_PROVIDER, liveFromBoards, scoreboards, seasonOf, voidNote, ymd } from './espn.js';
import { clip, httpsUrl, PENDING, sportTitle } from './http.js';

const DAYS_AHEAD = 2; // les horaires ne sont connus que la veille
const MATCH_LENGTH = 4 * HOUR;
const COMPETITIONS = [
  { id: 'atp', label: 'ATP (simple messieurs)', path: 'tennis/atp' },
  { id: 'wta', label: 'WTA (simple dames)', path: 'tennis/wta' },
];
const ROUNDS = {
  'Round 1': '1er tour', 'Round 2': '2e tour', 'Round 3': '3e tour', 'Round 4': '4e tour', 'Round of 128': '1er tour',
  'Round of 64': '2e tour', 'Round of 32': '3e tour', 'Round of 16': '8e de finale', Quarterfinal: 'quart de finale',
  Quarterfinals: 'quart de finale', Semifinal: 'demi-finale', Semifinals: 'demi-finale', Final: 'finale', 'Round Robin': 'phase de poules',
};
const DETAILS = 'Résultat : vainqueur officiel (abandon en cours de match : le joueur qualifié gagne). Forfait avant le match ou match annulé : pari annulé.';

const player = (c) => clip(c.athlete?.displayName || c.athlete?.shortName || '', 30);
const singles = (g) => /singles/.test(g.grouping?.slug ?? '');

const duel = (match) => ({ layout: 'versus', competitors: (match.competitors ?? []).slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((c) => athleteMedia(c, 'tennis', player(c))) });

/** Tous les matchs d'un tableau de jour : [{ tournament, match }]. */
const matchesOf = (data) => (data.events ?? []).flatMap((ev) => (ev.groupings ?? []).filter(singles)
  .flatMap((g) => (g.competitions ?? []).map((match) => ({ tournament: ev, match }))));

export default {
  id: 'tennis',
  category: 'sport',
  emoji: '🎾',
  name: 'Tennis',
  provider: ESPN_PROVIDER,
  about: 'Les matchs en simple des tournois, dès que l’horaire est connu (la veille) ; le vainqueur arrive tout seul.',
  competitions: COMPETITIONS.map(({ id, label }) => ({ id, label, fallbackMonth: 1 })),
  params: [],
  competitionOf: (ref) => (COMPETITIONS.some((c) => c.path === ref.path) ? ref.path.split('/')[1] : null),
  matchup: true, // deux joueurs face à face : un forfait remplacé par un autre joueur annule le pari (SourceService)

  async events({ competitions: selected = [] }, io) {
    const comps = COMPETITIONS.filter((c) => selected.includes(c.id));
    if (!comps.length) return [];
    const seen = new Set();
    const events = [];
    for (const { comp, data } of await scoreboards(comps, DAYS_AHEAD, io)) {
      for (const { tournament, match } of matchesOf(data)) {
        const startsAt = Date.parse(match.date);
        const round = match.round?.displayName ?? '';
        const [p1, p2] = match.competitors ?? [];
        if (seen.has(match.id) || match.status?.type?.state !== 'pre' || match.timeValid === false || /qualif/i.test(round)) continue;
        if (!(startsAt > io.now + 10 * MINUTE) || !p1 || !p2 || !player(p1) || !player(p2) || /^TBD/i.test(player(p1) + player(p2))) continue;
        seen.add(match.id);
        const [a, b] = [p1, p2].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
        const name = clip(tournament.name, 40);
        const stage = ROUNDS[round] ?? round.toLowerCase();
        const title = `${player(a)} – ${player(b)}`;
        const url = httpsUrl(tournament.links?.[0]?.href);
        events.push({
          id: String(match.id),
          title,
          subtitle: `${name} · ${stage} · ${frDateTime(startsAt)}`,
          startsAt,
          url,
          markets: [{
            id: 'winner', kind: 'multi', question: sportTitle('Tennis', `${name}, ${stage}`, title),
            options: [{ key: String(a.id), label: player(a) }, { key: String(b.id), label: player(b) }],
            closesAt: startsAt, expectedAt: startsAt + MATCH_LENGTH, details: DETAILS, competition: comp.id, season: seasonOf(data, startsAt, comp),
            media: duel(match),
            ref: {
              path: comp.path, matchId: String(match.id), day: ymd(startsAt), market: 'winner',
              label: `${comp.label} · ${name} · ${title}`, url, closesMax: startsAt, key: `tennis:${match.id}:winner`,
            },
          }],
        });
      }
    }
    return events.sort((x, y) => x.startsAt - y.startsAt);
  },

  /** Jeux de chaque set en direct, et photos ou drapeaux des joueurs : Map(ref.key → { media, live }). */
  live(refs, io) {
    const boards = new Map();
    for (const ref of refs) {
      for (const day of daysAround(ref.day)) {
        const url = `${ESPN}/${ref.path}/scoreboard?dates=${day}`;
        boards.set(url, [...(boards.get(url) ?? []), ref]);
      }
    }
    return liveFromBoards([...boards].map(([url, list]) => ({ url, refs: list })), (data, ref) => {
      const match = matchesOf(data).find((m) => String(m.match.id) === ref.matchId)?.match;
      return match ? { media: duel(match), live: duelLive(match, 'set') } : null;
    }, io);
  },

  async result(ref, { fetchJson }) {
    let match = null;
    for (const day of daysAround(ref.day)) {
      const data = await fetchJson(`${ESPN}/${ref.path}/scoreboard?dates=${day}`, { ttl: 5 * MINUTE });
      match = matchesOf(data).find((m) => String(m.match.id) === ref.matchId)?.match;
      if (match) break;
    }
    if (!match) return PENDING;
    const type = match.status?.type ?? {};
    const winner = match.competitors?.find((c) => c.winner);
    if (/WALKOVER/.test(type.name ?? '')) return { state: 'void', note: 'Forfait avant le match' };
    if (type.completed && winner) {
      return {
        state: 'final', key: String(winner.id), live: duelLive(match, 'set'),
        note: `Vainqueur : ${player(winner)}${/RETIRED/.test(type.name ?? '') ? ' (abandon de l’adversaire)' : ''}`,
      };
    }
    const voided = voidNote(type);
    if (voided || (type.state === 'post' && !winner)) return { state: 'void', note: voided ?? 'Match annulé' };
    return PENDING;
  },
};
