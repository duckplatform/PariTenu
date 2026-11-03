// Faux fournisseurs de données pour les tests : les réponses ont la forme des vraies API (voir test/fixtures/sources),
// les dates sont calculées depuis l'horloge de test et les résultats sont pilotés par le test. Aucun appel réseau.
import { readFileSync } from 'node:fs';
import { addDays, dayKey } from '../src/lib/time.js';
import { encodePng } from '../src/lib/png.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8'));
const STANDINGS = fixture('jolpica-standings.json');
const PLACES = fixture('open-meteo-geocoding-lyon.json');
const MOTO_SEASONS = fixture('motogp-seasons.json');
const MOTO_CATEGORIES = fixture('motogp-categories.json');
const MOTO_CATEGORY = Object.fromEntries(MOTO_CATEGORIES.map((c) => [c.name.replace(/\W/g, '').toLowerCase(), c.id]));
const MOTO_STANDINGS = { [MOTO_CATEGORY.motogp]: fixture('motogp-standings-motogp.json'), [MOTO_CATEGORY.moto3]: fixture('motogp-standings-moto3.json') };
const MOTO_RIDERS = Object.values(MOTO_STANDINGS).flatMap((s) => s.classification.map((c) => c.rider));
// Les vrais classements relient chaque pilote à sa fiche (photo, équipe) par riders_api_uuid : absent des captures.
for (const r of MOTO_RIDERS) r.riders_api_uuid ??= `fiche-${r.id}`;
const MOTO_TEAMS = ['#ad0000', '#5f259f', '#ff6600', '#0b3d91', '#1e1e1e', '#00a19c', '#c9a227'];

// ——— Images : de petits PNG dessinés à la volée (écusson rond, drapeau à trois bandes, pilote en pied)
const COLORS = {
  lille: 'e01e13', lens: 'ffcc00', psg: '004170', marseille: '2faee0', bills: '00338d', ravens: '241773',
  toulouse: 'c8102e', toulon: '1d3f8f', lakers: '552583', celtics: '007a33', lyon: '1b3f94', nice: 'c8102e',
};
const FLAGS = { ita: ['009246', 'ffffff', 'ce2b37'], esp: ['aa151b', 'f1bf00', 'aa151b'], bra: ['009c3b', 'ffdf00', '009c3b'], usa: ['b22234', 'ffffff', '3c3b6e'] };
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
function png(w, h, paint) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x / w, y / h);
      if (c) data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return encodePng({ width: w, height: h, data });
}
const images = new Map();
const image = (key, make) => images.get(key) ?? images.set(key, make()).get(key);
const crestPng = (hex) => png(96, 96, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5);
  return r < 0.46 ? (r > 0.37 ? [255, 255, 255] : rgb(hex)) : null;
});
const flagPng = ([a, b, c]) => png(64, 64, (x, y) => (y < 0.2 || y > 0.8 ? null : rgb(x < 1 / 3 ? a : x < 2 / 3 ? b : c)));
// 600 × 900 : assez grand pour passer par la réduction et le recadrage sur le visage (comme les vraies photos MotoGP).
const riderPng = (hex) => png(600, 900, (x, y) => {
  if (Math.hypot(x - 0.5, (y - 0.14) * 1.5) < 0.09) return [233, 190, 160]; // visage
  if (Math.hypot(x - 0.5, (y - 0.1) * 1.5) < 0.11 && y < 0.11) return rgb(hex); // casquette
  return y > 0.26 && Math.abs(x - 0.5) < 0.3 - (y - 0.26) * 0.05 ? rgb(hex) : null; // combinaison
});

const MEXICO_GP = 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix';
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replaceAll('-', '');
const espnDate = (ts) => new Date(ts).toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z'); // « 2026-10-31T20:00Z »
const nextHour = (ts) => Math.ceil(ts / HOUR) * HOUR;

/** Clé de Padel API attendue par le faux service (celle de test/helpers.js). */
export const PADEL_TOKEN = 'jeton-padel-de-test';
// Heure locale du serveur de Padel API (Europe/Madrid, comme Paris) : « 2026-11-01 18:00:00 ».
const madrid = (ts) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }).format(ts);
const padelPlayer = (id, name) => ({ id, name, short_name: name.split(' ').at(-1), nationality: 'ES', side: null });

/** Saison officielle des faux tableaux ESPN : l'année civile de l'instant (comme l'UFC ou la MLS). */
const espnSeason = (t) => {
  const y = new Date(t).getUTCFullYear();
  return { year: y, startDate: `${y}-01-01T05:00Z`, endDate: `${y + 1}-01-01T04:59Z` };
};

/** Le calendrier des faux événements, à partir d'un instant : Lille – Lens demain, PSG – Marseille après-demain… */
const schedule = (t) => ({
  // path : sport et compétition ESPN ; ml : cotes des bookmakers (américaines, comme DraftKings chez ESPN) ; sans ml : barème fixe.
  matches: [
    { id: '9001', path: 'soccer/fra.1', at: nextHour(t + DAY), home: 'Lille', away: 'Lens', ml: { home: '+150', draw: '+230', away: '+180' } },
    { id: '9002', path: 'soccer/fra.1', at: nextHour(t + 2 * DAY), home: 'PSG', away: 'Marseille' },
    { id: '9101', path: 'football/nfl', at: nextHour(t + DAY), home: 'Bills', away: 'Ravens', ml: { home: '-175', away: '+145' } },
    { id: '9201', path: 'rugby/270559', at: nextHour(t + 2 * DAY), home: 'Toulouse', away: 'Toulon' },
    { id: '9301', path: 'basketball/nba', at: nextHour(t + DAY), home: 'Lakers', away: 'Celtics' },
  ],
  tennis: { id: '7001', at: nextHour(t + DAY), round: 'Quarterfinal', players: [['5001', 'Jannik Sinner', 'ita'], ['5002', 'Carlos Alcaraz', 'esp']] },
  fight: { id: '8001', at: nextHour(t + 2 * DAY), fighters: [['6001', 'Renato Moicano'], ['6002', 'Tom Nolan']] },
  winners: {}, // match de tennis ou combat → id du vainqueur, ou 'CANCELLED'
  scores: {}, // id → [domicile, extérieur]
  live: {}, // id → { score: [domicile, extérieur], clock: "62'", period, name } : match en cours
  matchFacts: {}, // id → { details, statistics: { home, away } } : faits du match (tableau du jour seulement, comme ESPN)
  voided: {}, // id → statut ESPN (STATUS_POSTPONED…)
  race: { season: '2026', round: '19', at: nextHour(t + 3 * DAY) },
  f1Winner: null, // driverId
  gp: { sprint: nextHour(t + 3 * DAY), race: nextHour(t + 4 * DAY) }, // Grand Prix moto (MotoGP ; Moto2 et Moto3 courent avant)
  motoResults: {}, // 'RAC' | 'SPR' → id des pilotes dans l'ordre d'arrivée, ou 'CANCELLED'
  weather: {}, // « AAAA-MM-JJ » → { tmax, rain } relevés
  candles: {}, // instant du relevé (ms) → cours de clôture
  padel: {
    tournament: { id: 302, name: 'Kuwait Major', level: 'major', status: 'live', url: 'https://fantasypadeltour.com/games/103/kuwait-major-2026' },
    matches: [
      { id: 90001, category: 'men', round: 2, at: nextHour(t + DAY), team_1: ['Arturo Coello', 'Agustín Tapia'], team_2: ['Alejandro Galán', 'Federico Chingotto'] },
      { id: 90002, category: 'women', round: 1, at: nextHour(t + DAY) + 3 * HOUR, team_1: ['Ariana Sánchez', 'Paula Josemaría'], team_2: ['Gemma Triay', 'Delfina Brea'] },
    ],
    state: {}, // id → { status, score, winner }
  },
  manifold: { id: 'mf1', question: 'Will it snow in Paris before Christmas?', url: 'https://manifold.markets/test/will-it-snow-in-paris', probability: 0.3, closeTime: nextHour(t + 10 * DAY) },
  resolution: null, // 'YES' | 'NO' | 'CANCEL'
});

export function fakeUpstream(clock) {
  const state = {
    down: false,
    calls: [],
    prices: { BTC: '69265.78', ETH: '1988.01' },
    ...schedule(clock.now()),
  };

  const competitor = (m, homeAway) => {
    const done = state.scores[m.id];
    const now = state.live[m.id]?.score;
    const isHome = homeAway === 'home';
    const name = isHome ? m.home : m.away;
    const slug = name.toLowerCase();
    return {
      homeAway,
      score: done ? String(done[isHome ? 0 : 1]) : now ? String(now[isHome ? 0 : 1]) : '0',
      winner: done ? done[isHome ? 0 : 1] > done[isHome ? 1 : 0] : false,
      ...(state.matchFacts[m.id] ? { statistics: state.matchFacts[m.id].statistics[homeAway] } : {}),
      team: {
        id: `${m.id}-${homeAway}`, displayName: name, shortDisplayName: name, abbreviation: name.slice(0, 3).toUpperCase(),
        logo: `https://a.espncdn.com/i/teamlogos/${m.path.split('/')[0]}/500/${slug}.png`, color: COLORS[slug] ?? '333333',
      },
    };
  };
  const status = (m) => {
    if (state.voided[m.id]) return { type: { name: state.voided[m.id], state: 'post', completed: false, detail: 'Postponed' } };
    if (state.scores[m.id]) return { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true, detail: 'FT' } };
    const live = state.live[m.id];
    if (live) return { displayClock: live.clock, period: live.period ?? 2, type: { name: live.name ?? 'STATUS_SECOND_HALF', state: 'in', completed: false, detail: live.clock } };
    return { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, detail: 'Scheduled' } };
  };
  const link = (m) => ({ href: `https://www.espn.com/${m.path.split('/')[0]}/match/_/gameId/${m.id}` });
  const leagues = (path) => [{ name: path, season: espnSeason(clock.now()) }];

  // Tennis et MMA : un tableau par tournoi (ou soirée), des matchs (ou combats) entre deux athlètes.
  const duel = (x, extra = {}) => {
    const done = state.winners[x.id];
    const type = done === 'CANCELLED' ? { name: 'STATUS_CANCELED', state: 'post', completed: false }
      : done ? { name: 'STATUS_FINAL', state: 'post', completed: true } : { name: 'STATUS_SCHEDULED', state: 'pre', completed: false };
    return {
      id: x.id, date: espnDate(x.at), ...extra, status: { type },
      competitors: (x.players ?? x.fighters).map(([id, name, country = 'bra'], i) => ({
        id, order: i + 1, winner: done === id,
        athlete: { displayName: name, flag: { href: `https://a.espncdn.com/i/teamlogos/countries/500/${country}.png` } },
      })),
    };
  };

  // Grand Prix moto : l'API de résultats donne les jours, le calendrier les heures (avec fuseau), puis les classements.
  const isoDay = (ts) => new Date(ts).toISOString().slice(0, 10);
  const motoStatus = (type) => {
    const done = state.motoResults[type];
    return done === 'CANCELLED' ? 'CANCELLED' : done ? 'FINISHED' : 'NOT-STARTED';
  };
  const gpEvent = () => ({
    id: 'gp-mal', name: 'GRAND PRIX OF MALAYSIA', short_name: 'MAL', test: false, status: 'NOT-STARTED', toad_api_uuid: 'cal-mal',
    date_start: isoDay(state.gp.sprint - DAY), date_end: isoDay(state.gp.race),
    country: { iso: 'MY', name: 'Malaysia' }, circuit: { name: 'Petronas Sepang International Circuit', place: 'Sepang' },
  });
  const broadcast = (shortname, kind, at, name) => ({
    shortname, kind, type: 'SESSION', status: kind === 'RACE' ? motoStatus(shortname) : 'NOT-STARTED',
    date_start: new Date(at).toISOString(), category: { acronym: name.toUpperCase(), name },
  });

  // Fiches des pilotes MotoGP (photo, couleur et nom de l'équipe) et pilotes F1 d'OpenF1.
  const motoProfiles = () => MOTO_RIDERS.map((r, i) => ({
    id: r.riders_api_uuid, name: r.full_name.split(' ')[0], surname: r.full_name.split(' ').slice(1).join(' '),
    current_career_step: {
      number: r.number, sponsored_team: `Équipe ${i % MOTO_TEAMS.length + 1}`, team: { color: MOTO_TEAMS[i % MOTO_TEAMS.length] },
      pictures: { profile: { main: `https://photos.motogp.com/riders/${r.id}/2026/profile/main.png` } },
    },
  }));
  const openF1 = () => STANDINGS.MRData.StandingsTable.StandingsLists[0].DriverStandings.map(({ Driver: d }, i) => ({
    driver_number: Number(d.permanentNumber), name_acronym: d.code, full_name: `${d.givenName} ${d.familyName}`.toUpperCase(),
    team_colour: MOTO_TEAMS[i % MOTO_TEAMS.length].slice(1), team_name: `Écurie ${i % 5 + 1}`,
    headshot_url: `https://media.formula1.com/content/dam/fom-website/drivers/${d.code}/headshot.png`,
  }));

  /** Les images des sources : écussons et drapeaux d'ESPN, photos des pilotes ; les photos d'athlètes d'ESPN manquent. */
  function imageFor(url) {
    if (url.hostname === 'a.espncdn.com' && url.pathname === '/combiner/i') {
      const img = url.searchParams.get('img') ?? '';
      const flag = /countries\/500\/(\w+)\.png$/.exec(img);
      if (flag) return FLAGS[flag[1]] ? image(img, () => flagPng(FLAGS[flag[1]])) : null;
      const team = /teamlogos\/\w+\/500\/([\w-]+)\.png$/.exec(img);
      return team ? image(img, () => crestPng(COLORS[team[1]] ?? '333333')) : null;
    }
    if (url.hostname === 'photos.motogp.com') {
      const i = MOTO_RIDERS.findIndex((r) => url.pathname.includes(r.id));
      return i >= 0 ? image(url.pathname, () => riderPng(MOTO_TEAMS[i % MOTO_TEAMS.length])) : null;
    }
    if (url.hostname === 'media.formula1.com') return image(url.pathname, () => crestPng('e10600'));
    return undefined;
  }

  // Padel API : clé obligatoire (en-tête Authorization), matchs au format de la documentation.
  const padelMatch = (m) => {
    const now = state.padel.state[m.id] ?? {};
    return {
      id: m.id, name: `${m.team_1.join(' / ')} vs ${m.team_2.join(' / ')}`, category: m.category, draw: 'main', round: m.round,
      round_name: { 1: 'Finals', 2: 'Semifinals' }[m.round], scheduled_at: madrid(m.at), status: now.status ?? 'scheduled',
      score: now.score ?? null, winner: now.winner ?? null, url: `https://fantasypadeltour.com/match/${m.id}/match-de-test`,
      players: { team_1: m.team_1.map((n, i) => padelPlayer(m.id * 10 + i, n)), team_2: m.team_2.map((n, i) => padelPlayer(m.id * 10 + 5 + i, n)) },
    };
  };

  const routes = [
    [/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/tennis\/atp\/scoreboard$/, () => ({
      leagues: leagues('tennis/atp'),
      events: [{
        id: '10-2026', name: 'Rolex Paris Masters', links: [{ href: 'https://www.espn.com/tennis/scoreboard/tournament/_/eventId/10-2026' }],
        groupings: [{ grouping: { slug: 'mens-singles' }, competitions: [duel(state.tennis, { timeValid: true, round: { displayName: state.tennis.round } })] }],
      }],
    })],
    [/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/mma\/ufc\/scoreboard$/, (u) => ({
      leagues: leagues('mma/ufc'),
      events: u.searchParams.get('dates') === ymd(state.fight.at) ? [{
        id: '600001', name: 'UFC Fight Night: Moicano vs. Nolan', date: espnDate(state.fight.at),
        links: [{ href: 'https://www.espn.com/mma/fightcenter/_/id/600001/league/ufc' }], competitions: [duel(state.fight)],
      }] : [],
    })],
    // Le calendrier F1 d'ESPN : la page de chaque Grand Prix (le lien des paris de F1).
    [/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/racing\/f1\/scoreboard$/, () => {
      const day = new Date(state.race.at).toISOString().slice(0, 10);
      return { leagues: [{ calendar: [{ label: 'Mexico City Grand Prix', startDate: `${day}T00:00Z`, endDate: `${day}T23:00Z`, event: { $ref: 'http://sports.core.api.espn.pvt/v2/sports/racing/leagues/f1/events/600057447?lang=en&region=us' } }] }] };
    }],
    [/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([\w-]+\/[\w.-]+)\/scoreboard$/, (u, [, path]) => ({
      leagues: leagues(path),
      events: state.matches.filter((m) => m.path === path && ymd(m.at) === u.searchParams.get('dates')).map((m) => ({
        id: m.id, date: espnDate(m.at), name: `${m.away} at ${m.home}`, shortName: `${m.away} @ ${m.home}`, status: status(m),
        competitions: [{ competitors: [competitor(m, 'home'), competitor(m, 'away')], ...(state.matchFacts[m.id] ? { details: state.matchFacts[m.id].details } : {}), ...(m.ml ? { odds: [{ moneyline: Object.fromEntries(Object.entries(m.ml).map(([side, odds]) => [side, { close: { odds } }])) }] } : {}) }],
        links: [link(m)],
      })),
    })],
    [/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[\w-]+\/[\w.-]+\/summary$/, (u) => {
      const m = state.matches.find((x) => x.id === u.searchParams.get('event'));
      if (!m) return [404, { code: 404 }];
      const header = { id: m.id, links: [link(m)], competitions: [{ date: espnDate(m.at), status: status(m), competitors: [competitor(m, 'home'), competitor(m, 'away')] }] };
      return { header, ...(state.matchFacts[m.id] ? { keyEvents: state.matchFacts[m.id].keyEvents } : {}) };
    }],
    [/^https:\/\/api\.jolpi\.ca\/ergast\/f1\/current\/next\.json$/, () => {
      const { season, round, at } = state.race;
      const iso = new Date(at).toISOString();
      return { MRData: { RaceTable: { season, round, Races: [{
        season, round, raceName: 'Mexico City Grand Prix', url: MEXICO_GP,
        Circuit: { circuitName: 'Autódromo Hermanos Rodríguez', Location: { locality: 'Mexico City', country: 'Mexico' } }, date: iso.slice(0, 10), time: `${iso.slice(11, 19)}Z`,
      }] } } };
    }],
    [/^https:\/\/api\.jolpi\.ca\/ergast\/f1\/current\/driverstandings\.json$/, () => STANDINGS],
    [/^https:\/\/api\.jolpi\.ca\/ergast\/f1\/current\.json$/, () => {
      const day = (ts) => new Date(ts).toISOString().slice(0, 10);
      const at = state.race.at;
      return { MRData: { RaceTable: { season: state.race.season, Races: [{ date: day(at - 200 * DAY) }, { date: day(at) }, { date: day(at + 35 * DAY) }] } } };
    }],
    [/^https:\/\/api\.jolpi\.ca\/ergast\/f1\/(\d+)\/(\d+)\/results\.json$/, () => {
      const driver = STANDINGS.MRData.StandingsTable.StandingsLists[0].DriverStandings.map((d) => d.Driver).find((d) => d.driverId === state.f1Winner)
        ?? (state.f1Winner ? { driverId: state.f1Winner, givenName: 'Pilote', familyName: 'Surprise' } : null);
      const { season, round, at } = state.race;
      return { MRData: { RaceTable: { Races: driver ? [{ season, round, url: MEXICO_GP, date: new Date(at).toISOString().slice(0, 10), Results: [{ position: '1', status: 'Finished', Driver: driver }] }] : [] } } };
    }],
    // Le calendrier officiel d'une saison (une course annulée en sort : state.race.cancelled).
    [/^https:\/\/api\.jolpi\.ca\/ergast\/f1\/(\d{4})\.json$/, () => {
      const { season, round, at, cancelled } = state.race;
      return { MRData: { RaceTable: { season, Races: cancelled ? [{ season, round: '1', url: 'https://en.wikipedia.org/wiki/2026_Australian_Grand_Prix', date: '2026-03-08' }]
        : [{ season, round, url: MEXICO_GP, date: new Date(at).toISOString().slice(0, 10) }] } } };
    }],
    [/^https:\/\/padelapi\.org\/api\/tournaments$/, () => ({ data: [state.padel.tournament] })],
    [/^https:\/\/padelapi\.org\/api\/tournaments\/(\d+)\/matches$/, (u, [, id]) => ({
      data: Number(id) === state.padel.tournament.id ? state.padel.matches.filter((m) => m.category === u.searchParams.get('category')).map(padelMatch) : [],
    })],
    [/^https:\/\/padelapi\.org\/api\/matches\/(\d+)$/, (u, [, id]) => {
      const m = state.padel.matches.find((x) => x.id === Number(id));
      return m ? { data: padelMatch(m) } : [404, { message: 'Not found' }];
    }],
    [/^https:\/\/padelapi\.org\/api\/matches$/, (u) => {
      const ids = (u.searchParams.get('id') ?? '').split(',').map(Number);
      return { data: state.padel.matches.filter((m) => ids.includes(m.id)).map(padelMatch) };
    }],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/seasons$/, () => MOTO_SEASONS],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/riders$/, () => motoProfiles()],
    [/^https:\/\/api\.openf1\.org\/v1\/drivers$/, () => openF1()],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/events$/, (u) => (u.searchParams.get('isFinished') === 'false' ? [gpEvent()] : [])],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/categories$/, () => MOTO_CATEGORIES],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/standings$/, (u) => MOTO_STANDINGS[u.searchParams.get('categoryUuid')] ?? MOTO_STANDINGS[MOTO_CATEGORY.motogp]],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/events\/cal-mal$/, () => ({
      id: 'cal-mal', time_zone: 'ASIA/KUALA_LUMPUR', broadcasts: [
        broadcast('Q2', 'QUALIFYING', state.gp.sprint - 4 * HOUR, 'MotoGP'),
        broadcast('SPR', 'RACE', state.gp.sprint, 'MotoGP'),
        broadcast('RAC', 'RACE', state.gp.race - 3 * HOUR, 'Moto3'),
        broadcast('RAC', 'RACE', state.gp.race - 2 * HOUR, 'Moto2'),
        broadcast('RAC', 'RACE', state.gp.race, 'MotoGP'),
      ],
    })],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/sessions$/, () => ['SPR', 'RAC'].map((type) => ({ id: `${type}-1`, type, status: motoStatus(type) }))],
    [/^https:\/\/api\.motogp\.pulselive\.com\/motogp\/v1\/results\/session\/(\w+)-1\/classification$/, (u, [, type]) => {
      const order = state.motoResults[type];
      return { classification: Array.isArray(order) ? order.map((id, i) => ({ position: i + 1, status: 'INSTND', rider: MOTO_RIDERS.find((r) => r.id === id) })) : [] };
    }],
    [/^https:\/\/api\.open-meteo\.com\/v1\/forecast$/, (u) => {
      const day = u.searchParams.get('start_date');
      if (day) {
        const w = state.weather[day];
        return { daily: { time: [day], temperature_2m_max: [w ? w.tmax : null], precipitation_sum: [w ? w.rain : null] } };
      }
      const days = Array.from({ length: Number(u.searchParams.get('forecast_days') ?? 7) }, (_, i) => addDays(dayKey(clock.now()), i));
      return { daily: { time: days, temperature_2m_max: days.map(() => 15.4), precipitation_sum: days.map(() => 0.2) } };
    }],
    [/^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search$/, () => PLACES],
    [/^https:\/\/api\.exchange\.coinbase\.com\/products\/(\w+)-EUR\/ticker$/, (u, [, coin]) => (state.prices[coin] ? { price: state.prices[coin] } : [404, { message: 'NotFound' }])],
    [/^https:\/\/api\.exchange\.coinbase\.com\/products\/(\w+)-EUR\/candles$/, (u) => {
      const from = Date.parse(u.searchParams.get('start'));
      const close = state.candles[from + HOUR];
      return close == null ? [] : [[from / 1000, close - 100, close + 100, close - 50, close, 12.5]];
    }],
    [/^https:\/\/api\.manifold\.markets\/v0\/search-markets$/, () => [{ ...state.manifold, outcomeType: 'BINARY', isResolved: false }]],
    [/^https:\/\/api\.manifold\.markets\/v0\/market\/(\w+)$/, (u, [, id]) => (id === state.manifold.id
      ? { ...state.manifold, outcomeType: 'BINARY', isResolved: !!state.resolution, resolution: state.resolution ?? undefined }
      : [404, { message: 'Market not found' }])],
  ];

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    state.calls.push(url.href);
    if (state.down) throw new TypeError('fetch failed');
    if (url.hostname === 'padelapi.org' && init.headers?.authorization !== `Bearer ${PADEL_TOKEN}`) {
      return new Response('{"message":"Unauthenticated."}', { status: 401, headers: { 'content-type': 'application/json' } });
    }
    const bare = `${url.origin}${url.pathname}`;
    const picture = imageFor(url);
    if (picture !== undefined) {
      return picture ? new Response(picture, { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    for (const [pattern, handler] of routes) {
      const match = pattern.exec(bare);
      if (!match) continue;
      const out = handler(url, match);
      const [status, body] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out];
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"error":"inconnu"}', { status: 404, headers: { 'content-type': 'application/json' } });
  }

  return Object.assign(state, {
    fetch,
    /** Fin du match : score final. */
    finish(id, home, away) { delete state.live[id]; state.scores[id] = [home, away]; },
    /** Un match de plus dans le calendrier (ex. un coup d'envoi imminent, pour suivre le direct). */
    addMatch(m) { state.matches.push(m); },
    /** Padel : match en cours ou fini (score en objets par set, comme Padel API). */
    padelPlay(id, sets) { state.padel.state[id] = { status: 'live', score: sets.map(([a, b]) => ({ team_1: String(a), team_2: String(b) })) }; },
    padelFinish(id, winner, sets, status = 'finished') {
      state.padel.state[id] = { status, winner, score: sets.map(([a, b]) => ({ team_1: String(a), team_2: String(b) })) };
    },
    /** Match en cours : score et chrono (« 62' », « Mi-temps »…). */
    play(id, home, away, clock = "62'", name = 'STATUS_SECOND_HALF') { state.live[id] = { score: [home, away], clock, name }; },
    postpone(id) { state.voided[id] = 'STATUS_POSTPONED'; },
    /**
     * Faits du match, comme dans le tableau du jour d'ESPN : details = [[minute, 'home' | 'away', type ESPN, joueur,
     * passeur]] (« Goal », « Penalty - Scored », « Yellow Card », « Red Card »…), statistics = { possessionPct: [64, 36],
     * … }. Le passeur n'est que dans le résumé du match (keyEvents), comme chez ESPN.
     */
    facts(id, { details = [], statistics = {} } = {}) {
      const scoring = (text) => /Goal|Scored/.test(text);
      state.matchFacts[id] = {
        details: details.map(([t, side, text, who]) => ({
          type: { text }, clock: { displayValue: t }, team: { id: `${id}-${side}` },
          scoringPlay: scoring(text), yellowCard: text === 'Yellow Card', redCard: text === 'Red Card',
          penaltyKick: /^Penalty/.test(text), ownGoal: text === 'Own Goal', shootout: false,
          athletesInvolved: who ? [{ displayName: who, shortName: who }] : [],
        })),
        keyEvents: details.filter(([, , text]) => scoring(text)).map(([t, side, text, who, assist]) => ({
          type: { text }, text: `Goal! ${who}.${assist ? ` Assisted by ${assist}.` : ''}`, clock: { displayValue: t }, team: { id: `${id}-${side}` },
          scoringPlay: true, shootout: false, participants: [who, assist].filter(Boolean).map((displayName) => ({ athlete: { displayName } })),
        })),
        statistics: Object.fromEntries(['home', 'away'].map((side, i) => [side, Object.entries(statistics).map(([name, v]) => ({ name, displayValue: String(v[i]) }))])),
      };
    },
    /** Recale le calendrier sur l'heure actuelle de l'horloge (tests qui ont déjà avancé le temps). */
    rebase() { Object.assign(state, schedule(clock.now())); },
    match: (id) => state.matches.find((m) => m.id === id),
    /** Id d'un pilote moto des classements capturés (« Marco Bezzecchi »). */
    rider: (name) => MOTO_RIDERS.find((r) => r.full_name === name).id,
    DAY,
  });
}
