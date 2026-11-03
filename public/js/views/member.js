import { face } from '../avatars.js';
import { get } from '../api.js';
import { h } from '../dom.js';
import { dateTime, odds, percent, plural, pts, relative, signedPts, syncClock } from '../format.js';
import { ctx } from '../state.js';

const KIND = { gain: 'Bon pronostic', prime: 'Prime d’arbitre', reversal: 'Correction' };
const STATUS = { open: 'ouvert', closed: 'clos', validating: 'en validation', voting: 'vote en cours' };

export async function memberView(route) {
  const { now: serverNow, profile: p } = await get(`/groups/${ctx.gid}/members/${route.arg}`);
  syncClock(serverNow);
  const s = p.stats;
  const stat = (label, value) => h('div.stat', h('b', value), h('span', label));
  const node = h('main.member',
    h('header.topbar', h('a.icon-btn', { href: `/${ctx.gid}/rank`, 'aria-label': 'Retour au classement' }, '←')),
    h('section.profile-head',
      h('div.profile-avatar', face(p.member.avatar)),
      h('h1', p.member.pseudo, p.member.id === ctx.me.id ? h('span.muted', ' (toi)') : null),
      p.member.status !== 'active' ? h('p.muted', 'Ne fait plus partie du groupe.') : null,
      p.titles ? h('p.profile-score', `🏆 ${plural(p.titles, 'titre')} de champion`) : null),
    h('div.stats',
      stat('titres', String(p.titles)),
      stat('de réussite', percent(s.rate)),
      stat('paris réglés', String(s.played)),
      stat('meilleur coup', odds(s.bestOdds)),
      stat('série en cours', String(s.currentStreak)),
      stat('meilleure série', String(s.bestStreak))),
    p.seasons.length ? h('section.card', h('h2', 'Saisons en cours'), h('ul.list', p.seasons.map((x) => h('li', h('a.list-item', {
      href: `/${ctx.gid}/rank/${encodeURIComponent(x.key)}/${encodeURIComponent(x.seasonId)}`,
    }, h('span', { 'aria-hidden': 'true' }, x.emoji), h('span.grow', h('b', x.label), h('small.muted', ` · ${x.season} · ${x.rank}${x.rank === 1 ? 'er' : 'e'} sur ${x.of}`)),
    h('span.score', pts(x.score))))))) : null,
    p.badges.length ? h('section.card', h('h2', 'Badges'), h('ul.badges', p.badges.map((b) => h('li.badge', { title: b.detail ?? b.label },
      h('span.badge-emoji', b.emoji), h('span', b.label), b.detail ? h('small.muted', b.detail) : null)))) : null,
    p.openPicks.length ? h('section.card', h('h2', 'Paris en cours'), h('ul.list', p.openPicks.map((x) => h('li', h('a.list-item', { href: `/${ctx.gid}/bet/${x.betId}` },
      h('span.grow', x.question, h('small.muted', ` · « ${x.optionLabel} » · ${STATUS[x.status]}`)), h('span.chev', '›')))))) : null,
    h('section.card', h('h2', 'Historique'), p.history.length ? h('ul.list', p.history.map((x) => h('li', h('a.list-item', { href: `/${ctx.gid}/bet/${x.betId}` },
      h('span', x.status === 'cancelled' ? '↩️' : x.correct ? '✅' : '❌'),
      h('span.grow', x.question, h('small.muted', ` · « ${x.optionLabel} »`)),
      h('span', { class: x.points ? 'plus' : 'muted' }, x.status === 'cancelled' ? 'annulé' : signedPts(x.points)))))) : h('p.muted', 'Aucun pari terminé pour l’instant.')),
    p.ledger.length ? h('details.card.ledger', h('summary', h('b', 'Relevé de points')),
      h('ul.list', p.ledger.map((l) => h('li.ledger-row',
        h('span.grow', h('b', KIND[l.kind]), h('small.muted', ` · ${l.question}`), h('br'), h('small.muted', `${dateTime(l.createdAt)} (${relative(l.createdAt)})`)),
        h('span', { class: l.amount >= 0 ? 'plus' : 'minus' }, signedPts(l.amount)))))) : null);
  return { node, tab: route.arg === ctx.me.id ? 'me' : 'rank', refreshable: true, title: p.member.id === ctx.me.id ? 'Mon profil' : `Profil de ${p.member.pseudo}` };
}
