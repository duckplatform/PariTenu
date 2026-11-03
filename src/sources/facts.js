// Faits de match au-delà du score (fiche d'un pari, page Direct), lus dans le tableau du jour d'ESPN, déjà relu chaque
// minute pour le score : aucune requête de plus. Le résumé du match (une requête de plus, summaryFacts) ajoute les
// passeurs au foot, les actions qui marquent en football américain, les buts et les pénalités au hockey. Ajoutés à
// l'état du direct (src/services/live.js) :
//
//   events    : [{ t: "41'", side: 'home' | 'away', kind, who, note, assists }] (foot, rugby, football américain,
//               hockey), dans l'ordre du match ; assists : passeurs d'un but (foot, hockey) ;
//               kind : goal, miss (penalty manqué), yellow, red, try, conv, pen (pénalité au rugby), drop ;
//               td, fg, safety, d2p (football américain) ; puck (but au hockey), penalty (pénalité au hockey)
//   periods   : { head: ['1', '2', '3', '4', 'Prol.'], home: [n…], away: [n…], extra: [[titre, domicile, extérieur]] }
//   stats     : [{ label, home, away, pct }] (pct : pourcentages, « 64 % ») ; leaders : [{ label, side, who, value }]
//   situation : où en est l'action, pendant le match (football américain, baseball)
//   finish    : comment s'est fini un combat (MMA) : « KO/TKO au 3e round (3:20) »
import { clip } from './http.js';

const MAX_EVENTS = 80;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nth = (n, feminine = false) => (n === 1 ? (feminine ? '1re' : '1er') : `${n}e`);
const who = (d) => clip(d.athletesInvolved?.[0]?.shortName || d.athletesInvolved?.[0]?.displayName || '', 30) || null;
/** « Dário Essugo » → « D. Essugo », comme les noms courts d'ESPN (un seul nom reste tel quel : « Oso »). */
const initial = (name) => {
  const [first, ...rest] = String(name ?? '').trim().split(/\s+/);
  return clip(rest.length ? `${first[0]}. ${rest.join(' ')}` : first, 30) || null;
};

/** Le côté d'une équipe d'après son identifiant ESPN ('home' | 'away'), ou null. */
function sides(competition) {
  const byTeam = new Map((competition.competitors ?? []).map((c) => [String(c.team?.id ?? c.id), c.homeAway]));
  return (teamId) => byTeam.get(String(teamId)) ?? null;
}
const competitorOf = (competition, homeAway) => competition.competitors?.find((c) => c.homeAway === homeAway);

// ——— Chronologie : buts et cartons (foot), essais, transformations, pénalités, drops et cartons (rugby)

function soccerKind(d) {
  if (d.shootout) return null; // la séance de tirs au but se lit dans le chrono (« Terminé (t.a.b.) »)
  if (d.scoringPlay) return { kind: 'goal', note: d.ownGoal ? 'csc' : d.penaltyKick ? 'pen' : null };
  if (d.redCard) return { kind: 'red' };
  if (d.yellowCard) return { kind: 'yellow' };
  if (/penalty - (missed|saved)/i.test(d.type?.text ?? '')) return { kind: 'miss' };
  return null;
}

const RUGBY = [
  [/^penalty try/, 'try', 'pénalité'], [/^try/, 'try'], [/^conversion/, 'conv'], [/^penalty goal/, 'pen'],
  [/^(drop goal|field goal)/, 'drop'], [/^yellow card/, 'yellow'], [/^red card/, 'red'],
];
function rugbyKind(d) {
  const text = (d.type?.text ?? '').toLowerCase();
  const found = RUGBY.find(([pattern]) => pattern.test(text));
  return found ? { kind: found[1], note: found[2] ?? null } : null;
}

function timeline(competition, read) {
  const sideOf = sides(competition);
  return (competition.details ?? []).flatMap((d) => {
    const found = read(d);
    const side = sideOf(d.team?.id);
    if (!found || !side) return [];
    return [{ t: d.clock?.displayValue ?? '', side, kind: found.kind, who: who(d), note: found.note ?? null }];
  }).slice(0, MAX_EVENTS);
}

// ——— Scores par période, statistiques d'équipe, meilleurs joueurs

/**
 * Scores par quart-temps, période ou manche ; au-delà des regular périodes : « Prol. », puis extra (« T.a.b. » au
 * hockey) ou « Prol. 2 »… Sans regular (baseball) : manches 10, 11…
 */
function periods(competition, regular, extra = []) {
  const home = competitorOf(competition, 'home')?.linescores ?? [];
  const away = competitorOf(competition, 'away')?.linescores ?? [];
  if (!home.length || home.length !== away.length) return null;
  const score = (l) => num(l.value) ?? 0;
  const label = (l, i) => {
    if (!regular || i < regular) return String(l.period ?? i + 1);
    const n = i - regular;
    return n === 0 ? 'Prol.' : extra[n - 1] ?? `Prol. ${n + 1}`;
  };
  return { head: home.map(label), home: home.map(score), away: away.map(score) };
}

const statOf = (c, name) => num(c?.statistics?.find((s) => s.name === name)?.displayValue);

/** Statistiques comparées : [nom ESPN, libellé, pourcentage ?] gardées si les deux équipes en ont une. */
function stats(competition, list) {
  const [h, a] = [competitorOf(competition, 'home'), competitorOf(competition, 'away')];
  return list.flatMap(([name, label, pct = false]) => {
    const home = statOf(h, name);
    const away = statOf(a, name);
    return home == null || away == null ? [] : [{ label, home, away, pct }];
  });
}

/** Meilleur joueur de chaque équipe dans chaque catégorie (basket, hockey). */
function teamLeaders(competition, list) {
  return list.flatMap(([name, label]) => ['home', 'away'].flatMap((side) => {
    const best = competitorOf(competition, side)?.leaders?.find((l) => l.name === name)?.leaders?.[0];
    const athlete = best?.athlete?.shortName || best?.athlete?.displayName;
    return athlete ? [{ label, side, who: clip(athlete, 30), value: clip(String(best.displayValue ?? ''), 40) }] : [];
  }));
}

// Football américain : un meneur par catégorie pour tout le match, avec son équipe ; ses chiffres en français.
const NFL_LEADERS = [['passingYards', 'Passes'], ['rushingYards', 'Courses'], ['receivingYards', 'Réceptions']];
const nflLine = (text) => text.replace(/\bYDS\b/g, 'yards').replace(/\bCAR\b/g, 'courses').replace(/\bREC\b/g, 'réceptions');
function gameLeaders(competition) {
  const sideOf = sides(competition);
  return NFL_LEADERS.flatMap(([name, label]) => {
    const best = competition.leaders?.find((l) => l.name === name)?.leaders?.[0];
    const side = sideOf(best?.team?.id);
    const athlete = best?.athlete?.shortName || best?.athlete?.displayName;
    return athlete && side ? [{ label, side, who: clip(athlete, 30), value: clip(nflLine(String(best.displayValue ?? '')), 50) }] : [];
  });
}

// ——— Où en est l'action (pendant le match)

function nflSituation(competition) {
  const s = competition.situation;
  if (!s) return null;
  const attack = competition.competitors?.find((c) => String(c.team?.id ?? c.id) === String(s.possession));
  const down = num(s.down);
  const distance = num(s.distance);
  return [
    attack?.team?.abbreviation ? `🏈 ${attack.team.abbreviation} en attaque` : null,
    down > 0 && distance != null ? `${nth(down, true)} tentative, ${distance} yard${distance > 1 ? 's' : ''} à faire` : null,
    s.possessionText ? `ballon sur ${s.possessionText}` : null,
    s.isRedZone ? 'zone rouge' : null,
  ].filter(Boolean).join(' · ') || null;
}

function baseballSituation(competition) {
  const s = competition.situation;
  if (!s) return null;
  const outs = num(s.outs);
  const bases = [s.onFirst && '1re', s.onSecond && '2e', s.onThird && '3e'].filter(Boolean);
  return [
    outs != null ? `${outs} retrait${outs > 1 ? 's' : ''}` : null,
    bases.length ? `coureur${bases.length > 1 ? 's' : ''} en ${bases.join(', ')}` : 'bases vides',
    num(s.balls) != null && num(s.strikes) != null ? `compte ${s.balls}-${s.strikes}` : null,
  ].filter(Boolean).join(' · ');
}

// ——— Sport par sport

const SOCCER_STATS = [['possessionPct', 'Possession', true], ['totalShots', 'Tirs'], ['shotsOnTarget', 'Tirs cadrés'], ['wonCorners', 'Corners'], ['foulsCommitted', 'Fautes']];
const BASKET_STATS = [['fieldGoalPct', 'Adresse aux tirs', true], ['threePointFieldGoalPct', 'À 3 points', true], ['freeThrowPct', 'Lancers francs', true], ['rebounds', 'Rebonds'], ['assists', 'Passes décisives']];
const BASKET_LEADERS = [['points', 'Points'], ['rebounds', 'Rebonds'], ['assists', 'Passes déc.']];
const HOCKEY_LEADERS = [['goals', 'Buts'], ['assists', 'Passes'], ['points', 'Points']];

/** Cartons de chaque équipe, d'après la chronologie (foot, rugby). */
function cardStats(events) {
  const count = (kind, side) => events.filter((e) => e.kind === kind && e.side === side).length;
  return [['yellow', 'Cartons jaunes'], ['red', 'Cartons rouges']].flatMap(([kind, label]) => {
    const [home, away] = [count(kind, 'home'), count(kind, 'away')];
    return home + away ? [{ label, home, away, pct: false }] : [];
  });
}

/** Hockey : tirs cadrés de chaque équipe = ses buts + les arrêts du gardien adverse ; arrêts et % d'arrêts. */
function hockeyStats(competition) {
  const [h, a] = [competitorOf(competition, 'home'), competitorOf(competition, 'away')];
  const [hs, as, hSaves, aSaves] = [num(h?.score), num(a?.score), statOf(h, 'saves'), statOf(a, 'saves')];
  const out = [];
  if ([hs, as, hSaves, aSaves].every((n) => n != null)) out.push({ label: 'Tirs cadrés', home: hs + aSaves, away: as + hSaves, pct: false });
  if (hSaves != null && aSaves != null) out.push({ label: 'Arrêts', home: hSaves, away: aSaves, pct: false });
  const [hp, ap] = [statOf(h, 'savePct'), statOf(a, 'savePct')];
  if (hp != null && ap != null) out.push({ label: '% d’arrêts', home: Math.round(hp * 1000) / 10, away: Math.round(ap * 1000) / 10, pct: true });
  return out;
}

const READERS = {
  soccer(c) {
    const events = timeline(c, soccerKind);
    return { events, stats: [...stats(c, SOCCER_STATS), ...cardStats(events)] };
  },
  rugby(c) {
    const events = timeline(c, rugbyKind);
    return { events, stats: cardStats(events) };
  },
  nfl: (c, state) => ({ periods: periods(c, 4), leaders: gameLeaders(c), situation: state === 'in' ? nflSituation(c) : null }),
  basket: (c) => ({ periods: periods(c, 4), stats: stats(c, BASKET_STATS), leaders: teamLeaders(c, BASKET_LEADERS) }),
  hockey: (c) => ({ periods: periods(c, 3, ['T.a.b.']), stats: hockeyStats(c), leaders: teamLeaders(c, HOCKEY_LEADERS) }),
  baseball(c, state) {
    const line = periods(c, null);
    const [h, a] = [competitorOf(c, 'home'), competitorOf(c, 'away')];
    if (line) line.extra = [['C', num(h?.hits), num(a?.hits)], ['E', num(h?.errors), num(a?.errors)]].filter(([, x, y]) => x != null && y != null);
    return { periods: line, situation: state === 'in' ? baseballSituation(c) : null };
  },
  afl: (c) => ({ periods: periods(c, 4) }),
};

/**
 * Les faits d'une rencontre à deux équipes, selon le sport (kind : soccer, rugby, nfl, basket, hockey, baseball, afl) ;
 * seuls les champs connus sont rendus (rien avant le coup d'envoi).
 */
export function teamFacts(competition, kind, state) {
  const read = READERS[kind];
  if (!read || !competition || state === 'pre') return {};
  return Object.fromEntries(Object.entries(read(competition, state)).filter(([, v]) => (Array.isArray(v) ? v.length : v != null)));
}

// ——— Ce que seul le résumé du match donne (une requête de plus par match en cours : espn.js)

/** Foot : le passeur de chaque but (« … Assisted by Oso. »), à poser sur les buts lus dans le tableau du jour. */
function soccerAssists(summary, sideOf) {
  return (summary.keyEvents ?? []).flatMap((e) => {
    const side = sideOf(e.team?.id);
    if (!e.scoringPlay || e.shootout || !side) return [];
    const assist = /assisted by/i.test(e.text ?? '') ? initial(e.participants?.[1]?.athlete?.displayName) : null;
    return [{ side, t: e.clock?.displayValue ?? '', assist }];
  });
}

function withAssists(events, goals) {
  const left = [...goals];
  return events.map((e) => {
    const i = e.kind === 'goal' ? left.findIndex((g) => g.side === e.side && g.t === e.t) : -1;
    if (i < 0) return e;
    const [goal] = left.splice(i, 1);
    return goal.assist ? { ...e, assists: [goal.assist] } : e;
  });
}

// Football américain : l'action qui marque, d'après son texte (« Tucker Kraft 12 Yd pass from Jordan Love (Trey Smack
// PAT Failed) »), avec ce qui suit un touchdown quand ce n'est pas la transformation réussie habituelle.
const NFL_KINDS = { TD: 'td', FG: 'fg', SF: 'safety', D2P: 'd2p' };
const yards = (n) => `${n} yard${Number(n) > 1 ? 's' : ''}`;
const RETURNS = {
  'interception return': 'retour d’interception', 'fumble return': 'retour de fumble', 'fumble recovery': 'fumble récupéré',
  'punt return': 'retour de punt', 'kickoff return': 'retour de coup d’envoi', 'blocked punt return': 'retour de punt contré',
  'blocked field goal return': 'retour de field goal contré', 'missed field goal return': 'retour de field goal manqué',
};
const NFL_PLAYS = [
  [/^(.+?) (\d+) Yds? pass from (.+)$/i, (m) => [m[1], `passe de ${initial(m[3])}, ${yards(m[2])}`]],
  [/^(.+?) (\d+) Yds? (?:Rush|Run)$/i, (m) => [m[1], `course de ${yards(m[2])}`]],
  [/^(.+?) (\d+) Yds? Field Goal$/i, (m) => [m[1], yards(m[2])]],
  [new RegExp(`^(.+?) (\\d+) Yds? (${Object.keys(RETURNS).join('|')})$`, 'i'), (m) => [m[1], `${RETURNS[m[3].toLowerCase()]}, ${yards(m[2])}`]],
  [/^(.+?) Defensive (?:PAT|Two-Point) Conversion$/i, (m) => [m[1], null]],
  [/^(?!Team\b)(.+?) Safety$/i, (m) => [m[1], null]],
];
function afterTouchdown(extra) {
  if (/two-point/i.test(extra)) return /failed/i.test(extra) ? 'conversion à 2 points manquée' : 'conversion à 2 points réussie';
  return /blocked|failed|no good|missed/i.test(extra) ? 'transformation manquée' : null;
}
function nflPlay(text) {
  const [main, ...extras] = text.split(' (');
  // « X 2 Yd Rush X Fumble Y 0 Yd Fumble Recovery » : c'est Y qui marque.
  const play = main.split(/\bFumble\b(?! (?:Return|Recovery))/).at(-1).trim();
  let found = null;
  for (const [pattern, read] of NFL_PLAYS) {
    const m = pattern.exec(play);
    if (m) {
      found = read(m);
      break;
    }
  }
  const after = extras.length ? afterTouchdown(extras.at(-1)) : null;
  return { who: found ? initial(found[0]) : null, note: [found?.[1], after].filter(Boolean).join(' · ') || null };
}
const quarter = (n) => (n <= 4 ? `${nth(n)} QT` : n === 5 ? 'Prol.' : `Prol. ${n - 4}`);

function nflEvents(summary, sideOf) {
  return (summary.scoringPlays ?? []).flatMap((p) => {
    const side = sideOf(p.team?.id);
    const n = num(p.period?.number);
    if (!side || !n) return [];
    const kind = NFL_KINDS[p.scoringType?.abbreviation ?? p.type?.abbreviation] ?? 'td';
    return [{ t: `${quarter(n)} · ${p.clock?.displayValue ?? ''}`, side, kind, ...nflPlay(String(p.text ?? '').trim()) }];
  }).slice(0, MAX_EVENTS);
}

// Hockey : buts (passeurs ; supériorité, infériorité numérique, filet désert) et pénalités (la faute en français).
const STRENGTH = { 'power-play': 'pp', 'short-handed': 'sh', 'empty-net': 'en' };
const INFRACTIONS = [
  [/^trip/i, 'faire trébucher'], [/^rough/i, 'rudesse'], [/^holding the stick/i, 'retenir le bâton'], [/^hold/i, 'retenue'],
  [/^hook/i, 'accrocher'], [/^slash/i, 'cingler'], [/^high.?stick/i, 'bâton élevé'], [/^cross.?check/i, 'double-échec'],
  [/goalkeeper interference|goaltender interference|interference - goal/i, 'obstruction sur le gardien'], [/^interfer/i, 'obstruction'],
  [/^board/i, 'mise en échec contre la bande'], [/^charg/i, 'charge'], [/^fight/i, 'bagarre'], [/^game misconduct/i, 'inconduite de match'],
  [/^instigator/i, 'instigateur'], [/misconduct/i, 'inconduite'], [/^embellish|^div/i, 'simulation'], [/^elbow/i, 'coup de coude'],
  [/^knee/i, 'coup de genou'], [/^unsportsman/i, 'conduite antisportive'], [/^too many men/i, 'trop de joueurs sur la glace'],
  [/^delay/i, 'retarder le match'], [/^broken stick/i, 'bâton brisé'], [/^abuse of official/i, 'abus envers un officiel'],
  [/^closing hand/i, 'main refermée sur la rondelle'], [/^spear/i, 'darder'], [/^butt.?end/i, 'six-pouces'],
  [/^head.?butt/i, 'coup de tête'], [/check to (the )?head/i, 'coup à la tête'], [/^clip/i, 'coup bas'],
  [/^throw/i, 'lancer son bâton'], [/penalty shot/i, 'faute sur une échappée'],
];
const infraction = (text) => INFRACTIONS.find(([pattern]) => pattern.test(text))?.[1] ?? clip(String(text).toLowerCase(), 40);
/** Période d'une action au hockey : « 1re », « 2e », « 3e », « Prol. », « Prol. 2 » (séries) ; null en tirs au but. */
function hockeyPeriod(period) {
  const n = num(period?.number);
  if (!n || period?.displayValue === 'SO') return null;
  return n <= 3 ? nth(n, true) : n === 4 ? 'Prol.' : `Prol. ${n - 3}`;
}

function hockeyEvents(summary, sideOf) {
  return (summary.plays ?? []).flatMap((p) => {
    const period = hockeyPeriod(p.period);
    const side = sideOf(p.team?.id);
    const minutes = num(p.type?.penaltyMinutes);
    if (!period || !side || (!p.scoringPlay && minutes == null)) return [];
    const t = `${period} · ${p.clock?.displayValue ?? ''}`;
    const named = (type) => (p.participants ?? []).filter((x) => x.type === type).map((x) => initial(x.athlete?.shortName || x.athlete?.displayName)).filter(Boolean);
    if (p.scoringPlay) {
      const assists = named('assister');
      return [{ t, side, kind: 'puck', who: named('scorer')[0] ?? null, note: STRENGTH[p.strength?.abbreviation] ?? null, ...(assists.length ? { assists } : {}) }];
    }
    // Pénalité de banc (« trop de joueurs sur la glace ») : personne n'est nommé.
    const athlete = p.participants?.[0]?.athlete;
    return [{ t, side, kind: 'penalty', who: athlete ? initial(athlete.shortName || athlete.displayName) : null, note: [infraction(p.type?.text ?? ''), minutes ? `${minutes} min` : null].filter(Boolean).join(', ') }];
  }).slice(0, MAX_EVENTS);
}

/** Les sports dont le résumé du match ajoute des faits. */
export const SUMMARY_FACTS = new Set(['soccer', 'nfl', 'hockey']);

/**
 * Ce que seul le résumé d'un match donne (kind : soccer, nfl, hockey) : { assists } (foot) ou { events } (football
 * américain, hockey) ; null pour les autres sports ou un résumé illisible. withSummary les ajoute au direct.
 */
export function summaryFacts(summary, kind) {
  const competition = summary?.header?.competitions?.[0];
  if (!competition || !SUMMARY_FACTS.has(kind)) return null;
  const sideOf = sides(competition);
  if (kind === 'soccer') return { assists: soccerAssists(summary, sideOf) };
  return { events: kind === 'nfl' ? nflEvents(summary, sideOf) : hockeyEvents(summary, sideOf) };
}

/** Le direct complété par le résumé (summaryFacts) : passeurs posés sur les buts déjà lus, ou chronologie du résumé. */
export function withSummary(live, extra) {
  if (extra?.assists) return live.events?.length ? { ...live, events: withAssists(live.events, extra.assists) } : live;
  return extra?.events?.length ? { ...live, events: extra.events } : live;
}

// ——— MMA

const METHODS = [['Submission', 'Soumission'], ['Kotko', 'KO/TKO']];

/**
 * Comment s'est fini un combat : « KO/TKO au 3e round (3:20) », « Soumission au 2e round (1:25) », « Décision après
 * 3 rounds ». ESPN annonce parfois aussi une « décision » pour un combat fini avant la limite : le chrono tranche.
 */
export function fightFinish(fight) {
  const status = fight?.status ?? {};
  if (status.type?.state !== 'post') return null;
  const types = (fight.details ?? []).map((d) => d.type?.text ?? '').filter((t) => /^Unofficial Winner/i.test(t));
  const round = num(status.period);
  const clock = status.displayClock;
  const early = clock && clock !== '5:00';
  for (const [word, label] of METHODS) {
    const named = types.some((t) => t.includes(word));
    if (named && (early || !types.some((t) => t.includes('Decision')))) return round ? `${label} au ${nth(round)} round${clock ? ` (${clock})` : ''}` : label;
  }
  if (types.some((t) => t.includes('Decision'))) return round ? `Décision après ${round} rounds` : 'Décision';
  return null;
}
