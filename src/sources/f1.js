// 🏎️ Formule 1 : prochain Grand Prix, classement des pilotes et résultats, par l'API Jolpica (ex-Ergast).
import { fixedSeason, scheduleSeason } from '../core/seasons.js';
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { frDateTime } from '../lib/time.js';
import { clip, gather, httpsUrl, PENDING, sportTitle } from './http.js';

const BASE = 'https://api.jolpi.ca/ergast/f1';
const RACE_LENGTH = 3 * HOUR;
const FAVOURITES = 7; // + « Un autre pilote » : 8 options au plus
const DETAILS = 'Résultat : vainqueur officiel de la course (classement Jolpica / FIA). Course annulée : pari annulé dès qu’elle sort du calendrier officiel ; course repoussée : le pari suit sa nouvelle date.';

const fullName = (d) => clip(`${d.givenName} ${d.familyName}`, 40);
const page = (url) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
/**
 * Le Grand Prix du pari ? Reconnu à sa page Wikipédia donnée par Jolpica (ref.page ; ref.url pour un pari ouvert avant
 * le 2026-11-03), la même s'il est repoussé, sinon à son jour (UTC).
 */
const sameRace = (race, ref) => {
  const known = ref.page ?? ref.url;
  return !!race && ((known && race.url && page(race.url) === page(known)) || race.date === dayOf(ref.closesMax));
};

// Le lien d'un pari : la page du Grand Prix chez ESPN (demande du 2026-11-03 : « on renvoie vers des pages de la
// compétition », pas vers Wikipédia), trouvée dans le calendrier de la saison par le jour de la course.
const ESPN_F1 = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';
const ESPN_SCHEDULE = 'https://www.espn.com/f1/schedule';
async function espnRaceUrl(day, fetchJson) {
  const calendar = (await fetchJson(ESPN_F1, { ttl: DAY })).leagues?.[0]?.calendar ?? [];
  const entry = calendar.find((c) => day >= String(c.startDate).slice(0, 10) && day <= String(c.endDate).slice(0, 10));
  const id = /\/events\/(\d+)/.exec(entry?.event?.$ref ?? '')?.[1];
  return id ? `https://www.espn.com/f1/race/_/id/${id}` : null;
}
const OPENF1 = 'https://api.openf1.org/v1/drivers?session_key=latest';

/** Les pilotes du pari, pour l'affichage : photo et couleur d'écurie d'OpenF1 (gratuit, sans clé), par leur code (VER…). */
function field(top, openf1) {
  const byCode = new Map((Array.isArray(openf1) ? openf1 : []).map((d) => [d.name_acronym, d]));
  return {
    layout: 'field',
    competitors: top.map((d) => {
      const o = byCode.get(d.code);
      return {
        key: d.driverId, name: fullName(d), abbr: d.code ?? '', number: Number(d.permanentNumber) || null,
        img: httpsUrl(o?.headshot_url), color: /^[0-9a-f]{6}$/i.test(o?.team_colour ?? '') ? `#${o.team_colour.toLowerCase()}` : null,
        team: clip(o?.team_name ?? '', 40),
      };
    }),
  };
}

export default {
  id: 'f1',
  category: 'sport',
  emoji: '🏎️',
  name: 'Formule 1',
  provider: { name: 'Jolpica F1', url: 'https://jolpi.ca/' },
  about: 'Le prochain Grand Prix ; le vainqueur arrive tout seul après la course.',
  competitions: [{ id: 'f1', label: 'Formule 1', fallbackMonth: 1 }],
  params: [],
  competitionOf: () => 'f1',
  /** Ce pari est-il encore proposé ? (sinon, tant que personne n'y a parié, il est retiré) */
  offers: (ref) => ref.market === 'winner',

  async events({ competitions = [] }, { fetchJson, now }) {
    if (!competitions.includes('f1')) return [];
    const [next, standings, schedule, [openf1]] = await Promise.all([
      fetchJson(`${BASE}/current/next.json`, { ttl: HOUR }),
      fetchJson(`${BASE}/current/driverstandings.json`, { ttl: HOUR }),
      fetchJson(`${BASE}/current.json`, { ttl: DAY }),
      gather([() => fetchJson(OPENF1, { ttl: DAY })]), // facultatif : les paris s'ouvrent sans photos
    ]);
    const race = next.MRData?.RaceTable?.Races?.[0];
    const drivers = standings.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
    if (!race || drivers.length < 2) return [];
    const startsAt = Date.parse(`${race.date}T${race.time ?? '12:00:00Z'}`);
    if (!(startsAt > now + 10 * MINUTE)) return [];
    const raceName = clip(race.raceName, 60);
    // La saison : du premier au dernier Grand Prix du calendrier.
    const races = (schedule.MRData?.RaceTable?.Races ?? []).map((r) => Date.parse(`${r.date}T12:00:00Z`)).filter(Number.isFinite);
    const season = races.length ? scheduleSeason(race.season, Math.min(...races), Math.max(...races)) : fixedSeason(startsAt);
    const top = drivers.slice(0, FAVOURITES).map((d) => d.Driver);
    const leader = top[0];
    // ESPN injoignable : le calendrier F1 d'ESPN (relink le remplacera par la page de la course plus tard).
    const [espn] = await gather([() => espnRaceUrl(race.date, fetchJson)]);
    const ref = {
      season: race.season, round: race.round, label: `F1 · ${raceName}`, url: (espn.ok && espn.value) || ESPN_SCHEDULE,
      page: httpsUrl(race.url), closesMax: startsAt, drivers: top.map((d) => d.driverId), leader: leader.driverId,
    };
    // Un seul pari, sur le résultat de la course. Son titre : le sport, puis le lieu et le circuit (« Formule 1 · Mexico
    // City · Autódromo Hermanos Rodríguez »), sans phrase autour (demandes du 2026-11-01 et du 2026-11-03).
    const place = sportTitle('Formule 1', clip([race.Circuit?.Location?.locality, race.Circuit?.circuitName].filter(Boolean).join(' · '), 100) || raceName);
    const list = [
      { id: 'winner', kind: 'multi', question: place, options: [...top.map((d) => ({ key: d.driverId, label: fullName(d) })), { key: 'other', label: 'Un autre pilote' }] },
    ];
    return [{
      id: `${race.season}-${race.round}`,
      title: raceName,
      subtitle: `${race.Circuit?.Location?.locality ?? 'Formule 1'} · ${frDateTime(startsAt)}`,
      startsAt,
      url: ref.url,
      markets: list.map((m) => ({
        ...m, closesAt: startsAt, expectedAt: startsAt + RACE_LENGTH, details: DETAILS, competition: 'f1', season,
        media: field(top, openf1.ok ? openf1.value : null),
        ref: { ...ref, market: m.id, key: `f1:${race.season}:${race.round}:${m.id}` },
      })),
    }];
  },

  /**
   * Le lien d'un pari déjà ouvert, s'il doit changer : page Wikipédia (paris d'avant le 2026-11-03) ou calendrier F1
   * d'ESPN (ESPN injoignable à l'ouverture) → page du Grand Prix chez ESPN. Rend la nouvelle référence, ou null.
   */
  async relink(ref, { fetchJson }) {
    if (ref.page && ref.url !== ESPN_SCHEDULE) return null;
    const url = await espnRaceUrl(dayOf(ref.closesMax), fetchJson);
    return url ? { ...ref, page: ref.page ?? ref.url, url } : null;
  },

  async result(ref, { fetchJson }) {
    const resultsOf = async (round) => (await fetchJson(`${BASE}/${encodeURIComponent(ref.season)}/${encodeURIComponent(round)}/results.json`)).MRData?.RaceTable?.Races?.[0];
    let race = await resultsOf(ref.round);
    if (!sameRace(race, ref)) {
      // Pas encore de résultat, ou un autre Grand Prix sous ce numéro (une course annulée décale les suivantes) : on
      // retrouve la nôtre dans le calendrier officiel. Absente : annulée. Repoussée : on suit son nouveau numéro.
      const schedule = await fetchJson(`${BASE}/${encodeURIComponent(ref.season)}.json`, { ttl: HOUR });
      const races = schedule.MRData?.RaceTable?.Races ?? [];
      if (!races.length) return PENDING;
      const ours = races.find((r) => sameRace(r, ref));
      if (!ours) return { state: 'void', note: 'Course annulée (retirée du calendrier officiel)' };
      if (String(ours.round) === String(ref.round)) return PENDING;
      race = await resultsOf(ours.round);
      if (!sameRace(race, ref)) return PENDING;
    }
    const results = race.Results ?? [];
    const winner = results.find((r) => r.position === '1')?.Driver;
    if (!winner) return PENDING;
    const note = `Vainqueur : ${fullName(winner)}`;
    // « Le leader gagne ? » : pari ouvert avant le 30 octobre 2026, gardé pour régler ceux qui ont des pronostics.
    if (ref.market === 'leader') return { state: 'final', key: winner.driverId === ref.leader ? 'yes' : 'no', note };
    const podium = results.filter((r) => ['1', '2', '3'].includes(r.position)).sort((a, b) => a.position - b.position)
      .map((r) => ({ key: r.Driver.driverId, name: fullName(r.Driver), number: Number(r.number) || null }));
    const live = { state: 'post', clock: 'Arrivée', podium, ...raceFacts(results) };
    return { state: 'final', key: ref.drivers.includes(winner.driverId) ? winner.driverId : 'other', note, live };
  },
};

// Raison d'un abandon (statut Jolpica) ; les autres statuts techniques (moteur, freins…) : « Abandon ».
const OUT = { Accident: 'Accident', Collision: 'Accrochage', 'Collision damage': 'Accrochage', Disqualified: 'Disqualifié', 'Did not start': 'Non partant', Withdrew: 'Forfait' };

/**
 * Le classement complet (fiche du pari) : place, pilote, écurie, écart (temps du vainqueur, « +5.123 », « +1 tour »),
 * place sur la grille (0 : départ des stands), abandons ; et le meilleur tour en course.
 */
function raceFacts(results) {
  const laps = Number(results.find((r) => r.position === '1')?.laps) || 0;
  const ranking = results.map((r) => {
    const finished = r.status === 'Finished' || r.status === 'Lapped' || /^\+\d+ Laps?$/.test(r.status ?? '');
    const behind = laps - (Number(r.laps) || 0);
    return {
      pos: /^\d+$/.test(r.positionText ?? r.position ?? '') ? Number(r.positionText ?? r.position) : null,
      name: fullName(r.Driver), team: clip(r.Constructor?.name ?? '', 30) || null,
      // Un pilote doublé : son écart en tours (Jolpica lui donne un temps trompeur, pris sur son dernier tour).
      gap: !finished ? null : behind > 0 ? `+${behind} tour${behind > 1 ? 's' : ''}` : r.Time?.time ?? null,
      grid: Number.isFinite(Number(r.grid)) ? Number(r.grid) : null,
      out: finished ? null : OUT[r.status] ?? 'Abandon',
    };
  });
  const best = results.find((r) => r.FastestLap?.rank === '1');
  const fastest = best ? { name: fullName(best.Driver), time: best.FastestLap.Time?.time ?? '', lap: Number(best.FastestLap.lap) || null } : null;
  return { ranking, ...(fastest ? { fastest } : {}) };
}
