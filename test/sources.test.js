// Les sources de données lisent de vraies réponses (capturées le 30 octobre 2026, allégées dans test/fixtures/sources).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parisDayAt } from '../src/lib/time.js';
import crypto, { roundPrice } from '../src/sources/crypto.js';
import f1 from '../src/sources/f1.js';
import foot from '../src/sources/foot.js';
import { createFetchJson, siteName, SourceError } from '../src/sources/http.js';
import { defaultParams, normalizeCompetitions, normalizeParams, SOURCES } from '../src/sources/index.js';
import manifold from '../src/sources/manifold.js';
import meteo from '../src/sources/meteo.js';
import mma from '../src/sources/mma.js';
import moto from '../src/sources/moto.js';
import { rugby, usfoot } from '../src/sources/sports.js';
import padel, { frenchPage } from '../src/sources/padel.js';
import tennis from '../src/sources/tennis.js';

const NOW = Date.parse('2026-10-30T09:58:00Z'); // heure des captures
const HOUR = 3_600_000;
// Les montants en euros gardent leurs espaces insécables (pas de coupure en fin de ligne) : on les compare en clair.
const plain = (text) => text.replace(/[  ]/g, ' ');
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8'));

/** io de test : chaque URL attendue renvoie une fixture ; les autres une réponse vide (ou une erreur). */
function io(routes, { now = NOW, otherwise = {} } = {}) {
  const seen = [];
  return {
    seen,
    now,
    async fetchJson(url) {
      seen.push(url);
      for (const [part, name] of routes) {
        if (url.includes(part)) return typeof name === 'string' ? fixture(name) : name;
      }
      if (otherwise instanceof Error) throw otherwise;
      return otherwise;
    },
  };
}

describe('⚽ football (ESPN)', () => {
  it('matchs à venir : un seul pari par match, « sport · compétition · rencontre », clôture au coup d’envoi', async () => {
    const x = io([['eng.1/scoreboard?dates=20261031', 'espn-scoreboard-eng1-20261031.json']], { otherwise: { events: [] } });
    const events = await foot.events({ competitions: ['eng.1'] }, x);
    assert.equal(x.seen.length, 8, 'aujourd’hui + 7 jours');
    assert.equal(events.length, 8);
    const first = events[0];
    assert.equal(first.title, 'Chelsea – Man Utd');
    assert.match(first.subtitle, /^Premier League · sam\. 31 oct\., 13:30$/);
    assert.equal(first.url, 'https://www.espn.com/soccer/match/_/gameId/401879248/manchester-united-chelsea');
    assert.deepEqual(first.markets.map((m) => [m.id, m.kind]), [['1x2', 'multi']]);
    const [win] = first.markets;
    assert.equal(win.question, 'Football · Premier League · Chelsea – Man Utd');
    assert.deepEqual(win.options, [{ key: 'home', label: 'Victoire Chelsea', odds: null }, { key: 'draw', label: 'Match nul', odds: null }, { key: 'away', label: 'Victoire Man Utd', odds: null }], 'pas de cote dans cette capture');
    assert.equal(win.closesAt, Date.parse('2026-10-31T12:30:00Z'));
    assert.ok(win.expectedAt > win.closesAt + 2 * HOUR);
    assert.equal(win.ref.key, 'foot:401879248:1x2');
    assert.equal(win.ref.closesMax, win.closesAt);
    assert.equal(win.competition, 'eng.1');
    // Pas de dates de saison dans ce tableau : saison à date fixe, de juillet à juillet.
    assert.deepEqual([win.season.label, win.season.startsAt], ['2026-27', parisDayAt('2026-07-01', 0)]);
    assert.deepEqual(await foot.events({ competitions: [] }, x), [], 'rien d’activé : rien à ouvrir');
  });

  it('cotes des bookmakers (DraftKings chez ESPN, cotes américaines) : décimales sur chaque option, ou aucune', async () => {
    // Forme réelle d'un tableau ESPN de Ligue 1 (capture du 30 octobre 2026, Troyes – Le Mans).
    const board = fixture('espn-scoreboard-eng1-20261031.json');
    const ev = board.events[0];
    ev.competitions[0].odds = [{ provider: { name: 'DraftKings' }, moneyline: {
      home: { open: { odds: '+110' }, close: { odds: '+135' } }, away: { close: { odds: '+195' } }, draw: { close: { odds: '+250' } },
    } }];
    const x = io([['dates=20261031', board]], { otherwise: { events: [] } });
    const [first] = await foot.events({ competitions: ['eng.1'] }, x);
    assert.deepEqual(first.markets[0].options.map((o) => o.odds), [2.35, 3.5, 2.95]);
    ev.competitions[0].odds[0].moneyline.draw = {};
    assert.deepEqual((await foot.events({ competitions: ['eng.1'] }, io([['dates=20261031', board]], { otherwise: { events: [] } })))[0].markets[0].options.map((o) => o.odds), [null, null, null], 'une cote manque : barème fixe');
  });

  it('un match qui commence dans moins de 10 minutes n’est plus proposé', async () => {
    const x = io([['dates=20261031', 'espn-scoreboard-eng1-20261031.json']], { now: Date.parse('2026-10-31T12:25:00Z'), otherwise: { events: [] } });
    const events = await foot.events({ competitions: ['eng.1'] }, x);
    assert.ok(!events.some((e) => e.title === 'Chelsea – Man Utd'));
    assert.equal(events.length, 7);
  });

  it('score final : 1N2 (et les paris « buts » ouverts avant le 30 octobre)', async () => {
    const x = io([['summary?event=401876422', 'espn-summary-401876422-ft.json']]);
    const ref = { league: 'fra.1', eventId: '401876422', home: 'PSG', away: 'Lyon' };
    assert.deepEqual(await foot.result({ ...ref, market: '1x2' }, x), {
      state: 'final', key: 'home', note: 'Score final : PSG 2 – 0 Lyon',
      live: { state: 'post', clock: 'Terminé', scores: { home: 2, away: 0 }, winner: 'home' },
    });
    assert.equal((await foot.result({ ...ref, market: 'goals' }, x)).key, 'no');
    assert.equal((await foot.result({ ...ref, market: 'btts' }, x)).key, 'no');
  });

  it('match pas encore joué : en attente ; match reporté : annulé', async () => {
    const pre = io([['summary', 'espn-summary-401876421-pre.json']]);
    assert.deepEqual(await foot.result({ league: 'fra.1', eventId: '401876421', market: '1x2' }, pre), { state: 'pending' });
    const postponed = fixture('espn-summary-401876421-pre.json');
    postponed.header.competitions[0].status.type.name = 'STATUS_POSTPONED';
    const x = io([['summary', postponed]]);
    assert.deepEqual(await foot.result({ league: 'fra.1', eventId: '401876421', market: '1x2' }, x), { state: 'void', note: 'Match reporté' });
  });

  it('une journée injoignable n’empêche pas les autres ; tout injoignable : erreur', async () => {
    const days = { events: [] };
    const partial = {
      now: NOW,
      fetchJson: async (url) => {
        if (url.includes('20261031')) return fixture('espn-scoreboard-eng1-20261031.json');
        if (url.includes('20261101')) throw new SourceError('réponse 500');
        return days;
      },
    };
    assert.equal((await foot.events({ competitions: ['eng.1'] }, partial)).length, 8);
    const down = io([], { otherwise: new SourceError('injoignable') });
    await assert.rejects(foot.events({ competitions: ['eng.1'] }, down), SourceError);
  });
});

describe('🏎️ Formule 1 (Jolpica)', () => {
  const US_GP = 'https://en.wikipedia.org/wiki/2026_United_States_Grand_Prix';
  const routes = [['current/next.json', 'jolpica-next.json'], ['current/driverstandings.json', 'jolpica-standings.json'], ['/2026/18/results.json', 'jolpica-results-2026-18.json'], ['racing/f1/scoreboard', 'espn-f1-scoreboard-2026.json']];
  const MEXICO_GP = 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix';

  it('prochain Grand Prix : un seul pari, 7 favoris + « Un autre pilote »', async () => {
    assert.deepEqual(await f1.events({ competitions: [] }, io(routes)), []);
    const [race] = await f1.events({ competitions: ['f1'] }, io(routes));
    assert.equal(race.title, 'Mexico City Grand Prix');
    assert.match(race.subtitle, /^Mexico City · dim\. 1 nov\., 21:00$/);
    assert.equal(race.markets.length, 1);
    const [winner] = race.markets;
    assert.equal(winner.question, 'Formule 1 · Mexico City · Autódromo Hermanos Rodríguez', 'le lieu et le circuit, sans phrase autour');
    assert.equal(winner.options.length, 8);
    assert.deepEqual(winner.options[0], { key: 'antonelli', label: 'Andrea Kimi Antonelli' });
    assert.deepEqual(winner.options.at(-1), { key: 'other', label: 'Un autre pilote' });
    assert.equal(winner.closesAt, Date.parse('2026-11-01T20:00:00Z'));
    assert.deepEqual([winner.competition, winner.season.label], ['f1', '2026']);
    // Le lien : la page du Grand Prix chez ESPN ; la page Wikipédia de Jolpica ne sert qu'à reconnaître la course.
    assert.deepEqual([winner.ref.url, winner.ref.page, race.url], ['https://www.espn.com/f1/race/_/id/600057447', MEXICO_GP, 'https://www.espn.com/f1/race/_/id/600057447']);
    const [offline] = await f1.events({ competitions: ['f1'] }, io(routes.slice(0, 3)));
    assert.equal(offline.markets[0].ref.url, 'https://www.espn.com/f1/schedule', 'ESPN sans réponse : son calendrier F1');
  });

  it('liens des paris déjà ouverts : la page Wikipédia ou le calendrier deviennent la page du Grand Prix chez ESPN', async () => {
    const espn = io([['racing/f1/scoreboard', 'espn-f1-scoreboard-2026.json']]);
    const closesMax = Date.parse('2026-11-01T20:00:00Z');
    assert.deepEqual(await f1.relink({ round: '19', url: MEXICO_GP, closesMax }, espn), { round: '19', url: 'https://www.espn.com/f1/race/_/id/600057447', page: MEXICO_GP, closesMax });
    assert.equal((await f1.relink({ url: 'https://www.espn.com/f1/schedule', page: MEXICO_GP, closesMax: Date.parse('2026-11-08T17:00:00Z') }, espn)).url, 'https://www.espn.com/f1/race/_/id/600057448');
    assert.equal(await f1.relink({ url: 'https://www.espn.com/f1/race/_/id/600057447', page: MEXICO_GP, closesMax }, espn), null, 'déjà bon : rien à changer');
    assert.equal(await f1.relink({ url: MEXICO_GP, closesMax: Date.parse('2027-01-10T12:00:00Z') }, espn), null, 'hors du calendrier : on garde le lien');
  });

  it('résultat : vainqueur parmi les favoris, sinon « Un autre pilote »', async () => {
    const ref = { season: '2026', round: '18', drivers: ['antonelli', 'russell'], leader: 'antonelli', url: US_GP, closesMax: Date.parse('2026-10-25T20:00:00Z') };
    const won = await f1.result({ ...ref, market: 'winner' }, io(routes));
    assert.deepEqual({ ...won, live: undefined }, { state: 'final', key: 'antonelli', note: 'Vainqueur : Andrea Kimi Antonelli', live: undefined });
    assert.equal(won.live.podium[0].name, 'Andrea Kimi Antonelli', 'le podium, pour l’affichage');
    assert.equal((await f1.result({ ...ref, market: 'leader' }, io(routes))).key, 'yes');
    assert.equal((await f1.result({ ...ref, drivers: ['russell'], leader: 'russell', market: 'winner' }, io(routes))).key, 'other');
  });

  it('course pas encore courue : on attend ; annulée (sortie du calendrier) : pari annulé tout de suite', async () => {
    const mexico = { season: '2026', round: '19', drivers: ['antonelli'], market: 'winner', url: 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix', closesMax: Date.parse('2026-11-01T20:00:00Z') };
    const none = { MRData: { RaceTable: { Races: [] } } };
    assert.equal((await f1.result(mexico, io([['/2026/19/results.json', none], ['/2026.json', 'jolpica-2026.json']]))).state, 'pending');
    const calendar = fixture('jolpica-2026.json');
    calendar.MRData.RaceTable.Races = calendar.MRData.RaceTable.Races.filter((r) => r.round !== '19');
    assert.deepEqual(await f1.result(mexico, io([['/2026/19/results.json', none], ['/2026.json', calendar]])), { state: 'void', note: 'Course annulée (retirée du calendrier officiel)' });
    assert.equal((await f1.result(mexico, io([['/2026/19/results.json', none], ['/2026.json', none]]))).state, 'pending', 'calendrier illisible : on attend');
  });

  it('une course annulée plus tôt décale les numéros : le pari suit sa course, pas la suivante', async () => {
    // Le GP des États-Unis était le 19e ; une course annulée avant lui en fait le 18e. Le 19e est maintenant Mexico.
    const ref = { season: '2026', round: '19', drivers: ['antonelli', 'russell'], market: 'winner', url: US_GP, closesMax: Date.parse('2026-10-25T20:00:00Z') };
    const mexico = { MRData: { RaceTable: { Races: [{ round: '19', url: 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix', date: '2026-11-01', Results: [{ position: '1', status: 'Finished', Driver: { driverId: 'russell', givenName: 'George', familyName: 'Russell' } }] }] } } };
    const seen = io([['/2026/19/results.json', mexico], ['/2026.json', 'jolpica-2026.json'], ['/2026/18/results.json', 'jolpica-results-2026-18.json']]);
    const outcome = await f1.result(ref, seen);
    assert.deepEqual([outcome.state, outcome.key, outcome.note], ['final', 'antonelli', 'Vainqueur : Andrea Kimi Antonelli']);
    assert.ok(seen.seen.some((u) => u.endsWith('/2026/18/results.json')), 'résultat lu au nouveau numéro de la course');
  });
});

describe('🏍️ Grands Prix moto (MotoGP.com)', () => {
  const MOTO_NOW = Date.parse('2026-10-30T15:05:00Z'); // vendredi du Grand Prix de Malaisie, heure des captures
  const SEASON = 'e88b4e43-2209-47aa-8e83-0e0b1cedde6e';
  const MGP = 'e8c110ad-64aa-4e8e-8a86-f2f152f6a942';
  const MOTO3 = '954f7e65-2ef2-4423-b949-4961cc603e45';
  const MAL = 'ea2ba334-b943-462f-aedb-084ac38408d1';
  const routes = [
    ['results/seasons', 'motogp-seasons.json'],
    ['isFinished=false', 'motogp-events-upcoming.json'],
    ['isFinished=true', 'motogp-events-started.json'],
    ['results/categories', 'motogp-categories.json'],
    [`standings?seasonUuid=${SEASON}&categoryUuid=${MGP}`, 'motogp-standings-motogp.json'],
    [`standings?seasonUuid=${SEASON}&categoryUuid=${MOTO3}`, 'motogp-standings-moto3.json'],
    ['v1/events/d1aedfce-d7c8-4d4a-9532-99c82547baad', 'motogp-calendar-mal.json'],
    ['v1/events/3f3d3f5e-851c-42d2-887a-8ce8b41fa908', 'motogp-calendar-qat.json'],
  ];
  const rider = (name) => fixture('motogp-standings-motogp.json').classification.find((c) => c.rider.full_name === name).rider.id;

  it('deux prochains Grands Prix : vainqueur de la course et du sprint, aux heures du calendrier officiel', async () => {
    const x = io(routes, { now: MOTO_NOW });
    const [mal, qat, ...rest] = await moto.events({ competitions: ['motogp', 'moto3'] }, x);
    assert.equal(rest.length, 0);
    assert.deepEqual([mal.title, mal.subtitle], ['Grand Prix de Malaisie', 'Sepang · 30 oct. – 1er nov.']);
    assert.deepEqual([qat.title, qat.subtitle], ['Grand Prix du Qatar', 'Doha · 6 – 8 nov.']);
    assert.equal(mal.url, 'https://www.motogp.com/fr/gp-results/2026/MAL/MotoGP/RAC/Classification');
    assert.deepEqual(mal.markets.map((m) => [m.id, m.kind]), [['motogp-race', 'multi'], ['motogp-sprint', 'multi'], ['moto3-race', 'multi']]);
    const [race, sprint, moto3] = mal.markets;
    assert.equal(race.question, 'Moto · MotoGP · Grand Prix de Malaisie');
    // Saison : du premier au dernier Grand Prix du calendrier (ici les captures : Indonésie → Valence).
    assert.deepEqual([race.competition, moto3.competition, race.season.label], ['motogp', 'moto3', '2026']);
    assert.equal(race.season.startsAt, parisDayAt('2026-10-09', 0));
    assert.equal(race.options.length, 8);
    assert.deepEqual(race.options[0], { key: rider('Marc Marquez'), label: 'Marc Marquez' });
    assert.deepEqual(race.options.at(-1), { key: 'other', label: 'Un autre pilote' });
    // 15 h à Sepang (UTC+8) : l'API de résultats écrirait « 15:00+00:00 », le calendrier donne la vraie heure.
    assert.equal(race.closesAt, Date.parse('2026-11-01T07:00:00Z'));
    assert.equal(race.ref.closesMax, race.closesAt);
    assert.equal(race.expectedAt, race.closesAt + 1.5 * HOUR);
    assert.deepEqual([race.ref.event, race.ref.category, race.ref.type, race.ref.key], [MAL, MGP, 'RAC', `moto:${MAL}:motogp:race`]);
    assert.equal(sprint.question, 'Moto · MotoGP · Grand Prix de Malaisie, sprint');
    assert.deepEqual([sprint.closesAt, sprint.ref.type], [Date.parse('2026-10-31T07:00:00Z'), 'SPR']);
    assert.equal(moto3.closesAt, Date.parse('2026-11-01T04:00:00Z'));
    assert.equal(moto3.options[0].label, 'Maximo Quiles');
    assert.equal(qat.markets.find((m) => m.id === 'motogp-race').closesAt, Date.parse('2026-11-08T16:00:00Z'), '19 h à Lusail (UTC+3)');
    assert.ok(!x.seen.some((u) => u.includes('66961f05')), 'Grand Prix passé (Australie) : calendrier pas demandé');
  });

  it('une course qui part dans moins de 10 minutes n’est plus proposée', async () => {
    const [mal] = await moto.events({ competitions: ['motogp'] }, io(routes, { now: Date.parse('2026-10-31T06:55:00Z') }));
    assert.deepEqual(mal.markets.map((m) => m.id), ['motogp-race']);
  });

  it('résultat : vainqueur (et les anciens paris leader, podium français) ; course annulée ; pas encore classée', async () => {
    const ina = io([['sessions?eventUuid=275ca55d', 'motogp-sessions-ina-motogp.json'], ['/classification', 'motogp-classification-ina-motogp-rac.json']], { now: MOTO_NOW });
    const ref = { event: '275ca55d-45d3-440f-ad59-17d6b3e6b2d3', category: MGP, type: 'RAC', riders: [rider('Marc Marquez'), rider('Marco Bezzecchi')], leader: rider('Marc Marquez') };
    const won = await moto.result({ ...ref, market: 'race' }, ina);
    assert.deepEqual({ ...won, live: undefined }, { state: 'final', key: rider('Marco Bezzecchi'), note: 'Vainqueur : Marco Bezzecchi', live: undefined });
    assert.deepEqual(won.live.podium.map((p) => p.name), ['Marco Bezzecchi', 'Raul Fernandez', 'Jorge Martin'], 'le podium, pour l’affichage');
    assert.equal((await moto.result({ ...ref, market: 'race', riders: [rider('Marc Marquez')] }, ina)).key, 'other');
    assert.equal((await moto.result({ ...ref, market: 'leader' }, ina)).key, 'no');
    assert.deepEqual(await moto.result({ ...ref, market: 'fr' }, ina), { state: 'final', key: 'no', note: 'Podium : Marco Bezzecchi, Raul Fernandez, Jorge Martin' });

    const aus = io([['sessions?eventUuid=c1dea7a7', 'motogp-sessions-aus-moto3.json']]);
    assert.deepEqual(await moto.result({ ...ref, event: 'c1dea7a7-e35e-4363-9e28-7997e3bc6fbf', category: MOTO3, market: 'race' }, aus), { state: 'void', note: 'Course annulée' });

    const upcoming = io([['sessions?', [{ id: 's1', type: 'RAC', status: 'NOT-STARTED' }]]]);
    assert.deepEqual(await moto.result({ ...ref, market: 'race' }, upcoming), { state: 'pending' });
    const unranked = io([['sessions?', [{ id: 's1', type: 'RAC', status: 'FINISHED' }]], ['/classification', { classification: [] }]]);
    assert.deepEqual(await moto.result({ ...ref, market: 'race' }, unranked), { state: 'pending' });
  });
});

describe('🏈 🏉 sports collectifs d’ESPN : NFL, Top 14', () => {
  const NOW_ESPN = Date.parse('2026-10-30T16:27:00Z'); // heure des captures NFL, Top 14, ATP, UFC

  it('NFL : un seul pari, le vainqueur (sans match nul), saison officielle', async () => {
    const x = io([['nfl/scoreboard?dates=20261101', 'espn-scoreboard-nfl-20261101.json']], { now: NOW_ESPN, otherwise: { events: [] } });
    const events = await usfoot.events({ competitions: ['nfl'] }, x);
    assert.equal(events.length, 3);
    const [bills] = events;
    assert.equal(bills.title, 'Bills – Ravens');
    assert.equal(bills.markets.length, 1);
    const [winner] = bills.markets;
    assert.deepEqual([winner.question, winner.options.map((o) => o.label)], ['Football américain · NFL · Bills – Ravens', ['Victoire Bills', 'Victoire Ravens']]);
    assert.equal(winner.closesAt, Date.parse('2026-11-01T18:00:00Z'));
    // Saison officielle d'ESPN : d'août jusqu'après le Super Bowl.
    assert.deepEqual([winner.competition, winner.season.label, winner.season.endsAt], ['nfl', '2026-27', Date.parse('2027-02-16T07:59Z')]);
  });

  it('résultat : vainqueur ; anciens paris sur le total : au-dessus, au-dessous, pile sur la ligne (annulé)', async () => {
    const x = io([['summary?event=401873023', 'espn-summary-nfl-401873023-final.json']]);
    const ref = { path: 'football/nfl', eventId: '401873023', home: 'Packers', away: 'Panthers' };
    const won = await usfoot.result({ ...ref, market: 'winner' }, x);
    assert.deepEqual([won.state, won.key, won.note], ['final', 'home', 'Score final : Packers 27 – 19 Panthers']);
    assert.deepEqual(won.live.scores, { home: 27, away: 19 });
    assert.equal((await usfoot.result({ ...ref, market: 'total', line: 45.5 }, x)).key, 'yes');
    assert.equal((await usfoot.result({ ...ref, market: 'total', line: 47.5 }, x)).key, 'no');
    const line = await usfoot.result({ ...ref, market: 'total', line: 46 }, x);
    assert.deepEqual([line.state, line.note], ['void', 'Score final : Packers 27 – 19 Panthers : pile sur la ligne']);
  });

  it('Top 14 : match nul possible ; dates de saison incohérentes chez ESPN : saison d’août à août', async () => {
    const x = io([['270559/scoreboard?dates=20261031', 'espn-scoreboard-top14-20261031.json']], { now: NOW_ESPN, otherwise: { events: [] } });
    const [clermont] = await rugby.events({ competitions: ['270559'] }, x);
    assert.equal(clermont.subtitle.split(' · ')[0], 'Top 14');
    const [win] = clermont.markets;
    assert.deepEqual(win.options.map((o) => o.label), ['Victoire Clermont Auvergne', 'Match nul', 'Victoire Racing 92']);
    assert.deepEqual([win.season.label, win.season.startsAt], ['2026-27', parisDayAt('2026-08-01', 0)]);
  });
});

describe('🎾 tennis et 🥊 MMA (ESPN)', () => {
  const NOW_ESPN = Date.parse('2026-10-30T16:27:00Z');

  it('tennis : les matchs en simple à l’horaire connu (ni qualifications, ni doubles, ni adversaire inconnu)', async () => {
    const x = io([['atp/scoreboard?dates=20261030', 'espn-scoreboard-atp-20261030.json']], { now: NOW_ESPN, otherwise: { events: [] } });
    const events = await tennis.events({ competitions: ['atp'] }, x);
    assert.deepEqual(events.map((e) => e.id), ['185155', '185156', '185200', '185158'], 'le match de 16 h 30 commence dans moins de 10 minutes');
    const [first] = events;
    assert.equal(first.title, 'Jerome Kym – Jiri Lehecka');
    const [m] = first.markets;
    assert.equal(m.question, 'Tennis · Swiss Indoors Basel, quart de finale · Jerome Kym – Jiri Lehecka');
    assert.deepEqual(m.options.map((o) => o.label), ['Jerome Kym', 'Jiri Lehecka']);
    assert.deepEqual([m.competition, m.season.label, m.ref.day, m.ref.key], ['atp', '2026', '20261030', 'tennis:185155:winner']);
    assert.equal(events.at(-1).markets[0].question, 'Tennis · Swiss Indoors Basel, demi-finale · Valentin Vacherot – Taylor Fritz');
  });

  it('tennis : résultat d’après le tableau du jour du match', async () => {
    const x = io([['atp/scoreboard?dates=20261030', 'espn-scoreboard-atp-20261030.json']], { otherwise: { events: [] } });
    const winner = (await tennis.events({ competitions: ['atp'] }, { ...x, now: Date.parse('2026-10-29T00:00:00Z') })).length;
    assert.ok(winner > 0);
    const done = await tennis.result({ path: 'tennis/atp', matchId: '185201', day: '20261030', market: 'winner' }, x);
    assert.equal(done.state, 'final');
    assert.equal(done.note, 'Vainqueur : Daniil Medvedev');
    assert.deepEqual(await tennis.result({ path: 'tennis/atp', matchId: '185200', day: '20261030', market: 'winner' }, x), { state: 'pending' });
  });

  it('MMA : chaque combat de la soirée, résultat du combat', async () => {
    const x = io([['ufc/scoreboard?dates=20261031', 'espn-scoreboard-ufc-20261031.json']], { now: NOW_ESPN, otherwise: { events: [] } });
    const events = await mma.events({ competitions: ['ufc'] }, x);
    assert.equal(events.length, 3);
    const main = events.find((e) => e.id === '401921310');
    assert.equal(main.markets[0].question, 'MMA · UFC Fight Night: Moicano vs. Nolan · Renato Moicano – Tom Nolan');
    assert.deepEqual([main.markets[0].competition, main.markets[0].season.label], ['ufc', '2026']);
    const card = fixture('espn-scoreboard-ufc-20261031.json');
    const fight = card.events[0].competitions.find((c) => c.id === '401921310');
    const ref = { path: 'mma/ufc', fightId: '401921310', day: '20261031', market: 'winner' };
    assert.deepEqual(await mma.result(ref, x), { state: 'pending' });
    fight.status.type = { name: 'STATUS_FINAL', state: 'post', completed: true };
    fight.competitors[1].winner = true;
    const won = await mma.result(ref, io([['ufc/scoreboard', card]]));
    assert.deepEqual([won.state, won.key, won.note, won.live.winner], ['final', fight.competitors[1].id, 'Vainqueur : Tom Nolan', fight.competitors[1].id]);
    fight.competitors[1].winner = false;
    assert.deepEqual(await mma.result(ref, io([['ufc/scoreboard', card]])), { state: 'void', note: 'Combat sans vainqueur (nul ou sans décision)' });
  });
});

describe('🌦️ météo (Open-Meteo)', () => {
  const paris = { name: 'Paris', lat: 48.8534, lon: 2.3488 };

  it('les jours suivants : pluie et température, clôture la veille à minuit', async () => {
    const events = await meteo.events({ place: paris }, io([['forecast', 'open-meteo-forecast-paris.json']]));
    assert.equal(events.length, 6, 'aujourd’hui n’est plus proposé');
    const [saturday] = events;
    assert.equal(saturday.title, 'Samedi 31 octobre');
    const [rain, temp] = saturday.markets;
    assert.equal(rain.question, 'Il pleut à Paris samedi 31 octobre ?');
    assert.equal(temp.question, 'Au moins 15 °C à Paris samedi 31 octobre ?');
    assert.match(temp.details, /Prévision au lancement : 15,4 °C/);
    assert.equal(rain.closesAt, Date.parse('2026-10-30T23:00:00Z'), 'minuit heure de Paris');
    assert.equal(events[1].title, 'Dimanche 1er novembre');
  });

  it('relevé du jour : seuil de température et pluie (au moins 1 mm)', async () => {
    const after = parisDayAt('2026-10-21', 8);
    const x = io([['start_date=2026-10-20', 'open-meteo-day-2026-10-20.json']], { now: after });
    const ref = { ...paris, city: 'Paris', date: '2026-10-20' };
    assert.deepEqual(await meteo.result({ ...ref, market: 'temp', threshold: 14 }, x), { state: 'final', key: 'yes', note: 'Open-Meteo : 14,2 °C au plus chaud à Paris' });
    assert.equal((await meteo.result({ ...ref, market: 'temp', threshold: 15 }, x)).key, 'no');
    assert.equal((await meteo.result({ ...ref, market: 'rain' }, x)).key, 'no', '0,5 mm : pas de pluie');
    const early = io([], { now: parisDayAt('2026-10-20', 22) });
    assert.deepEqual(await meteo.result({ ...ref, market: 'rain' }, early), { state: 'pending' });
    assert.equal(early.seen.length, 0, 'pas d’appel avant la fin de la journée');
  });

  it('recherche de ville', async () => {
    const places = await meteo.places('Lyon', io([['geocoding', 'open-meteo-geocoding-lyon.json']]));
    assert.deepEqual(places[0], { name: 'Lyon', lat: 45.7491, lon: 4.8479, country: 'Auvergne-Rhône-Alpes, France' });
  });
});

describe('🪙 cryptos (Coinbase)', () => {
  it('seuil rond près du cours, relevé à 20 h demain et dans une semaine', async () => {
    const [btc] = await crypto.events({ coins: ['BTC'] }, io([['BTC-EUR/ticker', 'coinbase-ticker-btc-eur.json']]));
    assert.equal(btc.title, 'Bitcoin');
    const [d1, d7] = btc.markets;
    assert.equal(plain(d1.question), 'Le Bitcoin vaut plus de 69 000 € samedi 31 octobre à 20 h ?');
    assert.equal(d1.ref.at, Date.parse('2026-10-31T19:00:00Z'));
    assert.equal(d1.closesAt, d1.ref.at - 24 * HOUR, 'pronostics clos 24 h avant le relevé');
    assert.equal(d7.ref.at, Date.parse('2026-11-06T19:00:00Z'));
    assert.deepEqual([roundPrice(69265.78), roundPrice(1988.01), roundPrice(0.1834)], [69000, 2000, 0.18]);
  });

  it('cours de clôture de la bougie qui finit à l’heure du relevé', async () => {
    const at = Date.parse('2026-10-29T11:00:00Z');
    const x = io([['candles', 'coinbase-candles-btc-eur.json']], { now: at + HOUR });
    const r = await crypto.result({ product: 'BTC-EUR', at, threshold: 69000 }, x);
    assert.deepEqual({ ...r, note: plain(r.note) }, { state: 'final', key: 'yes', note: 'Cours Coinbase à 20 h : 71 946 €' });
    assert.equal((await crypto.result({ product: 'BTC-EUR', at, threshold: 72000 }, x)).key, 'no');
    assert.deepEqual(await crypto.result({ product: 'BTC-EUR', at, threshold: 1 }, io([], { now: at })), { state: 'pending' });
  });
});

describe('🔮 questions d’actualité (Manifold)', () => {
  it('questions oui/non qui se terminent dans les 120 jours', async () => {
    const events = await manifold.events({ term: 'France' }, io([['search-markets?term=France', 'manifold-search-france.json']]));
    assert.deepEqual(events.map((e) => e.id), ['OUPVIzf9SvfxbMEPoZ9C', 'UU2gIo7bcwJ0iADMfrPu', 'Z9n5SgcU0y', 'u8SEZgRU9u']);
    const [m] = events[0].markets;
    assert.equal(m.question, 'Will Emmanuel Macron cease being President of France before 2027?');
    assert.match(events[0].subtitle, /4 % de oui · clôture le 31 déc\. 2026/);
    assert.equal(m.ref.key, 'manifold:OUPVIzf9SvfxbMEPoZ9C');
  });

  it('résolution officielle : oui, non, annulée ; ouverte : en attente', async () => {
    assert.equal((await manifold.result({ id: 'x' }, io([['market/', 'manifold-market-resolved-no.json']]))).key, 'no');
    assert.equal((await manifold.result({ id: 'x' }, io([['market/', 'manifold-market-open.json']]))).state, 'pending');
    assert.equal((await manifold.result({ id: 'x' }, io([['market/', { isResolved: true, resolution: 'YES' }]]))).key, 'yes');
    assert.equal((await manifold.result({ id: 'x' }, io([['market/', { isResolved: true, resolution: 'CANCEL' }]]))).state, 'void');
  });
});

describe('🏓 padel (Padel API)', () => {
  it('le lien d’un match : sa page chez Fantasy Padel Tour (donnée par l’API), en français ; sinon celle du tournoi', async () => {
    // Vraies réponses du Kuwait Major 2026, remises avant les demi-finales (tournoi en cours, matchs à jouer).
    const tournaments = fixture('padelapi-tournaments.json');
    tournaments.data[0].status = 'live';
    const matches = fixture('padelapi-tournament-748-matches-men.json');
    for (const m of matches.data) m.status = 'scheduled';
    const seen = { ...io([['/tournaments?', tournaments], ['/tournaments/748/matches', matches]], { now: Date.parse('2026-10-30T08:00:00Z') }), keys: { padel: 'clé-de-test' } };
    const events = await padel.events({ competitions: ['men'] }, seen);
    assert.deepEqual(events.map((e) => [e.title, e.markets[0].ref.url]), [
      ['Alonso / Goñi – Tello / Arce', 'https://fr.fantasypadeltour.com/match/2774/alonso-goni-tello-arce'],
      ['Coello / Tapia – Libaak / Alfonso', 'https://fr.fantasypadeltour.com/match/2773/coello-tapia-alfonso-libaak'],
      ['Coello / Tapia – Tello / Arce', 'https://fr.fantasypadeltour.com/match/2775/coello-tapia-tello-arce'],
    ]);
    delete matches.data[0].url;
    assert.equal((await padel.events({ competitions: ['men'] }, seen)).find((e) => e.id === '14249').url, 'https://fr.fantasypadeltour.com/games/103/kuwait-major-2026', 'sans page de match : celle du tournoi');
    assert.equal(frenchPage('https://www.fantasypadeltour.com/match/1/x'), 'https://fr.fantasypadeltour.com/match/1/x');
    assert.equal(frenchPage('https://fr.fantasypadeltour.com/match/1/x'), 'https://fr.fantasypadeltour.com/match/1/x');
    assert.equal(frenchPage(null), null);
  });
});

describe('réglages des sources et appels HTTP', () => {
  it('chaque source a des réglages par défaut valides', () => {
    for (const s of SOURCES) assert.deepEqual(normalizeParams(s, defaultParams(s)), defaultParams(s), s.id);
  });

  it('réglages vérifiés : choix connus, au moins un, ville complète, texte court', () => {
    assert.deepEqual(normalizeCompetitions(foot, ['eng.1', 'eng.1']), ['eng.1']);
    assert.deepEqual(normalizeCompetitions(foot, []), [], 'rien d’activé');
    assert.throws(() => normalizeCompetitions(foot, ['xxx']), /compétition inconnue/);
    assert.deepEqual(normalizeCompetitions(meteo, ['meteo']), ['meteo'], 'source hors sport : elle-même');
    assert.throws(() => normalizeCompetitions(meteo, ['fra.1']), /compétition inconnue/);
    assert.throws(() => normalizeParams(crypto, { coins: [] }), /au moins une/);
    assert.throws(() => normalizeParams(meteo, { place: { name: 'Lyon' } }), /ville/);
    assert.equal(normalizeParams(meteo, { place: { name: 'Lyon', lat: 45.7, lon: 4.8 } }).place.name, 'Lyon');
    assert.throws(() => normalizeParams(manifold, { term: 'x'.repeat(41) }), /40 caractères/);
  });

  it('« Voir sur … » nomme le site que le lien ouvre, pas forcément la source des données', () => {
    assert.equal(siteName('https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix'), 'Wikipédia', 'F1 : Jolpica donne la page Wikipédia');
    assert.equal(siteName('https://www.espn.com/soccer/match/_/gameId/401876414'), 'ESPN');
    assert.equal(siteName('https://fr.fantasypadeltour.com/match/2775/coello-tapia-tello-arce'), 'Fantasy Padel Tour', 'padel : le site de Padel API');
    assert.equal(siteName('https://www.motogp.com/fr/gp-results/2026/mal/motogp/rac/classification'), 'MotoGP.com');
    assert.equal(siteName('https://example.org/x'), 'example.org', 'un site inconnu : son adresse');
    assert.equal(siteName('pas une adresse'), null);
  });

  it('cache le temps demandé (horloge de l’app), erreurs lisibles', async () => {
    let t = 0;
    let calls = 0;
    const fetchJson = createFetchJson({
      clock: { now: () => t },
      fetch: async (url) => {
        calls++;
        if (url.includes('panne')) return new Response('oups', { status: 503 });
        if (url.includes('lent')) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        return new Response('{"ok":1}', { status: 200 });
      },
    });
    await fetchJson('https://x/a', { ttl: 1000 });
    await fetchJson('https://x/a', { ttl: 1000 });
    assert.equal(calls, 1);
    t = 1000;
    await fetchJson('https://x/a', { ttl: 1000 });
    assert.equal(calls, 2);
    await assert.rejects(fetchJson('https://x/panne'), (e) => e instanceof SourceError && e.message === 'réponse 503');
    await assert.rejects(fetchJson('https://x/lent'), (e) => e instanceof SourceError && e.message === 'délai dépassé');
  });
});
