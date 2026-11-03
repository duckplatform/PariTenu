// 🏓 Padel : les matchs des tableaux principaux de Premier Padel (Major, P1, P2, Finals), par Padel API (padelapi.org).
// Gratuit, mais avec une clé personnelle (PT_PADEL_TOKEN) : sans clé, la source n'est pas proposée.
// Offre gratuite : 10 requêtes par minute, résultats des 6 derniers mois ; le score pendant le match est payant (la fiche
// dit « en cours », score vide), les sets arrivent après coup avec la fiche du match finie.
import { fixedSeason } from '../core/seasons.js';
import { dayKey, frDateTime, parisDayAt } from '../lib/time.js';
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { clip, httpsUrl, PENDING, SourceError, sportTitle } from './http.js';

export const API = 'https://padelapi.org/api';
const DAYS_AHEAD = 2; // l'ordre de jeu n'est connu que la veille
const MATCH_LENGTH = 3 * HOUR;
const LEVELS = 'major,p1,p2,finals';
const COMPETITIONS = [
  { id: 'men', label: 'Premier Padel (messieurs)' },
  { id: 'women', label: 'Premier Padel (dames)' },
];
const ROUNDS = { 1: 'finale', 2: 'demi-finale', 4: 'quart de finale', 8: '8e de finale', 16: '16e de finale', 32: '32e de finale' };
const DETAILS = 'Résultat : paire victorieuse officielle (abandon en cours de match : la paire qualifiée gagne). Forfait avant le match ou match non joué : pari annulé.';
const OVER = ['finished', 'ended', 'retired'];
const VOID = { walkover: 'Forfait avant le match', bye: 'Pas de match (exempt)', not_played: 'Match non joué' };

/** Les joueurs d'une paire, quelle que soit la forme rendue ([joueurs], [{ players }], { players }). */
function playersOf(team) {
  const list = Array.isArray(team) ? team : team ? [team] : [];
  return list.flatMap((x) => (Array.isArray(x?.players) ? x.players : [x])).filter((p) => p?.name || p?.short_name);
}
const surname = (p) => clip(p.short_name || String(p.name).split(' ').at(-1), 20);
/** « Galán / Chingotto » */
const pairName = (team) => playersOf(team).map(surname).join(' / ') || '?';
const pairAbbr = (team) => playersOf(team).map((p) => surname(p)[0]).join('').toUpperCase();

/** Les deux paires, pour l'affichage (clé = celle des options : team_1, team_2). */
const versus = (m) => ({
  layout: 'versus',
  competitors: ['team_1', 'team_2'].map((key) => ({ key, name: pairName(m.players?.[key]), abbr: pairAbbr(m.players?.[key]) })),
});

/**
 * Heure du match : un instant ISO avec fuseau, ou une heure locale « AAAA-MM-JJ HH:MM » du serveur de Padel API
 * (Europe/Madrid, même heure que Paris toute l'année).
 */
export function matchTime(m) {
  const value = m.scheduled_at ?? m.started_time;
  if (typeof value !== 'string') return NaN;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return Date.parse(value);
  const parts = /^(\d{4}-\d\d-\d\d)[T ](\d\d):(\d\d)/.exec(value);
  return parts ? parisDayAt(parts[1], Number(parts[2])) + Number(parts[3]) * MINUTE : NaN;
}

/** Jeux de chaque set : { team_1: [6, 3], team_2: [4, 6] } (score en objets par set, ou en texte « 6-4 3-6 7-6(5) »). */
export function setsOf(score) {
  const sets = { team_1: [], team_2: [] };
  const games = (v) => Number.parseInt(String(v), 10);
  if (Array.isArray(score)) {
    for (const s of score) {
      const a = games(s?.team_1);
      const b = games(s?.team_2);
      if (Number.isFinite(a) && Number.isFinite(b)) { sets.team_1.push(a); sets.team_2.push(b); }
    }
  } else if (typeof score === 'string') {
    for (const [, a, b] of score.matchAll(/(\d+)(?:\(\d+\))?\s*[-–]\s*(\d+)/g)) { sets.team_1.push(Number(a)); sets.team_2.push(Number(b)); }
  }
  return sets.team_1.length ? sets : null;
}

/** État d'un match pour l'affichage : { state, clock, scores (sets gagnés), sets, winner }. */
export function padelLive(m) {
  const status = String(m.status ?? '');
  const state = status === 'live' ? 'in' : OVER.includes(status) || VOID[status] ? 'post' : 'pre';
  const live = { state, clock: state === 'in' ? 'En cours' : state === 'post' ? (VOID[status] ?? (status === 'retired' ? 'Abandon' : 'Terminé')) : null };
  const sets = state === 'pre' ? null : setsOf(m.score);
  if (sets) {
    live.sets = sets;
    const won = (i) => (sets.team_1[i] > sets.team_2[i] ? 'team_1' : sets.team_2[i] > sets.team_1[i] ? 'team_2' : null);
    const finished = sets.team_1.map((_, i) => (state === 'post' || i < sets.team_1.length - 1 ? won(i) : null));
    live.scores = { team_1: finished.filter((w) => w === 'team_1').length, team_2: finished.filter((w) => w === 'team_2').length };
    if (state === 'in') live.clock = `${sets.team_1.length === 1 ? '1er' : `${sets.team_1.length}e`} set`;
  }
  if (state === 'post' && ['team_1', 'team_2'].includes(m.winner)) live.winner = m.winner;
  return live;
}

export default {
  id: 'padel',
  category: 'sport',
  emoji: '🏓',
  name: 'Padel',
  provider: { name: 'Padel API', url: 'https://padelapi.org/' },
  about: 'Les matchs des tableaux principaux de Premier Padel (Major, P1, P2, Finals), dès que l’horaire est connu (la veille) ; le vainqueur arrive tout seul.',
  needsKey: 'padel', // clé personnelle gratuite (padelapi.org) : PT_PADEL_TOKEN
  competitions: COMPETITIONS.map((c) => ({ ...c, fallbackMonth: 1 })),
  params: [],
  competitionOf: (ref) => ref.category ?? null,
  matchup: true, // deux paires : une paire remplacée (forfait, joueur changé) annule le pari (SourceService)
  offers: (ref) => ref.market === 'winner',

  async events({ competitions: selected = [] }, { fetchJson, now, keys }) {
    const comps = COMPETITIONS.filter((c) => selected.includes(c.id));
    if (!comps.length) return [];
    const auth = headers(keys);
    const today = dayKey(now);
    const tournaments = await fetchJson(`${API}/tournaments?level=${LEVELS}&after_date=${today}&before_date=${dayKey(now + DAYS_AHEAD * DAY)}&per_page=50`, { ttl: HOUR, headers: auth });
    const events = [];
    for (const t of (tournaments.data ?? []).filter((x) => !['cancelled', 'postponed', 'finished'].includes(x.status))) {
      for (const comp of comps) {
        const page = await fetchJson(`${API}/tournaments/${encodeURIComponent(t.id)}/matches?category=${comp.id}&per_page=50`, { ttl: 30 * MINUTE, headers: auth });
        for (const m of page.data ?? []) {
          const startsAt = matchTime(m);
          if (m.status !== 'scheduled' || (m.draw && m.draw !== 'main') || !(startsAt > now + 10 * MINUTE) || startsAt > now + DAYS_AHEAD * DAY) continue;
          const [a, b] = [pairName(m.players?.team_1), pairName(m.players?.team_2)];
          if (a === '?' || b === '?' || playersOf(m.players?.team_1).length < 2 || playersOf(m.players?.team_2).length < 2) continue;
          const name = clip(t.name, 40);
          const stage = ROUNDS[m.round] ?? clip(String(m.round_name ?? '').toLowerCase(), 30);
          const title = `${a} – ${b}`;
          const url = frenchPage(httpsUrl(m.url) ?? httpsUrl(t.url));
          events.push({
            id: String(m.id),
            title,
            subtitle: `${name}${stage ? ` · ${stage}` : ''} · ${frDateTime(startsAt)}`,
            startsAt,
            url,
            markets: [{
              id: 'winner', kind: 'multi', question: sportTitle('Padel', `${name}${stage ? `, ${stage}` : ''}`, title),
              options: [{ key: 'team_1', label: a }, { key: 'team_2', label: b }],
              closesAt: startsAt, expectedAt: startsAt + MATCH_LENGTH, details: DETAILS, competition: comp.id, season: fixedSeason(startsAt),
              media: versus(m),
              ref: {
                matchId: String(m.id), tournamentId: String(t.id), category: comp.id, market: 'winner',
                label: `${comp.label} · ${name} · ${title}`, url, closesMax: startsAt, key: `padel:${m.id}:winner`,
              },
            }],
          });
        }
      }
    }
    return events.sort((x, y) => x.startsAt - y.startsAt);
  },

  /** Sets en cours et score final : une seule requête pour tous les matchs suivis (au plus 50). */
  async live(refs, { fetchJson, keys }) {
    const ids = [...new Set(refs.map((r) => r.matchId))].slice(0, 50);
    const found = new Map();
    if (!ids.length) return found;
    const data = await fetchJson(`${API}/matches?id=${ids.join(',')}&per_page=50`, { ttl: 30_000, headers: headers(keys) });
    const byId = new Map((data.data ?? []).map((m) => [String(m.id), m]));
    for (const ref of refs) {
      const m = byId.get(ref.matchId);
      if (m) found.set(ref.key, { media: versus(m), live: padelLive(m) });
    }
    return found;
  },

  async result(ref, { fetchJson, keys }) {
    const body = await fetchJson(`${API}/matches/${encodeURIComponent(ref.matchId)}`, { headers: headers(keys) });
    const m = body.data ?? body;
    const status = String(m.status ?? '');
    if (VOID[status]) return { state: 'void', note: VOID[status], live: padelLive(m) };
    if (!OVER.includes(status)) return PENDING;
    const live = padelLive(m);
    // Le vainqueur, sinon déduit des sets (l'offre gratuite peut masquer le champ « winner »).
    const winner = ['team_1', 'team_2'].includes(m.winner) ? m.winner
      : live.scores && live.scores.team_1 !== live.scores.team_2 && status !== 'retired' ? (live.scores.team_1 > live.scores.team_2 ? 'team_1' : 'team_2') : null;
    if (!winner) return PENDING;
    const sets = live.sets ? ` (${live.sets.team_1.map((g, i) => `${g}-${live.sets.team_2[i]}`).join(' ')})` : '';
    return {
      state: 'final', key: winner, live: { ...live, winner },
      note: `Vainqueurs : ${pairName(m.players?.[winner])}${sets}${status === 'retired' ? ' (abandon des adversaires)' : ''}`,
    };
  },
};

/**
 * Le lien d'un pari : la page du match chez Fantasy Padel Tour (le site de Padel API), sinon celle du tournoi, que l'API
 * donne en espagnol (« fantasypadeltour.com/match/2775/… ») : la même page en français (« fr.fantasypadeltour.com »).
 */
export function frenchPage(url) {
  return url?.replace(/^https:\/\/(www\.)?fantasypadeltour\.com\//, 'https://fr.fantasypadeltour.com/') ?? null;
}

function headers(keys) {
  if (!keys?.padel) throw new SourceError('clé Padel API manquante');
  return { authorization: `Bearer ${keys.padel}` };
}
