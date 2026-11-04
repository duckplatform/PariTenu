import { get, post } from '../api.js';
import { fill, h } from '../dom.js';
import { plural } from '../format.js';
import { toggle } from '../settings-editor.js';
import { ctx } from '../state.js';
import { empty, run } from '../ui.js';

/** Ce qu'on sait d'une compétition : son sport, ses paris ouverts. */
const about = (feed) => [feed.sport, feed.open ? plural(feed.open, 'pari ouvert', 'paris ouverts') : 'pas de pari ouvert pour l’instant']
  .filter(Boolean).join(' · ');

/** Une compétition proposée par le groupe, avec mon choix (l'annonce de l'accueil) : « Je participe » ou « Non merci ». */
export function feedChoice(feed, onChange) {
  const label = h('span.grow', h('b', `${feed.emoji} ${feed.label}`), h('small.muted', about(feed)));
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

/**
 * Une compétition dans « Mes compétitions » : un interrupteur, allumé si j'y participe, éteint sinon (« Non merci », ou
 * pas encore de réponse : c'est dit sous son nom). Demande du 2026-11-04 : « on voit bien quand on participe, mais pas
 * quand on ne participe pas ».
 */
function feedSwitch(feed) {
  const row = toggle({
    label: `${feed.emoji} ${feed.label}`,
    hint: feed.choice == null ? `${about(feed)} · pas encore choisi` : about(feed),
    checked: feed.choice === 'in',
    onchange: async (on) => {
      const input = row.querySelector('input');
      const choice = on ? 'in' : 'out';
      const done = await run(input, () => post(`/groups/${ctx.gid}/feeds`, { key: feed.key, choice }),
        { success: on ? `Tu participes : ${feed.emoji} ${feed.label}.` : `Tu ne participes plus : ${feed.emoji} ${feed.label}.` });
      if (!done) { input.checked = !on; return; }
      feed.choice = choice;
      row.querySelector('.hint').textContent = about(feed);
    },
  });
  row.dataset.feed = feed.key;
  return row;
}

/** Mes compétitions : le groupe en propose, je choisis celles dont je veux voir les paris. */
export async function followView() {
  const { feeds } = await get(`/groups/${ctx.gid}/feeds`);
  const list = h('div');
  const draw = () => fill(list, feeds.length
    ? h('section.card.stack.feed-switches', feeds.map(feedSwitch))
    : empty('🏟️', 'Aucune compétition proposée', 'Un admin du groupe peut en activer dans ⚙️ Réglages du groupe → Réglages des paris.'));
  draw();
  const node = h('main.follow',
    h('header.topbar', h('a.icon-btn', { href: `/g/${ctx.gid}/me`, 'aria-label': 'Retour' }, '←'), h('h1', '🏟️ Mes compétitions')),
    h('p.muted', 'Le groupe propose des compétitions : tu choisis celles qui t’intéressent. Leurs paris s’affichent chez toi, les autres restent cachés. Tu peux changer d’avis quand tu veux.'),
    list);
  return { node, tab: 'me' };
}
