// La page Activité : « À la une » (depuis 24 h), puis le fil du groupe jour par jour : résultats en cartes (une par
// compétition et par jour quand il y en a beaucoup), pronostics d'une même personne regroupés, nouveaux paris en une
// ligne, commentaires en bulle. Filtres : tout, résultats, pronos, discussions. Données : /activity (src/services/activity.js).
import { face } from '../avatars.js';
import { get } from '../api.js';
import { cls, fill, h } from '../dom.js';
import { now, odds, pts, signedPts, syncClock } from '../format.js';
import { icon } from '../icons.js';
import { ctx, memberOf } from '../state.js';
import { pref, setPref } from '../store.js';
import { eventLine } from '../texts.js';
import { empty, meLink } from '../ui.js';
import { crest, dayKey } from './match.js';

const DAY = 24 * 3_600_000;
const longDay = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
const hourFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const hour = (ts) => hourFmt.format(new Date(ts)).replace(':', 'h');
const PICK_ROWS = 3; // pronostics montrés avant « + N autres »
const RESULT_ROWS = 3; // résultats montrés avant « Voir les N résultats »

/** « Aujourd’hui », « Hier », « Samedi 1 novembre ». */
function dayTitle(ts) {
  const day = dayKey(ts);
  if (day === dayKey(now())) return 'Aujourd’hui';
  if (day === dayKey(now() - DAY)) return 'Hier';
  const text = longDay.format(new Date(ts)).replace(/^(\S+) 1 /, '$1 1er ');
  return text[0].toUpperCase() + text.slice(1);
}

const FILTERS = [['all', 'Tout'], ['results', 'Résultats'], ['picks', 'Pronos'], ['talk', 'Discussions']];
const LINE_FILTER = { resolved: 'results', cancelled: 'results', corrected: 'results', vote_ended: 'results', contested: 'talk', detail_added: 'talk' };
/** Le filtre d'un élément du fil (null : seulement dans « Tout »). */
function filterOf(item) {
  if (['result', 'results', 'season'].includes(item.kind)) return 'results';
  if (['picks', 'opened'].includes(item.kind)) return 'picks';
  if (item.kind === 'comment') return 'talk';
  return LINE_FILTER[item.event?.type] ?? null;
}

const who = (id) => {
  const m = memberOf(id);
  return [h('span.avatar.xs', { 'aria-hidden': 'true' }, face(m.avatar)), h('b', ` ${m.pseudo}`)];
};
const betLink = (betId, ...content) => h('a.act-bet', { href: `/g/${ctx.gid}/bet/${betId}` }, content);
const meta = (...parts) => h('p.act-meta', parts.filter(Boolean).map((p, i) => [i ? ' · ' : '', p]));

/** Le score d'une rencontre à deux (écussons, noms, score final), sinon son titre. */
function scoreline(result, { small = false } = {}) {
  const [a, b] = result.event?.layout === 'versus' ? result.event.competitors : [];
  if (!a || !b) return h('span.act-title', result.question);
  const score = result.event.scores;
  return h('span.act-score', { class: cls(small && 'small'), 'aria-label': result.question },
    h('span.act-side', crest(a, { size: 'sm' }), h('span', a.name)),
    h('b.num', score && score[a.key] != null ? `${score[a.key]} – ${score[b.key]}` : '–'),
    h('span.act-side.away', h('span', b.name), crest(b, { size: 'sm' })));
}

/** Qui a gagné des points sur un résultat, qui s'est trompé, la prime d'arbitre. */
function outcomeChips(r) {
  return h('div.act-chips',
    r.gains.map((g) => h('span.act-chip.ok', who(g.memberId), ` ${signedPts(g.amount)}`)),
    r.missed.map((id) => h('span.act-chip.miss', who(id), ' raté')),
    r.prime ? h('span.act-chip', '⚖️ ', who(r.prime.memberId), ` ${signedPts(r.prime.amount)}`) : null,
    !r.gains.length && !r.missed.length ? h('span.muted', r.outcome === 'scored' ? '' : 'Personne n’avait vu juste.') : null);
}

function resultCard(r) {
  return h('article.act-card.act-result',
    meta(`${r.ranking.emoji} ${r.ranking.label}`, `réglé à ${hour(r.at)}`),
    betLink(r.betId, scoreline(r)),
    r.winning ? h('p.act-winning', 'Résultat : ', h('b', `« ${r.winning} »`), r.odds ? h('span.muted', ` · cote ${odds(r.odds)}`) : null) : null,
    outcomeChips(r));
}

/** Plusieurs résultats d'une compétition le même jour : le bilan de chacun, puis les résultats (les premiers visibles). */
function resultsCard(g) {
  const row = (r) => {
    const mine = r.gains.find((x) => x.memberId === ctx.me.id);
    const missed = r.missed.includes(ctx.me.id);
    return h('li.act-row', betLink(r.betId, scoreline(r, { small: true })),
      h('span.act-mark', { class: cls(mine && 'ok', missed && 'miss') }, mine ? signedPts(mine.amount) : missed ? 'raté' : '·'));
  };
  const rest = g.results.slice(RESULT_ROWS);
  return h('article.act-card.act-results',
    meta(`${g.ranking.emoji} ${g.ranking.label}`, `${g.results.length} résultats`, `réglés à ${hour(g.at)}`),
    h('div.act-chips', g.players.map((p) => h('span.act-chip', { class: cls(p.points > 0 && 'ok') }, who(p.memberId), ` ${p.won}/${p.played}`, p.points ? ` · ${signedPts(p.points)}` : ''))),
    h('ul.act-rows', g.results.slice(0, RESULT_ROWS).map(row)),
    rest.length ? h('details.act-more', h('summary', `Voir les ${g.results.length} résultats`), h('ul.act-rows', rest.map(row))) : null);
}

/**
 * Les pronostics d'une même personne : chaque pari et son choix (« Oui » seul ne dirait pas sur quoi), les premiers
 * visibles, les autres dans « + N autres ».
 */
function picksCard(item) {
  const row = (p) => h('li.act-row', betLink(p.betId, h('span.act-title', p.question)),
    h('span.act-pick', p.label, p.odds ? h('span.muted', ` ${odds(p.odds)}`) : null, p.changed ? h('small.muted', ' (changé)') : null));
  const many = item.picks.length;
  const rest = item.picks.slice(PICK_ROWS);
  return h('article.act-card.act-picks',
    h('p.act-head', who(item.memberId), many > 1 ? ` a parié sur ${many} paris` : ' a parié', h('time.muted', ` · ${hour(item.at)}`)),
    h('ul.act-rows', item.picks.slice(0, PICK_ROWS).map(row)),
    rest.length ? h('details.act-more', h('summary', `+ ${rest.length} autre${rest.length > 1 ? 's' : ''}`), h('ul.act-rows', rest.map(row))) : null);
}

function openedLine(item) {
  const list = item.rankings.length ? item.rankings.map((r) => `${r.emoji} ${r.label} ${r.n}`).join(', ') : item.labels ?? '';
  return h('div.act-line',
    h('span', { 'aria-hidden': 'true' }, '📡'),
    h('span.grow', h('b', `${item.count} nouveau${item.count > 1 ? 'x' : ''} pari${item.count > 1 ? 's' : ''}`), list ? ` · ${list}` : ''),
    h('a.act-go', { href: `/g/${ctx.gid}` }, 'Parier ›'));
}

function commentCard(item) {
  return h('article.act-card.act-comment',
    h('p.act-head', who(item.memberId), h('span.muted', ' sur '), betLink(item.betId, item.question), h('time.muted', ` · ${hour(item.at)}`)),
    h('p.act-bubble', item.text));
}

function seasonCard(s) {
  const champions = (s.champions ?? []).map((id) => memberOf(id).pseudo).join(' et ');
  return h('article.act-card.act-season',
    h('p.act-head', h('span', { 'aria-hidden': 'true' }, '🏆 '), h('b', `Fin de saison ${s.label}`), ` · ${s.emoji} ${s.name}`),
    h('p', champions ? [h('b', champions), ` ${s.champions.length > 1 ? 'sacrés champions' : 'sacré champion'} avec ${pts(s.score)}`] : 'Pas de champion cette saison.'));
}

function lineItem(item) {
  const e = item.event;
  const text = eventLine(e);
  return h('div.act-line', e.betId ? h('a.grow', { href: `/g/${ctx.gid}/bet/${e.betId}` }, text) : h('span.grow', text), h('time.muted', hour(item.at)));
}

const RENDER = { result: resultCard, results: resultsCard, picks: picksCard, opened: openedLine, comment: commentCard, season: seasonCard, line: lineItem };

/** « À la une » : depuis 24 h, paris réglés, gains, coup de flair, leaders des classements, champions. */
function highlightsCard(hl) {
  if (!hl) return null;
  const flair = hl.flair;
  return h('section.card.act-une', { 'aria-label': 'À la une' },
    h('h2', 'À la une', h('small.muted', ' · depuis 24 h')),
    h('div.act-tiles',
      h('div.act-tile', h('small', 'Paris réglés'), h('b.num', String(hl.settled))),
      hl.gains.map((g) => h('div.act-tile', h('small', memberOf(g.memberId).pseudo), h('b.num.ok', signedPts(g.amount))))),
    flair ? h('p.act-flair', h('span', { 'aria-hidden': 'true' }, '🔥 '), 'Coup de flair : ', h('b', flair.memberIds.map((id) => memberOf(id).pseudo).join(', ')),
      ' sur ', betLink(flair.betId, `« ${flair.label} »`), ` (cote ${odds(flair.odds)}) · ${signedPts(flair.amount)}`) : null,
    hl.leaders.length ? h('div.act-chips', hl.leaders.map((l) => h('a.act-chip', { href: `/g/${ctx.gid}/rank/${encodeURIComponent(l.key)}`, class: cls(l.change && 'hot') },
      `${l.emoji} ${l.label} : `, h('b', memberOf(l.memberId).pseudo), l.change ? ' passe en tête' : ' en tête'))) : null,
    hl.champions.map((c) => h('p.act-flair', '🏆 ', h('b', (c.champions ?? []).map((id) => memberOf(id).pseudo).join(' et ') || 'Pas de champion'), ` · ${c.emoji} ${c.name} ${c.label}`)));
}

export async function activityView() {
  const data = await get(`/groups/${ctx.gid}/activity`);
  syncClock(data.now);
  const node = h('main.activity');
  let filter = pref(`activity:${ctx.gid}`, 'all');

  function draw() {
    const items = data.items.filter((it) => filter === 'all' || filterOf(it) === filter);
    const days = [];
    for (const it of items) {
      const key = dayKey(it.at);
      if (days.at(-1)?.key !== key) days.push({ key, at: it.at, items: [] });
      days.at(-1).items.push(it);
    }
    fill(node,
      h('header.topbar', h('h1', icon('activity'), ' Activité'), meLink()),
      h('div.chips.scroll', { role: 'toolbar', 'aria-label': 'Filtrer le fil' }, FILTERS.map(([id, label]) => h('button.chip', {
        type: 'button', 'aria-pressed': String(filter === id),
        onclick: () => { filter = id; setPref(`activity:${ctx.gid}`, id); draw(); },
      }, label))),
      filter === 'all' || filter === 'results' ? highlightsCard(data.highlights) : null,
      days.length ? days.map((d) => h('section.act-day', h('h2.act-day-title', dayTitle(d.at)), d.items.map((it) => RENDER[it.kind]?.(it))))
        : empty('📣', 'Rien pour l’instant', filter === 'all' ? 'Les paris, les pronostics et les résultats du groupe apparaîtront ici.' : 'Rien de ce côté-là pour le moment.'));
  }
  draw();
  return { node, tab: 'activity', refreshable: true };
}
