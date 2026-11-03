// Les faits d'un match au-delà du score (src/sources/facts.js) : chronologie (buts, cartons, essais), situation de jeu,
// fin d'un combat, scores par période, statistiques comparées, meilleurs joueurs, classement complet d'une course.
// matchFacts : le bloc « Le match » de la fiche d'un pari ; factsLine : la ligne courte sous un match de la page Direct.
import { cls, h } from '../dom.js';

const KINDS = {
  goal: ['⚽', 'But'], miss: ['❌', 'Penalty manqué'], yellow: ['🟨', 'Carton jaune'], red: ['🟥', 'Carton rouge'],
  try: ['🏉', 'Essai'], conv: ['🎯', 'Transformation'], pen: ['🎯', 'Pénalité'], drop: ['🦶', 'Drop'],
  td: ['🏈', 'Touchdown'], fg: ['🎯', 'Field goal'], safety: ['🛡️', 'Safety'], d2p: ['🛡️', 'Conversion défensive'],
  puck: ['🏒', 'But'], penalty: ['⏱️', 'Pénalité'],
};
const NOTES = { pen: 'pen.', csc: 'c.s.c.', pénalité: 'de pénalité', pp: 'sup. num.', sh: 'inf. num.', en: 'filet désert' };
// L'icône seule ne dit pas l'action (rugby, football américain, pénalité au hockey) : on l'écrit.
const SPELLED = new Set(['conv', 'pen', 'drop', 'miss', 'td', 'fg', 'safety', 'd2p', 'penalty']);
const assistText = (e) => (e.assists?.length ? `${e.assists.length > 1 ? 'passes' : 'passe'} : ${e.assists.join(', ')}` : null);

const sideName = (bet, side) => bet.event.competitors.find((c) => c.key === side)?.name ?? '';
const number = (v, pct) => (pct ? `${Math.round(v)} %` : String(v));

/** Une ligne de la chronologie : l'action du côté de son équipe (domicile à gauche), la minute au milieu. */
function eventRow(bet, e) {
  const [icon, label] = KINDS[e.kind] ?? ['•', e.kind];
  const note = e.note ? NOTES[e.note] ?? e.note : null;
  const assists = assistText(e);
  const action = h('span.fx-action',
    h('span.fx-icon', { 'aria-hidden': 'true' }, icon),
    h('span.fx-who', e.who ?? label),
    e.who && SPELLED.has(e.kind) ? h('small.muted', ` ${label.toLowerCase()}`) : null,
    note ? h('small.muted', ` (${note})`) : null,
    assists ? h('small.fx-assist', assists) : null);
  return h('li.fx-event', { class: `fx-${e.side} k-${e.kind}`, 'aria-label': `${e.t} : ${label}${e.who ? `, ${e.who}` : ''}${note ? ` (${note})` : ''}${assists ? `, ${assists}` : ''}, ${sideName(bet, e.side)}` },
    h('span.fx-cell.home', e.side === 'home' ? action : null),
    // « 1er QT · 11:43 », « 1re · 6:04 » : la période au-dessus du temps, pour laisser la place aux actions.
    h('span.fx-minute', e.t.split(' · ').flatMap((part, i) => (i ? [h('br'), part] : [part]))),
    h('span.fx-cell.away', e.side === 'away' ? action : null));
}

/** Scores par période : une ligne par équipe, avec coups sûrs et erreurs au baseball, et le total. */
function periodsTable(bet, periods) {
  const [a, b] = bet.event.competitors;
  const scores = bet.event.live.scores ?? {};
  const extra = periods.extra ?? [];
  const row = (c, values, side) => h('tr',
    h('th', { scope: 'row' }, c.abbr || c.name),
    values.map((v) => h('td', String(v))),
    extra.map((x) => h('td.fx-extra', String(x[side === 'home' ? 1 : 2]))),
    h('td.fx-total', scores[c.key] != null ? String(scores[c.key]) : '–'));
  return h('div.fx-scroll', h('table.fx-periods',
    h('thead', h('tr', h('th', { scope: 'col' }, h('span.sr-only', 'Équipe')), periods.head.map((p) => h('th', { scope: 'col' }, p)),
      extra.map((x) => h('th.fx-extra', { scope: 'col', title: { C: 'Coups sûrs', E: 'Erreurs' }[x[0]] ?? x[0] }, x[0])), h('th.fx-total', { scope: 'col' }, 'Total'))),
    h('tbody', row(a, periods.home, 'home'), row(b, periods.away, 'away'))));
}

/** Une statistique comparée : les deux valeurs et une barre partagée en proportion. */
function statRow(s) {
  const total = s.home + s.away;
  const share = total > 0 ? Math.round((s.home / total) * 100) : 50;
  const bar = h('span.fx-bar', { 'aria-hidden': 'true' }, h('span.fx-bar-home'));
  bar.firstChild.style.width = `${share}%`;
  return h('li.fx-stat',
    h('span.fx-stat-line', h('b', { class: cls(s.home > s.away && 'lead') }, number(s.home, s.pct)), h('span.fx-stat-label', s.label), h('b', { class: cls(s.away > s.home && 'lead') }, number(s.away, s.pct))),
    bar);
}

/** Meilleurs joueurs : par catégorie, celui de chaque équipe (basket, hockey) ou du match (football américain). */
function leadersList(bet, leaders) {
  const labels = [...new Set(leaders.map((l) => l.label))];
  const cell = (l) => (l ? [h('b', l.who), ' ', h('small.muted', l.value)] : null);
  return h('ul.fx-leaders', labels.map((label) => {
    const of = (side) => leaders.find((l) => l.label === label && l.side === side);
    return h('li.fx-leader', h('span.fx-cell.home', cell(of('home'))), h('span.fx-leader-label', label), h('span.fx-cell.away', cell(of('away'))));
  }));
}

/** Le classement complet d'une course : place, pilote et équipe, écart, places gagnées depuis la grille ; puis les abandons. */
function rankingList(live) {
  const row = (r) => {
    const delta = r.pos && r.grid > 0 ? r.grid - r.pos : null;
    return h('li.fx-rank', { class: cls(r.out && 'is-out') },
      h('span.fx-pos', r.pos ? String(r.pos) : '–'),
      h('span.fx-driver', h('b', r.name), r.team ? h('small.muted', r.team) : null),
      h('span.fx-gap', r.out ?? r.gap ?? ''),
      r.grid === 0 && r.pos ? h('span.fx-grid', { title: 'Parti des stands' }, 'stands')
        : delta ? h('span.fx-grid', { class: delta > 0 ? 'up' : 'down', title: `Parti ${r.grid}e` }, `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`) : h('span.fx-grid'));
  };
  const top = live.ranking.slice(0, 10);
  const rest = live.ranking.slice(10);
  return [
    h('ol.fx-ranking', top.map(row)),
    rest.length ? h('details.fx-more', h('summary', `Tout le classement (${live.ranking.length})`), h('ol.fx-ranking', rest.map(row))) : null,
    live.fastest ? h('p.fx-fastest', '⏱️ Meilleur tour : ', h('b', live.fastest.name), `, ${live.fastest.time}${live.fastest.lap ? ` (tour ${live.fastest.lap})` : ''}`) : null,
  ];
}

/** Le bloc « Le match » (ou « Classement » d'une course) de la fiche d'un pari ; null s'il n'y a rien à dire. */
export function matchFacts(bet) {
  const live = bet.event?.live;
  const records = bet.event?.competitors?.filter((c) => c.record) ?? [];
  if (!live && !records.length) return null;
  const parts = [
    live?.state === 'in' && live.situation ? h('p.fx-situation', h('span.live-dot', { 'aria-hidden': 'true' }), live.situation) : null,
    live?.finish ? h('p.fx-finish', '🏁 ', live.finish) : null,
    records.length === 2 ? h('p.fx-records', h('span.muted', 'Bilans (V-D-N) : '), records.map((c, i) => [i ? ' · ' : '', h('b', c.name), ` ${c.record}`])) : null,
    live?.events?.length ? h('ol.fx-timeline', live.events.map((e) => eventRow(bet, e))) : null,
    live?.periods ? periodsTable(bet, live.periods) : null,
    live?.stats?.length ? h('ul.fx-stats', live.stats.map(statRow)) : null,
    live?.leaders?.length ? leadersList(bet, live.leaders) : null,
    live?.ranking?.length ? rankingList(live) : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const race = !!live?.ranking?.length;
  const [a, b] = bet.event.competitors;
  return h('section.card.facts', { 'aria-label': race ? 'Classement de la course' : 'Le match' },
    h('h2', race ? '🏁 Classement' : '📋 Le match'),
    !race && bet.event.layout === 'versus' && (live?.events?.length || live?.stats?.length || live?.leaders?.length)
      ? h('div.fx-sides', { 'aria-hidden': 'true' }, h('span', a?.name), h('span', b?.name)) : null,
    parts);
}

/**
 * Ce qui compte d'un coup d'œil sous un match de la page Direct : buteurs (foot, hockey), essais, touchdowns et field
 * goals, cartons rouges, situation, fin d'un combat.
 */
export function factsLine(bet) {
  const live = bet.event?.live;
  if (!live || bet.event.layout !== 'versus') return null;
  const events = live.events ?? [];
  const side = (key) => {
    const own = events.filter((e) => e.side === key);
    const count = (kind) => own.filter((e) => e.kind === kind).length;
    const plural = (n, word) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : null);
    // Buteurs regroupés : « ⚽ G. Yassine 77', 85' », « 🏒 A. Frondell 1re 6:04, 2e 3:31 ».
    const scorers = new Map();
    for (const e of own.filter((x) => x.kind === 'goal' || x.kind === 'puck')) {
      const name = `${KINDS[e.kind][0]} ${e.who ?? '?'}`;
      scorers.set(name, [...(scorers.get(name) ?? []), `${e.t.replace(' · ', ' ')}${e.note ? ` (${NOTES[e.note] ?? e.note})` : ''}`]);
    }
    const tries = plural(count('try'), 'essai');
    const tds = plural(count('td'), 'touchdown');
    const fgs = plural(count('fg'), 'field goal');
    const reds = count('red');
    const parts = [
      ...[...scorers].map(([name, times]) => `${name} ${times.join(', ')}`),
      tries ? `🏉 ${tries}` : null,
      tds ? `🏈 ${tds}` : null,
      fgs ? `🎯 ${fgs}` : null,
      reds ? '🟥'.repeat(Math.min(reds, 3)) : null,
    ].filter(Boolean);
    return parts.length ? parts.map((p) => h('span', p)) : null;
  };
  const home = side('home');
  const away = side('away');
  const note = live.state === 'in' && live.situation ? live.situation : live.finish ? `🏁 ${live.finish}` : null;
  if (!home && !away && !note) return null;
  return h('div.fx-line',
    home || away ? h('div.fx-line-sides', h('div.fx-cell.home', home), h('div.fx-cell.away', away)) : null,
    note ? h('p.fx-line-note', note) : null);
}
