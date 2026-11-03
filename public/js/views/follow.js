import { get, post } from '../api.js';
import { fill, h } from '../dom.js';
import { plural } from '../format.js';
import { ctx } from '../state.js';
import { empty, run } from '../ui.js';

/** Une compétition proposée par le groupe, avec mon choix : j'y participe ou non. */
export function feedChoice(feed, onChange) {
  const label = h('span.grow', h('b', `${feed.emoji} ${feed.label}`),
    h('small.muted', [feed.sport, feed.open ? `${plural(feed.open, 'pari ouvert', 'paris ouverts')}` : 'pas de pari ouvert pour l’instant'].filter(Boolean).join(' · ')));
  const set = (choice) => async (e) => {
    if (await run(e.currentTarget, () => post(`/groups/${ctx.gid}/feeds`, { key: feed.key, choice }))) {
      feed.choice = choice;
      onChange?.(feed);
    }
  };
  return h('div.feed-row', { dataset: { feed: feed.key } }, label,
    h('div.row-wrap',
      h('button.btn.small', { type: 'button', class: feed.choice === 'in' ? 'primary' : null, 'aria-pressed': String(feed.choice === 'in'), onclick: set('in') }, 'Je participe'),
      h('button.btn.small', { type: 'button', 'aria-pressed': String(feed.choice === 'out'), onclick: set('out') }, 'Non merci')));
}

/** Mes compétitions : le groupe en propose, je choisis celles dont je veux voir les paris. */
export async function followView() {
  const { feeds } = await get(`/groups/${ctx.gid}/feeds`);
  const list = h('div');
  const draw = () => fill(list, feeds.length
    ? h('section.card', feeds.map((f) => feedChoice(f, draw)))
    : empty('🏟️', 'Aucune compétition proposée', 'Un admin du groupe peut en activer dans ⚙️ Réglages du groupe → Réglages des paris.'));
  draw();
  const node = h('main.follow',
    h('header.topbar', h('a.icon-btn', { href: `/${ctx.gid}/me`, 'aria-label': 'Retour' }, '←'), h('h1', '🏟️ Mes compétitions')),
    h('p.muted', 'Le groupe propose des compétitions : tu choisis celles qui t’intéressent. Leurs paris s’affichent chez toi, les autres restent cachés. Tu peux changer d’avis quand tu veux.'),
    list);
  return { node, tab: 'me' };
}
