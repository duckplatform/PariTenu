// Faits de match (buts, cartons, essais, scores par période, statistiques, meneurs, fin d'un combat, classement d'une
// course) : lus dans de vraies réponses capturées le 1er novembre 2026 (test/fixtures/sources/*-facts.json, allégées).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import f1 from '../src/sources/f1.js';
import { fightFinish, summaryFacts, teamFacts } from '../src/sources/facts.js';
import foot from '../src/sources/foot.js';
import mma from '../src/sources/mma.js';
import moto from '../src/sources/moto.js';
import { baseball, basket, hockey, rugby, usfoot } from '../src/sources/sports.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8'));
/**
 * Le direct d'une rencontre, lu comme en vrai : chaque tableau du jour demandé rend la capture ; le résumé du match,
 * la capture summary (sans elle, le résumé n'apporte rien).
 */
async function liveOf(source, name, ref, summary = null) {
  const data = fixture(name);
  const found = await source.live([{ key: 'k', ...ref }], { fetchJson: async (url) => (summary && url.includes('/summary?') ? fixture(summary) : data), now: Date.now() });
  return found.get('k');
}
const ev = (name) => fixture(name).events[0];
const line = (e) => [e.t, e.side, e.kind, e.who, e.note];

describe('⚽ Football : buts, cartons et statistiques (Strasbourg – Auxerre, 5-1)', () => {
  it('la chronologie : buteurs, penalty, cartons jaunes et rouge, dans l’ordre du match', async () => {
    const { closesMax, id } = { closesMax: Date.parse('2026-11-01T14:00Z'), id: ev('espn-scoreboard-fra1-20261101-facts.json').id };
    const { live } = await liveOf(foot, 'espn-scoreboard-fra1-20261101-facts.json', { league: 'fra.1', path: 'soccer/fra.1', eventId: id, closesMax });
    assert.deepEqual([live.state, live.scores, live.clock], ['post', { home: 5, away: 1 }, 'Terminé']);
    assert.deepEqual(live.events.map(line), [
      ["39'", 'away', 'yellow', 'L. Sy', null],
      ["41'", 'home', 'goal', 'D. Essugo', null],
      ["44'", 'home', 'yellow', null, null],
      ["51'", 'away', 'yellow', null, null],
      ["55'", 'home', 'goal', 'M. Godo', null],
      ["60'", 'away', 'yellow', 'C. Makosso', null],
      ["62'", 'home', 'goal', 'C. Harder', 'pen'],
      ["68'", 'away', 'goal', 'C. Archer', null],
      ["72'", 'away', 'yellow', 'P. Nardi', null],
      ["74'", 'away', 'red', 'L. Dioubaté', null],
      ["77'", 'home', 'goal', 'G. Yassine', null],
      ["85'", 'home', 'goal', 'G. Yassine', null],
      ["87'", 'away', 'yellow', 'R. Faivre', null],
    ]);
    assert.equal(live.events.filter((e) => e.kind === 'goal' && e.side === 'home').length, live.scores.home, 'autant de buts que de points');
    assert.deepEqual(live.stats.map((s) => [s.label, s.home, s.away, s.pct]), [
      ['Possession', 64.2, 35.8, true], ['Tirs', 19, 6, false], ['Tirs cadrés', 6, 2, false], ['Corners', 5, 0, false],
      ['Fautes', 11, 18, false], ['Cartons jaunes', 1, 5, false], ['Cartons rouges', 0, 1, false],
    ]);
  });

  it('avant le coup d’envoi : rien ; contre son camp et penalty manqué reconnus', () => {
    const competition = structuredClone(ev('espn-scoreboard-fra1-20261101-facts.json').competitions[0]);
    assert.deepEqual(teamFacts(competition, 'soccer', 'pre'), {});
    const [goal] = competition.details.filter((d) => d.scoringPlay);
    competition.details = [{ ...goal, ownGoal: true }, { ...goal, scoringPlay: false, type: { text: 'Penalty - Saved' } }, { ...goal, shootout: true }];
    assert.deepEqual(teamFacts(competition, 'soccer', 'in').events.map((e) => [e.kind, e.note]), [['goal', 'csc'], ['miss', null]], 'la séance de tirs au but n’y est pas');
  });
});

describe('🏉 Rugby : essais, transformations, pénalités, cartons (Montpellier – Castres, 69-10)', () => {
  it('chaque action qui marque et chaque carton, sans les remplacements', async () => {
    const { live } = await liveOf(rugby, 'espn-scoreboard-top14-20261101-facts.json', { path: 'rugby/270559', eventId: '604414', closesMax: Date.parse('2026-11-01T14:00Z') });
    const count = (kind, side) => live.events.filter((e) => e.kind === kind && e.side === side).length;
    assert.deepEqual([count('try', 'home'), count('try', 'away')], [10, 1]);
    const points = (side) => 5 * count('try', side) + 2 * count('conv', side) + 3 * (count('pen', side) + count('drop', side));
    assert.deepEqual([points('home'), points('away')], [69, 10], 'les points de la chronologie font le score');
    assert.deepEqual(line(live.events[0]), ["8'", 'away', 'yellow', 'G. Ducat', null]);
    assert.deepEqual(line(live.events.find((e) => e.kind === 'red')), ["68'", 'home', 'red', 'R. Wardi', null]);
    assert.deepEqual(live.stats.map((s) => [s.label, s.home, s.away]), [['Cartons jaunes', 0, 1], ['Cartons rouges', 1, 0]]);
  });
});

describe('🏈 🏀 🏒 ⚾ Scores par période, statistiques et meneurs', () => {
  it('football américain : quart-temps et meneurs du match (passes, courses, réceptions), en français', async () => {
    const { live } = await liveOf(usfoot, 'espn-scoreboard-nfl-20261029-facts.json', { path: 'football/nfl', eventId: '401873023', closesMax: Date.parse('2026-10-30T00:15Z') });
    assert.deepEqual(live.periods, { head: ['1', '2', '3', '4'], home: [6, 14, 7, 0], away: [3, 7, 3, 6] });
    assert.deepEqual(live.leaders.map((l) => [l.label, l.side, l.who, l.value]), [
      ['Passes', 'home', 'J. Love', '30/41, 288 yards, 3 TD, 1 INT'],
      ['Courses', 'away', 'C. Hubbard', '22 courses, 81 yards, 1 TD'],
      ['Réceptions', 'home', 'C. Watson', '8 réceptions, 113 yards'],
    ]);
    assert.equal(live.situation, undefined, 'la situation de jeu, seulement pendant le match');
  });

  it('football américain en cours : qui attaque, la tentative, où est le ballon', () => {
    const competition = structuredClone(ev('espn-scoreboard-nfl-20261029-facts.json').competitions[0]);
    competition.situation = { down: 3, distance: 7, possession: '9', possessionText: 'CAR 35', isRedZone: false };
    assert.equal(teamFacts(competition, 'nfl', 'in').situation, '🏈 GB en attaque · 3e tentative, 7 yards à faire · ballon sur CAR 35');
  });

  it('basket : quart-temps, adresse, rebonds, passes et meilleur joueur de chaque équipe', async () => {
    const { live } = await liveOf(basket, 'espn-scoreboard-nba-20261031-facts.json', { path: 'basketball/nba', eventId: '401909896', closesMax: Date.parse('2026-10-31T19:00Z') });
    assert.deepEqual(live.periods, { head: ['1', '2', '3', '4'], home: [18, 24, 22, 26], away: [27, 32, 29, 24] });
    assert.deepEqual(live.stats.map((s) => [s.label, s.home, s.away, s.pct]), [
      ['Adresse aux tirs', 37.2, 40.8, true], ['À 3 points', 27.5, 36.4, true], ['Lancers francs', 80.8, 82.9, true], ['Rebonds', 37, 48, false], ['Passes décisives', 23, 16, false],
    ]);
    assert.deepEqual(live.leaders.filter((l) => l.label === 'Points').map((l) => [l.side, l.who, l.value]), [['home', 'D. Peterson', '16'], ['away', 'D. Avdija', '24']]);
  });

  it('hockey : périodes avec la prolongation, tirs cadrés et arrêts des gardiens', async () => {
    const { live } = await liveOf(hockey, 'espn-scoreboard-nhl-20261031-facts.json', { path: 'hockey/nhl', eventId: '401892614', closesMax: Date.parse('2026-10-31T17:00Z') });
    assert.equal(live.clock, 'Terminé (prol.)');
    assert.deepEqual(live.periods, { head: ['1', '2', '3', 'Prol.'], home: [1, 1, 2, 1], away: [1, 1, 2, 0] });
    assert.deepEqual(live.stats.map((s) => [s.label, s.home, s.away]), [['Tirs cadrés', 32, 41], ['Arrêts', 37, 27], ['% d’arrêts', 90.2, 84.4]]);
    assert.deepEqual(live.leaders.filter((l) => l.label === 'Buts').map((l) => [l.who, l.value]), [['E. Lindholm', '1'], ['A. Frondell', '2']]);
  });

  it('baseball : points par manche, coups sûrs et erreurs ; en cours, retraits, bases et compte', async () => {
    const { live } = await liveOf(baseball, 'espn-scoreboard-mlb-20261028-facts.json', { path: 'baseball/mlb', eventId: '401908046', closesMax: Date.parse('2026-10-29T00:00Z') });
    assert.deepEqual(live.periods, {
      head: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], home: [0, 0, 0, 0, 0, 0, 0, 0, 1], away: [0, 1, 0, 0, 1, 2, 0, 0, 0], extra: [['C', 4, 8], ['E', 0, 2]],
    });
    const competition = structuredClone(ev('espn-scoreboard-mlb-20261028-facts.json').competitions[0]);
    competition.situation = { balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, onThird: true };
    assert.equal(teamFacts(competition, 'baseball', 'in').situation, '1 retrait · coureurs en 1re, 3e · compte 2-1');
  });
});

describe('📋 Le résumé du match : passeurs, actions qui marquent, buts et pénalités au hockey', () => {
  const MINUTE = 60_000;
  const STR = { league: 'fra.1', path: 'soccer/fra.1', eventId: '401876414', closesMax: Date.parse('2026-11-01T14:00Z') };
  const NHL = { path: 'hockey/nhl', eventId: '401892614', closesMax: Date.parse('2026-10-31T17:00Z') };
  const hockeyLine = (e) => [e.t, e.side, e.kind, e.who, e.note, e.assists];

  it('foot : le passeur de chaque but, posé sur les buts du tableau du jour (Strasbourg – Auxerre)', async () => {
    const { live } = await liveOf(foot, 'espn-scoreboard-fra1-20261101-facts.json', STR, 'espn-summary-fra1-401876414-facts.json');
    assert.equal(live.events.length, 13, 'les cartons restent');
    assert.deepEqual(live.events.filter((e) => e.kind === 'goal').map((e) => [e.t, e.who, e.assists]), [
      ["41'", 'D. Essugo', ['Oso']],
      ["55'", 'M. Godo', ['G. Yassine']],
      ["62'", 'C. Harder', undefined],
      ["68'", 'C. Archer', ['R. Faivre']],
      ["77'", 'G. Yassine', ['S. Nanasi']],
      ["85'", 'G. Yassine', ['Oso']],
    ]);
  });

  it('football américain : chaque action qui marque, en français (Panthers – Packers)', async () => {
    const { live } = await liveOf(usfoot, 'espn-scoreboard-nfl-20261029-facts.json', { path: 'football/nfl', eventId: '401873023', closesMax: Date.parse('2026-10-30T00:15Z') }, 'espn-summary-nfl-401873023-facts.json');
    assert.deepEqual(live.events.map(line), [
      ['1er QT · 11:43', 'away', 'fg', 'R. Fitzgerald', '39 yards'],
      ['1er QT · 5:08', 'home', 'td', 'T. Kraft', 'passe de J. Love, 12 yards · transformation manquée'],
      ['2e QT · 14:57', 'away', 'td', 'C. Hubbard', 'course de 1 yard'],
      ['2e QT · 6:33', 'home', 'td', 'J. Jacobs', 'course de 1 yard'],
      ['2e QT · 1:46', 'home', 'td', 'M. Golden', 'passe de J. Love, 24 yards'],
      ['3e QT · 7:30', 'home', 'td', 'J. Jacobs', 'passe de J. Love, 4 yards'],
      ['3e QT · 4:07', 'away', 'fg', 'R. Fitzgerald', '50 yards'],
      ['4e QT · 5:37', 'away', 'td', 'J. Coker', 'passe de B. Young, 26 yards · conversion à 2 points manquée'],
    ]);
    assert.ok(live.periods && live.leaders.length, 'les quart-temps et les meneurs restent');
  });

  it('football américain : retours, conversions, prolongation, safety (vrais textes de la semaine)', () => {
    const summary = fixture('espn-summary-nfl-401873023-facts.json');
    const home = summary.header.competitions[0].competitors.find((c) => c.homeAway === 'home').team.id;
    summary.scoringPlays = [
      ['TD', 4, 'Mason Taylor 12 Yd pass from Geno Smith (Geno Smith Pass to Mason Taylor for Two-Point Conversion)'],
      ['TD', 2, 'Calijah Kancey 32 Yd Fumble Return (Chase McLaughlin Kick)'],
      ['TD', 2, 'Darren Waller 50 Yd pass from Bryce Young (Ryan Fitzgerald PAT blocked)'],
      ['D2P', 2, 'Zyon McCollum Defensive PAT Conversion'],
      ['TD', 4, 'Anthony Tyus III 12 Yd Rush (Ryan Fitzgerald Kick) (Ryan Fitzgerald Kick)'],
      ['TD', 5, 'Devin Singletary 30 Yd Rush '],
      ['TD', 1, 'Javonte Williams 2 Yd Rush Javonte Williams Fumble James Mitchell 0 Yd Fumble Recovery (Brandon Aubrey Kick)'],
      ['TD', 2, 'Dylan Laube 95 Yd Kickoff Return (Matt Gay Kick)'],
      ['TD', 2, 'Elijah Davis 39 Yd Interception Return (Dillon Curtis Kick)'],
      ['TD', 4, 'Tramell Jones Jr. 2 Yd Run (Jadan Baugh Pass to Dallas Wilson for Two-Point Conversion)'],
      ['SF', 4, 'Team Safety'],
    ].map(([abbreviation, period, text]) => ({ text, scoringType: { abbreviation }, period: { number: period }, clock: { displayValue: '7:25' }, team: { id: home } }));
    assert.deepEqual(summaryFacts(summary, 'nfl').events.map((e) => [e.kind, e.who, e.note]), [
      ['td', 'M. Taylor', 'passe de G. Smith, 12 yards · conversion à 2 points réussie'],
      ['td', 'C. Kancey', 'retour de fumble, 32 yards'],
      ['td', 'D. Waller', 'passe de B. Young, 50 yards · transformation manquée'],
      ['d2p', 'Z. McCollum', null],
      ['td', 'A. Tyus III', 'course de 12 yards'],
      ['td', 'D. Singletary', 'course de 30 yards'],
      ['td', 'J. Mitchell', 'fumble récupéré, 0 yard'],
      ['td', 'D. Laube', 'retour de coup d’envoi, 95 yards'],
      ['td', 'E. Davis', 'retour d’interception, 39 yards'],
      ['td', 'T. Jones Jr.', 'course de 2 yards · conversion à 2 points réussie'],
      ['safety', null, null],
    ]);
    assert.equal(summaryFacts(summary, 'nfl').events[5].t, 'Prol. · 7:25');
  });

  it('hockey : buts avec passeurs (supériorité numérique, prolongation) et pénalités (Blackhawks – Bruins)', async () => {
    const { live } = await liveOf(hockey, 'espn-scoreboard-nhl-20261031-facts.json', NHL, 'espn-summary-nhl-401892614-facts.json');
    assert.deepEqual(live.events.filter((e) => e.kind === 'puck').map(hockeyLine), [
      ['1re · 6:04', 'away', 'puck', 'A. Frondell', 'pp', ['P. Kane', 'C. Bedard']],
      ['1re · 13:05', 'home', 'puck', 'D. Pastrnak', null, ['P. Zacha']],
      ['2e · 3:31', 'away', 'puck', 'A. Frondell', null, ['T. Bertuzzi', 'S. Rinzel']],
      ['2e · 12:34', 'home', 'puck', 'C. Mittelstadt', null, ['J. Hagens']],
      ['3e · 9:38', 'away', 'puck', 'R. Greene', null, ['A. Mangiapane']],
      ['3e · 12:20', 'away', 'puck', 'C. Bedard', null, ['R. Donato', 'R. Kantserov']],
      ['3e · 13:06', 'home', 'puck', 'M. Lohrei', null, ['J. Peterka', 'T. Jeannot']],
      ['3e · 19:48', 'home', 'puck', 'M. Geekie', null, ['C. McAvoy', 'J. Peterka']],
      ['Prol. · 2:32', 'home', 'puck', 'E. Lindholm', null, ['C. McAvoy']],
    ]);
    const penalties = live.events.filter((e) => e.kind === 'penalty');
    assert.equal(penalties.length, 15);
    assert.deepEqual(penalties.slice(0, 2).map(line), [['1re · 3:09', 'away', 'penalty', 'C. Smith', 'faire trébucher, 2 min'], ['1re · 5:53', 'home', 'penalty', 'W. Borgen', 'retarder le match, 2 min']]);
    assert.ok(penalties.some((e) => e.who === 'N. Zadorov' && e.note === 'inconduite, 10 min'));
    assert.ok(penalties.some((e) => e.who === 'T. Jeannot' && e.note === 'simulation, 2 min'));
    assert.equal(live.events.length, 24, 'ni mises au jeu, ni tirs');
    assert.ok(live.periods && live.stats.length, 'les périodes et les arrêts restent');
  });

  it('hockey : filet désert, infériorité numérique, pénalité majeure, pénalité de banc ; pas de tirs au but', () => {
    const edmonton = summaryFacts(fixture('espn-summary-nhl-401892617-facts.json'), 'hockey').events;
    assert.deepEqual(edmonton.slice(0, 2).map(line), [['1re · 2:22', 'home', 'penalty', 'E. Heineman', 'coup de genou, 5 min'], ['1re · 2:22', 'home', 'penalty', 'E. Heineman', 'inconduite de match, 10 min']]);
    assert.deepEqual(edmonton.find((e) => e.note === 'en').who, 'J. Dickinson');
    const ottawa = summaryFacts(fixture('espn-summary-nhl-401892619-facts.json'), 'hockey').events;
    assert.deepEqual(ottawa.find((e) => e.note === 'sh').who, 'R. Greig');
    assert.deepEqual(line(ottawa.find((e) => e.who == null)), ['2e · 11:38', 'away', 'penalty', null, 'trop de joueurs sur la glace, 2 min']);
    const shootout = summaryFacts(fixture('espn-summary-nhl-401892616-facts.json'), 'hockey').events;
    assert.equal(shootout.filter((e) => e.kind === 'puck').length, 8, 'les tirs au but n’y sont pas');
    assert.ok(shootout.every((e) => /^(1re|2e|3e|Prol\.) · /.test(e.t)));
    assert.equal(summaryFacts(fixture('espn-summary-nhl-401892616-facts.json'), 'rugby'), null, 'rien pour les autres sports');
    assert.equal(summaryFacts({}, 'hockey'), null);
  });

  it('le résultat lit aussi le résumé : les faits du hockey arrivent avec le score final', async () => {
    const summary = fixture('espn-summary-nhl-401892614-facts.json');
    const outcome = await hockey.result({ ...NHL, key: 'k', market: 'winner', home: 'Boston', away: 'Chicago' }, { fetchJson: async () => summary });
    assert.deepEqual([outcome.state, outcome.key, outcome.live.clock], ['final', 'home', 'Terminé (prol.)']);
    assert.equal(outcome.live.events.length, 24);
  });

  it('résumé relu seulement quand le match bouge, sinon toutes les 5 minutes ; injoignable : on garde le dernier', async () => {
    const board = fixture('espn-scoreboard-fra1-20261101-facts.json');
    const summary = fixture('espn-summary-fra1-401876414-facts.json');
    let reads = 0;
    let down = false;
    const fetchJson = async (url) => {
      if (!url.includes('/summary?')) return board;
      reads++;
      if (down) throw new Error('injoignable');
      return summary;
    };
    const memo = new Map();
    const t = Date.parse('2026-11-01T16:00Z');
    const assists = async (now) => (await foot.live([{ key: 'k', ...STR }], { fetchJson, now, memo })).get('k').live.events.filter((e) => e.assists).length;
    assert.equal(await assists(t), 5);
    assert.equal(await assists(t + MINUTE), 5);
    assert.equal(reads, 1, 'rien n’a bougé : pas de relecture');
    const details = board.events.find((e) => e.id === STR.eventId).competitions[0].details;
    details.push(structuredClone(details.find((d) => d.yellowCard)));
    down = true;
    assert.equal(await assists(t + 2 * MINUTE), 5, 'injoignable : les passeurs déjà lus restent');
    assert.equal(reads, 2, 'la chronologie a bougé : relu');
    down = false;
    await assists(t + 3 * MINUTE);
    assert.equal(reads, 2, 'pas avant 5 minutes');
    await assists(t + 7 * MINUTE);
    assert.equal(reads, 3, '5 minutes plus tard : relu');
  });
});

describe('🥊 MMA : bilan des combattants et fin du combat', () => {
  const card = () => ev('espn-scoreboard-ufc-20261031-facts.json');
  it('KO avant la limite (malgré une « décision » annoncée), soumission, décision', () => {
    const [ko, decision, submission] = card().competitions;
    assert.equal(fightFinish(ko), 'KO/TKO au 3e round (3:20)');
    assert.equal(fightFinish(decision), 'Décision après 3 rounds');
    assert.equal(fightFinish(submission), 'Soumission au 2e round (1:25)');
    assert.equal(fightFinish({ ...ko, status: { ...ko.status, type: { state: 'in' } } }), null, 'combat en cours');
  });

  it('le direct d’un combat fini : sa fin, et le bilan de chaque combattant', async () => {
    const { media, live } = await liveOf(mma, 'espn-scoreboard-ufc-20261031-facts.json', { path: 'mma/ufc', day: '20261031', fightId: '401914105' });
    assert.equal(live.finish, 'KO/TKO au 3e round (3:20)');
    assert.deepEqual(media.competitors.map((c) => [c.name, c.record]), [['Tainara Lisboa', '7-5-0'], ['Lucia Szabová', '13-0-0']]);
  });
});

describe('🏎️ 🏍️ Classement complet d’une course', () => {
  it('F1 (GP des États-Unis) : écarts, pilotes doublés, abandons, grille de départ et meilleur tour', async () => {
    const io = { fetchJson: async () => fixture('jolpica-results-2026-18.json') };
    const { live } = await f1.result({ season: '2026', round: '18', drivers: ['antonelli'], market: 'winner', closesMax: Date.parse('2026-10-25T20:00:00Z') }, io);
    const row = (r) => [r.pos, r.name, r.team, r.gap, r.grid, r.out];
    assert.equal(live.ranking.length, 22);
    assert.deepEqual(row(live.ranking[0]), [1, 'Andrea Kimi Antonelli', 'Mercedes', '1:35:16.650', 1, null]);
    assert.deepEqual(row(live.ranking[1]), [2, 'Charles Leclerc', 'Ferrari', '+13.078', 4, null]);
    assert.deepEqual(row(live.ranking[11]), [12, 'Arvid Lindblad', 'RB F1 Team', '+1 tour', 14, null], 'doublé : un tour, pas un temps trompeur');
    assert.deepEqual(row(live.ranking[19]), [null, 'Valtteri Bottas', 'Cadillac F1 Team', null, 19, 'Abandon']);
    assert.deepEqual(live.fastest, { name: 'Charles Leclerc', time: '1:37.976', lap: live.fastest.lap });
    assert.equal(live.podium.length, 3, 'le podium reste');
  });

  it('MotoGP (GP de Malaisie) : écarts, non-classés avec leurs tours, meilleur tour de la course', async () => {
    const data = fixture('motogp-classification-mal-motogp-rac.json');
    const io = { fetchJson: async (url) => (url.includes('/sessions?') ? [{ id: 'rac', type: 'RAC', status: 'FINISHED' }] : data) };
    const { live } = await moto.result({ event: 'mal', category: 'motogp', type: 'RAC', riders: [], market: 'winner' }, io);
    const row = (r) => [r.pos, r.name, r.gap, r.out];
    assert.deepEqual(row(live.ranking[0]), [1, 'Marc Marquez', '40:14.236', null]);
    assert.deepEqual(row(live.ranking[1]), [2, 'Pedro Acosta', '+4.172', null]);
    assert.deepEqual(live.ranking.filter((r) => r.out).map(row), [
      [null, 'Johann Zarco', null, 'Abandon (17 tours)'], [null, 'Diogo Moreira', null, 'Abandon (14 tours)'],
      [null, 'Joan Mir', null, 'Abandon (9 tours)'], [null, 'Augusto Fernandez', null, 'Abandon (1 tour)'],
    ]);
    assert.deepEqual(live.fastest, { name: 'Pedro Acosta', time: '1:59.261', lap: 2 });
  });
});
