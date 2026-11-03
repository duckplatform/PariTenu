import { face } from '../avatars.js';
import { get } from '../api.js';
import { cls, fill, h } from '../dom.js';
import { dateLong, percent, plural, pts, syncClock } from '../format.js';
import { ctx, memberOf, navigate } from '../state.js';
import { pref, setPref } from '../store.js';
import { icon } from '../icons.js';
import { empty, meLink } from '../ui.js';
import { betCard } from './cards.js';

const MEDALS = ['🥇', '🥈', '🥉'];

const champions = (ids) => ids.map((id) => memberOf(id).pseudo).join(' et ');

/** Où en est la saison : en cours, finie (derniers résultats attendus) ou close avec son champion. */
function seasonLine(s) {
  switch (s.state) {
    case 'closed': return s.champions.length
      ? `🏆 ${s.champions.length > 1 ? 'Champions' : 'Champion'} : ${champions(s.champions)} · saison close le ${dateLong(s.closedAt)}`
      : `Saison close le ${dateLong(s.closedAt)}`;
    case 'ending': return `Saison terminée le ${dateLong(s.endsAt)} : ${plural(s.pending, 'résultat attendu', 'résultats attendus')} avant de sacrer le champion.`;
    case 'upcoming': return `Commence le ${dateLong(s.startsAt)}.`;
    default: return `En cours jusqu’au ${dateLong(s.endsAt)} : le meilleur score sera sacré champion, puis tout repart de zéro.`;
  }
}

/**
 * Classements : un par compétition (Ligue 1, NFL…) ou catégorie, saison par saison.
 * /<g>/rank[/<classement>[/<saison>]]
 */
export async function rankView(route) {
  const { now: serverNow, rankings } = await get(`/groups/${ctx.gid}/rankings`);
  syncClock(serverNow);
  const node = h('main.rank');
  if (!rankings.length) {
    node.append(h('header.topbar', h('h1', icon('trophy'), ' Classements'), meLink()),
      empty('🏁', 'Pas encore de classement', 'Chaque compétition (Ligue 1, NFL, F1…) et chaque catégorie a son classement, sur la vraie saison. Ils apparaissent avec les premiers paris.'));
    return { node, tab: 'rank', refreshable: true };
  }
  const wanted = route.arg ? decodeURIComponent(route.arg) : pref(`ranking:${ctx.gid}`, null);
  const current = rankings.find((r) => r.key === wanted) ?? rankings[0];
  const seasonId = route.arg && route.sub ? decodeURIComponent(route.sub) : null;
  const data = await get(`/groups/${ctx.gid}/rankings/${encodeURIComponent(current.key)}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ''}`);
  setPref(`ranking:${ctx.gid}`, current.key);
  const s = data.season;
  const go = (key, season) => navigate(`/${ctx.gid}/rank/${encodeURIComponent(key)}${season ? `/${encodeURIComponent(season)}` : ''}`, { replace: true });

  const chips = h('div.chips.scroll', { role: 'tablist', 'aria-label': 'Classements' }, rankings.map((r) => h('button.chip', {
    type: 'button', role: 'tab', 'aria-selected': String(r.key === current.key), 'aria-pressed': String(r.key === current.key),
    onclick: () => go(r.key),
  }, `${r.emoji} ${r.label}`)));

  const seasonPicker = data.seasons.length > 1 ? h('label.field.season-picker', h('span.label', 'Saison'), h('select', {
    'aria-label': 'Saison', onchange: (e) => go(current.key, e.target.value),
  }, data.seasons.map((x) => h('option', { value: x.id, selected: x.id === s.id }, `${x.label}${x.champions.length ? ` · 🏆 ${champions(x.champions)}` : ''}`)))) : null;

  const rows = s.standings;
  const podium = rows.filter((r) => r.score > 0 && r.rank <= 3).slice(0, 3);
  const betsBox = h('div.cards');
  const showBets = h('button.btn.wide', {
    type: 'button',
    onclick: async () => {
      showBets.disabled = true;
      const { bets } = await get(`/groups/${ctx.gid}/seasons/${encodeURIComponent(s.id)}/bets`);
      showBets.remove();
      fill(betsBox, bets.length ? bets.map((b) => betCard(b)) : h('p.muted', 'Aucun pari dans cette saison.'));
    },
  }, s.bets === 1 ? 'Voir le pari de la saison' : `Voir les ${s.bets} paris de la saison`);

  node.append(
    h('header.topbar', h('h1', icon('trophy'), ' Classements'), meLink()),
    chips,
    h('section.season-head',
      h('h2', `${data.emoji} ${data.label}`, h('span.muted', ` · ${s.label}`)),
      h('p.season-line', { class: cls(s.state === 'closed' && s.champions.length && 'champion') }, seasonLine(s)),
      seasonPicker),
    podium.length ? h('div.podium', podium.map((r) => h('a.podium-step', {
      href: `/${ctx.gid}/members/${r.member.id}`, class: `p${r.rank}`,
    }, h('span.medal', MEDALS[r.rank - 1] ?? ''), h('span.avatar.xl', face(r.member.avatar)), h('b', r.member.pseudo), h('span', pts(r.score))))) : null,
    rows.length
      ? h('ol.rank-list', rows.map((r) => h('li', h('a.rank-row', {
        href: `/${ctx.gid}/members/${r.member.id}`, class: cls(r.member.id === ctx.me.id && 'me'),
      },
      h('span.rank-pos', String(r.rank)),
      h('span.avatar', face(r.member.avatar)),
      h('span.grow', h('b', r.member.pseudo), h('small.muted', ` ${r.played ? `${percent(r.rate)} de réussite · ${plural(r.played, 'pari réglé', 'paris réglés')}` : 'aucun pari réglé'}`)),
      h('span.score', pts(r.score))))))
      : empty('🎯', 'Personne n’a encore joué cette saison', 'Parie sur les paris de cette compétition pour entrer au classement.'),
    h('section.section', h('h2.section-title', icon('scroll'), ' Paris de la saison', h('span.count', String(s.bets))), showBets, betsBox),
    h('p.hint.center', 'Un bon pronostic rapporte 100 × sa cote (celle des bookmakers en sport, celle du groupe entre amis). Chaque compétition a son classement ; à la fin de la vraie saison, le meilleur score est sacré champion et tout repart de zéro.'));
  // « Classement Ligue 1 », ou « Classement Ligue 1 (2025-26) » pour une saison passée.
  return { node, tab: 'rank', refreshable: true, title: `Classement ${current.label}${s.closedAt ? ` (${s.label})` : ''}` };
}
