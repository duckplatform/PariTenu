// Sports d'ESPN (API publique non documentée) : calendrier, saison officielle et résultat de chaque rencontre.
// teamSource() fabrique une source pour un sport collectif ; tennis.js et mma.js réutilisent les aides du bas.
import { decimalOdds } from '../core/scoring.js';
import { officialSeason } from '../core/seasons.js';
import { frDateTime } from '../lib/time.js';
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { SUMMARY_FACTS, summaryFacts, teamFacts, withSummary } from './facts.js';
import { clip, gather, httpsUrl, PENDING, SourceError, sportTitle } from './http.js';

export const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
export const ESPN_PROVIDER = { name: 'ESPN', url: 'https://www.espn.com/' };
const DAYS_AHEAD = 7;

// ESPN range les rencontres par jour (heure de la côte est américaine) : on balaie un jour de plus.
export const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replaceAll('-', '');
const fromYmd = (day) => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00Z`);
/** Le jour d'une rencontre et ses voisins (ESPN la range parfois la veille, heure américaine). */
export const daysAround = (day) => [day, ymd(fromYmd(day) - DAY), ymd(fromYmd(day) + DAY)];

const VOID = {
  POSTPONED: 'Match reporté', CANCELED: 'Match annulé', CANCELLED: 'Match annulé', ABANDONED: 'Match arrêté',
  FORFEIT: 'Match perdu par forfait', SUSPENDED: 'Match suspendu', WALKOVER: 'Forfait avant le match',
};
/** Raison d'annulation d'après le statut ESPN (STATUS_POSTPONED…), sinon null. */
export const voidNote = (type) => Object.entries(VOID).find(([word]) => (type?.name ?? '').includes(word))?.[1] ?? null;

/** Les tableaux des jours à venir pour chaque compétition choisie (une requête par compétition et par jour). */
export async function scoreboards(comps, days, { fetchJson, now }) {
  const tasks = comps.flatMap((comp) => Array.from({ length: days + 1 }, (_, i) => async () => ({
    comp, data: await fetchJson(`${ESPN}/${comp.path}/scoreboard?dates=${ymd(now + i * DAY)}`, { ttl: 30 * MINUTE }),
  })));
  const results = await gather(tasks);
  if (results.length && results.every((r) => !r.ok)) throw results[0].error;
  return results.filter((r) => r.ok).map((r) => r.value);
}

/** La saison officielle d'une rencontre, d'après le tableau du jour (dates incohérentes : saison à date fixe). */
export const seasonOf = (data, at, comp) => officialSeason(data.leagues?.[0]?.season, at, comp.fallbackMonth ?? 1);

// ——— Visuel et direct (src/services/live.js)

const LIVE_TTL = 30_000; // le tableau du jour, relu au plus toutes les 30 secondes pendant les matchs
// Le résumé d'un match en cours (passeurs, actions qui marquent, pénalités) : relu quand le score ou la chronologie
// bouge, sinon toutes les 5 minutes.
const SUMMARY_EVERY = 5 * MINUTE;

/** Une image d'ESPN à la bonne taille : leur service « combiner » la réduit (un logo fait 44 Ko en 500 px). */
export function espnImage(url, w = 96, h = w) {
  const href = httpsUrl(url);
  if (!href) return null;
  const { hostname, pathname } = new URL(href);
  return hostname === 'a.espncdn.com' && pathname.startsWith('/i/') ? `https://a.espncdn.com/combiner/i?img=${pathname}&w=${w}&h=${h}` : null;
}
const color = (hex) => (/^[0-9a-f]{6}$/i.test(hex ?? '') ? `#${hex.toLowerCase()}` : null);

/** Un athlète (tennis, MMA) : drapeau de son pays et photo d'ESPN (absente pour beaucoup : l'app affiche le drapeau). */
export const athleteMedia = (c, sport, name) => ({
  key: String(c.id), name,
  flag: espnImage(c.athlete?.flag?.href, 64, 64),
  img: /^\d+$/.test(String(c.id)) ? `https://a.espncdn.com/combiner/i?img=/i/headshots/${sport}/players/full/${c.id}.png&w=96&h=96` : null,
});

const nth = (n, feminine) => (n === 1 ? (feminine ? '1re' : '1er') : `${n}e`);
// Le chrono affiché pendant un match, selon le sport : minute (foot, rugby), quart-temps, période (hockey), manche.
const CLOCKS = {
  minute: (s) => s.displayClock || 'En cours',
  quarter: (s) => (s.period ? `${nth(s.period)} QT · ${s.displayClock ?? ''}`.trim() : 'En cours'),
  period: (s) => (s.period ? `${nth(s.period, true)} période · ${s.displayClock ?? ''}`.trim() : 'En cours'),
  inning: (s) => (s.period ? `${nth(s.period, true)} manche` : 'En cours'),
  set: (s) => (s.period ? `${nth(s.period)} set` : 'En cours'),
  round: (s) => (s.period ? `Round ${s.period}` : 'En cours'),
};

/** Le chrono en français : null avant le match, « 62' », « Mi-temps », « 3e QT · 5:32 », « Terminé (prol.) »… */
export function clockText(status, style = 'minute') {
  const type = status?.type ?? {};
  const name = type.name ?? '';
  if (type.state === 'pre' || !type.state) return null;
  if (type.state === 'post') {
    if (voidNote(type)) return voidNote(type);
    if (/RETIRED/.test(name)) return 'Abandon';
    // Hockey, basket, NFL : la prolongation n'est que dans le détail (« Final/OT », « Final/2OT », « Final/SO »).
    const detail = type.shortDetail ?? type.detail ?? '';
    if (/PEN|SHOOTOUT/.test(name) || /\/SO\b/.test(detail)) return 'Terminé (t.a.b.)';
    return /AET|_OT\b|OVERTIME/.test(name) || /\/\d*OT\b/.test(detail) ? 'Terminé (prol.)' : 'Terminé';
  }
  if (/HALFTIME/.test(name)) return 'Mi-temps';
  if (/SHOOTOUT/.test(name)) return 'Tirs au but';
  if (/END_PERIOD|END_OF_PERIOD|END_OF_REGULATION/.test(name)) return 'Pause';
  return (CLOCKS[style] ?? CLOCKS.minute)(status);
}

/**
 * État d'une rencontre à deux équipes : { state, clock, scores: { home, away }, winner } (score absent avant le coup
 * d'envoi), et ses faits selon le sport (facts : voir src/sources/facts.js).
 */
export function teamLive(competition, status, style, facts = null) {
  const type = status?.type ?? {};
  const state = ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre';
  const live = { state, clock: clockText(status, style) };
  const sides = [side(competition, 'home'), side(competition, 'away')];
  const scores = sides.map((c) => (c?.score == null || c.score === '' ? NaN : Number(c.score)));
  if (state !== 'pre' && scores.every(Number.isFinite)) live.scores = { home: scores[0], away: scores[1] };
  const winner = sides.find((c) => c?.winner);
  if (state === 'post' && winner) live.winner = winner.homeAway;
  return facts ? Object.assign(live, teamFacts(competition, facts, state)) : live;
}

/** Tennis et MMA : { state, clock, scores (sets gagnés), sets: { [id]: [jeux…] }, winner }. */
export function duelLive(fight, style) {
  const type = fight.status?.type ?? {};
  const state = ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre';
  const live = { state, clock: clockText(fight.status, style) };
  const players = fight.competitors ?? [];
  if (state !== 'pre' && players.some((c) => c.linescores?.length)) {
    live.sets = Object.fromEntries(players.map((c) => [String(c.id), (c.linescores ?? []).map((l) => Number(l.value)).filter(Number.isFinite)]));
    live.scores = Object.fromEntries(players.map((c) => [String(c.id), (c.linescores ?? []).filter((l) => l.winner).length]));
  }
  const winner = players.find((c) => c.winner);
  if (state === 'post' && winner) live.winner = String(winner.id);
  return live;
}

/**
 * Le direct de rencontres réparties dans des tableaux du jour : boards = [{ url, refs }], find(data, ref) rend
 * l'information de la rencontre ({ media, live }) ou null. Un tableau qui ne répond pas n'empêche pas les autres.
 */
export async function liveFromBoards(boards, find, { fetchJson }) {
  const found = new Map();
  for (const { url, refs } of boards) {
    const left = refs.filter((ref) => !found.has(ref.key));
    if (!left.length) continue;
    let data;
    try {
      data = await fetchJson(url, { ttl: LIVE_TTL });
    } catch {
      continue;
    }
    for (const ref of left) {
      const info = find(data, ref);
      if (info) found.set(ref.key, info);
    }
  }
  return found;
}

/** Les jours où chercher une rencontre chez ESPN (rangée par jour, heure de la côte est) : le jour américain puis le jour UTC. */
export const espnDays = (at) => [...new Set([ymd(at - 5 * HOUR), ymd(at)])];

// ——— Sports collectifs

function side(competition, homeAway) {
  return competition?.competitors?.find((c) => c.homeAway === homeAway);
}
const teamName = (c) => clip(c.team?.shortDisplayName || c.team?.displayName || '?', 24);

/** Les deux équipes d'un match : nom, abréviation, logo et couleur (clé : 'home' ou 'away', comme les options). */
const versus = (competition) => ({
  layout: 'versus',
  competitors: ['home', 'away'].map((key) => {
    const c = side(competition, key);
    return { key, name: teamName(c ?? {}), abbr: clip(c?.team?.abbreviation ?? '', 5), logo: espnImage(c?.team?.logo), color: color(c?.team?.color) };
  }),
});

/**
 * Un seul pari par match, sur le résultat, avec le match nul quand il existe (foot, rugby…). Son titre : le sport, la
 * compétition, la rencontre (« Football · Ligue 1 · Lille – Lens »). 1x2 : victoire, nul ou défaite ; winner : pas de nul
 * (NFL, NBA…).
 */
const resultMarket = (draw, { question, h, a }, odds) => ({
  id: draw ? '1x2' : 'winner',
  kind: 'multi',
  question,
  options: [{ key: 'home', label: `Victoire ${h}` }, ...(draw ? [{ key: 'draw', label: 'Match nul' }] : []), { key: 'away', label: `Victoire ${a}` }]
    .map((o) => ({ ...o, odds: odds?.[o.key] ?? null })),
});

/**
 * Cotes décimales des bookmakers (DraftKings, données par ESPN pour le foot, la NFL, la NBA, la NHL…) :
 * { home, draw, away }, ou null s'il en manque une (le pari passe alors au barème fixe).
 */
function bookmakerOdds(competition, draw) {
  const o = competition?.odds?.[0];
  const line = (side, legacy) => decimalOdds(o?.moneyline?.[side]?.close?.odds ?? o?.moneyline?.[side]?.open?.odds ?? legacy);
  const odds = {
    home: line('home', o?.homeTeamOdds?.moneyLine),
    away: line('away', o?.awayTeamOdds?.moneyLine),
    ...(draw ? { draw: line('draw', o?.drawOdds?.moneyLine) } : {}),
  };
  return Object.values(odds).every((x) => x > 1) ? odds : null;
}

/**
 * Réponse gagnante d'après le score final ; null : pari annulé (égalité sans match nul possible).
 * goals, btts et total : paris ouverts avant le 30 octobre 2026 (« au moins 3 buts », « les deux équipes marquent »,
 * total de points), gardés pour régler ceux qui ont des pronostics.
 */
function decide(ref, hs, as, winnerSide) {
  switch (ref.market) {
    case '1x2': return hs > as ? 'home' : hs < as ? 'away' : 'draw';
    case 'winner': return winnerSide ?? (hs > as ? 'home' : hs < as ? 'away' : null);
    case 'goals': return hs + as >= 3 ? 'yes' : 'no';
    case 'btts': return hs > 0 && as > 0 ? 'yes' : 'no';
    case 'total': return hs + as > ref.line ? 'yes' : hs + as < ref.line ? 'no' : null;
    default: throw new SourceError(`marché inconnu ${ref.market}`);
  }
}

/**
 * Source d'un sport collectif. competitions : [{ id, label, path ('soccer/fra.1'), fallbackMonth }] ;
 * draw : le match nul existe ; length : durée d'un match (le résultat est attendu après) ;
 * clock : comment se lit le chrono en direct (minute, quarter, period, inning) ; facts : quels faits de match lire
 * (soccer, rugby, nfl, basket, hockey, baseball, afl : voir src/sources/facts.js).
 */
export function teamSource({ id, emoji, name, about, competitions, draw, length, details, clock = 'minute', facts = null, maxEvents = 150 }) {
  const byId = new Map(competitions.map((c) => [c.id, c]));
  const market = draw ? '1x2' : 'winner';
  const summaryUrl = (ref) => `${ESPN}/${ref.path ?? `soccer/${ref.league}`}/summary?event=${encodeURIComponent(ref.eventId)}`;

  /**
   * Les faits du résumé d'un match commencé (summaryFacts), gardés dans memo (propre au serveur) : relus quand le score,
   * l'état ou la chronologie du tableau du jour change, sinon toutes les 5 minutes. Injoignable : on garde le dernier.
   */
  async function summaryOf(ref, live, { fetchJson, now, memo = new Map() }) {
    const key = `summary:${ref.key}`;
    const sig = JSON.stringify([live.state, live.scores, live.events?.length ?? 0]);
    const known = memo.get(key);
    if (known?.sig === sig && now - known.at < SUMMARY_EVERY) return known.extra;
    let extra = known?.extra ?? null;
    try {
      extra = summaryFacts(await fetchJson(summaryUrl(ref)), facts) ?? extra;
    } catch { /* le tableau du jour suffit */ }
    if (memo.size > 500) for (const [k, v] of memo) if (now - v.at > DAY) memo.delete(k);
    memo.set(key, { sig, at: now, extra });
    return extra;
  }

  function matchEvent(ev, comp, data, now) {
    const competition = ev.competitions?.[0];
    const home = side(competition, 'home');
    const away = side(competition, 'away');
    const startsAt = Date.parse(ev.date);
    if (!home || !away || ev.status?.type?.state !== 'pre' || !(startsAt > now + 10 * MINUTE)) return null;
    const h = teamName(home);
    const a = teamName(away);
    const title = `${h} – ${a}`;
    const url = httpsUrl(ev.links?.[0]?.href);
    const m = resultMarket(draw, { question: sportTitle(name, comp.label, title), h, a }, bookmakerOdds(competition, draw));
    return {
      id: String(ev.id),
      title,
      subtitle: `${comp.label} · ${frDateTime(startsAt)}`,
      startsAt,
      url,
      markets: [{
        ...m, closesAt: startsAt, expectedAt: startsAt + length, details, competition: comp.id, season: seasonOf(data, startsAt, comp),
        media: versus(competition),
        ref: {
          path: comp.path, league: comp.id, eventId: String(ev.id), home: h, away: a, label: `${comp.label} · ${title}`, url,
          closesMax: startsAt, market: m.id, key: `${id}:${ev.id}:${m.id}`,
        },
      }],
    };
  }

  return {
    id,
    category: 'sport',
    emoji,
    name,
    provider: ESPN_PROVIDER,
    about,
    competitions: competitions.map((c) => ({ id: c.id, label: c.label, ...(c.emoji ? { emoji: c.emoji } : {}), fallbackMonth: c.fallbackMonth ?? 1 })),
    params: [],
    /** Compétition d'un pari déjà lancé (paris d'avant les classements par compétition). */
    competitionOf: (ref) => (byId.has(ref.league) ? ref.league : null),
    /** Ce pari est-il encore proposé ? (sinon, tant que personne n'y a parié, il est retiré) */
    offers: (ref) => ref.market === market,
    /** Faits de match lus dans le direct (src/sources/facts.js) : un match fini avant qu'on les lise est relu une fois. */
    facts,

    async events({ competitions: selected = [] }, io) {
      const comps = competitions.filter((c) => selected.includes(c.id));
      if (!comps.length) return [];
      const seen = new Set();
      const events = [];
      for (const { comp, data } of await scoreboards(comps, DAYS_AHEAD, io)) {
        for (const ev of data.events ?? []) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          const event = matchEvent(ev, comp, data, io.now);
          if (event) events.push(event);
        }
      }
      return events.sort((x, y) => x.startsAt - y.startsAt).slice(0, maxEvents);
    },

    /**
     * Score en direct et logos des matchs commencés : Map(ref.key → { media, live }). Foot, football américain et
     * hockey : le résumé de chaque match commencé complète ses faits (summaryOf).
     */
    async live(refs, io) {
      const boards = new Map();
      for (const ref of refs) {
        for (const day of espnDays(ref.closesMax)) {
          const url = `${ESPN}/${ref.path ?? `soccer/${ref.league}`}/scoreboard?dates=${day}`;
          boards.set(url, [...(boards.get(url) ?? []), ref]);
        }
      }
      const found = await liveFromBoards([...boards].map(([url, list]) => ({ url, refs: list })), (data, ref) => {
        const ev = (data.events ?? []).find((e) => String(e.id) === ref.eventId);
        const competition = ev?.competitions?.[0];
        return competition ? { media: versus(competition), live: teamLive(competition, competition.status ?? ev.status, clock, facts) } : null;
      }, io);
      if (SUMMARY_FACTS.has(facts)) {
        const started = refs.filter((ref) => found.has(ref.key) && found.get(ref.key).live.state !== 'pre');
        await gather(started.map((ref) => async () => {
          const info = found.get(ref.key);
          info.live = withSummary(info.live, await summaryOf(ref, info.live, io));
        }));
      }
      return found;
    },

    async result(ref, { fetchJson }) {
      const data = await fetchJson(summaryUrl(ref));
      const competition = data.header?.competitions?.[0];
      if (!competition) return PENDING;
      const type = competition.status?.type ?? {};
      const voided = voidNote(type);
      if (voided) return { state: 'void', note: voided };
      if (type.state !== 'post' || !type.completed) return PENDING;
      const hc = side(competition, 'home');
      const ac = side(competition, 'away');
      const hs = Number(hc?.score);
      const as = Number(ac?.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) throw new SourceError('score illisible');
      const note = `Score final : ${ref.home} ${hs} – ${as} ${ref.away}`;
      const winnerSide = hc?.winner ? 'home' : ac?.winner ? 'away' : null;
      const key = decide(ref, hs, as, winnerSide);
      const live = withSummary(teamLive(competition, competition.status, clock, facts), summaryFacts(data, facts));
      if (key == null) return { state: 'void', note: ref.market === 'total' ? `${note} : pile sur la ligne` : `${note} : égalité`, live };
      return { state: 'final', key, note, live };
    },
  };
}
