// « Direct » : les rencontres et les paris du jour (hier, aujourd'hui, demain) avec les scores en direct (buteurs,
// essais, cartons rouges, situation de jeu) et où en sont mes pronostics. Se rafraîchit toute seule : toutes les 30 secondes pendant un match, toutes les 2 minutes sinon.
import { get } from '../api.js';
import { cls, fill, h } from '../dom.js';
import { now, signedPts, syncClock } from '../format.js';
import { ctx } from '../state.js';
import { pref, setPref } from '../store.js';
import { empty, meLink } from '../ui.js';
import { shortLabel, statusChip } from './cards.js';
import { factsLine } from './facts.js';
import { dayKey, isLive, isOver, kickoff, matchVisual, pickState } from './match.js';

const DAY = 24 * 3_600_000;
const DAYS = [['-1', 'Hier'], ['0', 'Aujourd’hui'], ['1', 'Demain']];

/** Une ligne de la page : la rencontre (ou la question), mon pronostic et où il en est. */
function row(bet) {
  const mine = bet.options.find((o) => o.id === bet.myPick);
  const state = pickState(bet);
  // Mon choix se voit sur le match lui-même (l'équipe entourée, « Ton choix ») ; sinon (course, autre pilote, pari sans
  // rencontre), une pastille.
  const versus = bet.event?.layout === 'versus';
  const onVisual = mine && versus && (mine.key === 'draw' || bet.event.competitors.some((c) => c.key === mine.key));
  const visual = matchVisual(bet, { mine: onVisual ? mine.key : null });
  return h('a.live-row', { href: `/g/${ctx.gid}/bet/${bet.id}`, class: cls(isLive(bet) && 'is-live', state && `ps-${state}`), dataset: { betId: bet.id } },
    h('div.live-row-top', h('span.cat', `${bet.ranking.emoji} ${bet.ranking.label}`), statusChip(bet)),
    visual && bet.event.layout === 'field' ? h('p.bet-q', bet.question) : null,
    visual ?? h('p.bet-q', bet.question),
    visual ? factsLine(bet) : null,
    h('div.live-row-foot',
      mine ? (onVisual ? null : h('span.mine-pill', h('span.mine-badge', 'Ton choix'), h('b', shortLabel(bet, mine))))
        : bet.can.pick ? h('span.tag.t-todo', 'Tu n’as pas parié') : h('span.muted', 'Pas de prono'),
      state ? h('span.pick-state', { class: `ps-${state}` }, { winning: '👍 passe', losing: '👎 ne passe pas', won: '✅ bien vu', lost: '❌ raté' }[state]) : null,
      bet.status === 'settled' && bet.myPoints ? h('span.tag.t-ok', signedPts(bet.myPoints)) : null));
}

/** Le bilan de mes pronostics du jour : joués, qui passent en ce moment, bien vus, points gagnés. */
function summary(bets) {
  const played = bets.filter((b) => b.myPick);
  const states = played.map(pickState);
  const count = (s) => states.filter((x) => x === s).length;
  const points = bets.filter((b) => b.status === 'settled').reduce((sum, b) => sum + (b.myPoints ?? 0), 0);
  const tile = (value, label, mod) => h('div.live-stat', { class: mod }, h('b', String(value)), h('span', label));
  return h('section.live-summary', { 'aria-label': 'Mes pronostics du jour' },
    tile(`${played.length}/${bets.length}`, 'joués'),
    tile(count('winning'), 'passent', 'up'),
    tile(count('won'), 'bien vus', 'good'),
    tile(points ? signedPts(points) : '0', 'gagnés', 'pts'));
}

export async function liveView() {
  const node = h('main.live');
  let day = pref(`live-day:${ctx.gid}`, '0');
  let data = null;

  function draw() {
    const today = dayKey(now());
    const target = dayKey(now() + Number(day) * DAY);
    const bets = data.bets.filter((b) => b.source && dayKey(b.closesAt) === target)
      .sort((a, b) => a.closesAt - b.closesAt);
    const live = bets.filter(isLive);
    const done = bets.filter((b) => !isLive(b) && (isOver(b) || b.status === 'cancelled'));
    const coming = bets.filter((b) => !live.includes(b) && !done.includes(b));
    const section = (title, emoji, list, mod) => (list.length ? h('section.section', { class: mod },
      h('h2.section-title', h('span', { 'aria-hidden': 'true' }, emoji), ` ${title}`, h('span.count', String(list.length))),
      h('div.cards', list.map(row))) : null);
    fill(node,
      h('header.topbar', h('h1', h('span.live-dot', { 'aria-hidden': 'true' }), ' Direct'),
        h('small.muted.topbar-sub', target === today ? `Mis à jour à ${kickoff(now())}` : ''), meLink()),
      h('div.chips', { role: 'toolbar', 'aria-label': 'Jour' }, DAYS.map(([id, label]) => h('button.chip', {
        type: 'button', 'aria-pressed': String(day === id),
        onclick: () => { day = id; setPref(`live-day:${ctx.gid}`, id); draw(); },
      }, label))),
      bets.length ? summary(bets) : null,
      bets.length ? [
        section('En direct', '🔴', live, 'is-live'),
        section(day === '1' ? 'Au programme' : 'À venir', '⏭️', coming),
        section('Terminés', '🏁', done.reverse()),
      ] : empty('📺', day === '1' ? 'Rien de prévu demain' : day === '-1' ? 'Rien hier' : 'Pas de match aujourd’hui',
        'Les matchs et courses des compétitions que tu suis s’affichent ici, avec les scores en direct.',
        h('a.btn', { href: `/g/${ctx.gid}/follow` }, '🏟️ Mes compétitions')));
  }

  async function refresh() {
    data = await get(`/groups/${ctx.gid}/bets`);
    syncClock(data.now);
    draw();
  }
  await refresh();
  // Pendant un match, toutes les 30 s ; sinon toutes les 2 minutes (un coup d'envoi passe en direct tout seul).
  let timer = null;
  const schedule = () => {
    timer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await refresh().catch(() => {});
      schedule();
    }, data.bets.some(isLive) ? 30_000 : 120_000);
  };
  schedule();
  return { node, tab: 'live', refreshable: true, cleanup: () => clearTimeout(timer) };
}
