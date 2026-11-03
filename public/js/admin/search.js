// Recherche de l'admin (Ctrl K, ou la loupe) : un compte, un groupe, un coupon ou une page, au clavier ou au doigt.
// Les listes sont lues à l'ouverture ; le filtre se fait ici, sans accents ni majuscules.
import { face } from '../avatars.js';
import { cls, fill, h } from '../dom.js';
import { icon } from '../icons.js';
import { aget, COUPON_STATES, go } from './kit.js';

const PAGES = [
  ['/admin', 'dashboard', 'Vue d’ensemble'], ['/admin/users', 'user', 'Comptes'], ['/admin/groups', 'users', 'Groupes'],
  ['/admin/coupons', 'ticket', 'Coupons'], ['/admin/sources', 'radio', 'Sources'], ['/admin/configuration', 'settings', 'Configuration'],
  ['/admin/configuration/theme', 'palette', 'Thème de l’appli'], ['/admin/log', 'scroll', 'Journal'],
];
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

let opened = false;

export function searchDialog() {
  if (opened) return;
  opened = true;
  const previous = document.activeElement;
  const input = h('input.adm-cmd-input', { type: 'search', placeholder: 'Un compte, un groupe, un coupon, une page…', 'aria-label': 'Rechercher', autocomplete: 'off', 'aria-controls': 'adm-cmd-list' });
  const list = h('div.adm-cmd-list#adm-cmd-list', { role: 'listbox', 'aria-label': 'Résultats' });
  const box = h('div.adm-palette', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rechercher' },
    h('div.adm-cmd-head', icon('search', 'sm'), input, h('button.btn.ghost.small', { type: 'button', onclick: () => close() }, 'Échap')), list);
  const backdrop = h('div.adm-cmd-backdrop', { onclick: (e) => { if (e.target === backdrop) close(); } }, box);
  let data = null;
  let items = [];
  let active = 0;

  function close() {
    opened = false;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    previous?.focus?.();
  }
  const choose = (item) => { close(); go(item.href); };

  function results() {
    const q = plain(input.value.trim());
    const match = (...texts) => !q || texts.some((t) => plain(t).includes(q));
    const groups = [['Pages', PAGES.filter(([, , label]) => q && match(label)).map(([href, name, label]) => ({ href, lead: icon(name, 'sm'), title: label }))]];
    if (data) {
      groups.push(
        ['Comptes', data.players.filter((p) => q && match(p.pseudo)).slice(0, 6)
          .map((p) => ({ href: `/admin/users/${p.id}`, lead: h('span.avatar.sm', face(p.avatar)), title: p.pseudo, note: p.state === 'locked' ? 'bloqué' : p.state === 'new_pin' ? 'PIN à choisir' : '' }))],
        ['Groupes', data.groups.filter((g) => q && match(g.name)).slice(0, 6)
          .map((g) => ({ href: `/admin/groups/${g.id}`, lead: h('span.adm-tile.sm', g.emoji), title: g.name, note: `${g.members} membre${g.members > 1 ? 's' : ''}` }))],
        ['Coupons', data.coupons.filter((c) => q && match(c.hint, c.note, c.usedByPseudo, c.groupName)).slice(0, 4)
          .map((c) => ({ href: '/admin/coupons', lead: icon('ticket', 'sm'), title: `…${c.hint}${c.note ? ` · ${c.note}` : ''}`, note: COUPON_STATES[c.state]?.[0] ?? '' }))],
      );
    }
    if (!q) groups[0][1] = PAGES.slice(0, 6).map(([href, name, label]) => ({ href, lead: icon(name, 'sm'), title: label }));
    return groups.filter(([, xs]) => xs.length);
  }

  function draw() {
    const groups = results();
    items = groups.flatMap(([, xs]) => xs);
    active = Math.min(active, Math.max(0, items.length - 1));
    let i = 0;
    fill(list, items.length ? groups.map(([title, xs]) => h('div.adm-cmd-group', h('p.adm-cmd-h', title), xs.map((item) => {
      const index = i++;
      return h('button.adm-cmd-item', {
        type: 'button', role: 'option', id: `adm-cmd-${index}`, 'aria-selected': String(index === active), class: cls(index === active && 'is-active'),
        onclick: () => choose(item), onmousemove: () => { if (active !== index) { active = index; draw(); } },
      }, item.lead, h('span.adm-grow', item.title), item.note ? h('small', item.note) : null, icon('right', 'xs'));
    }))) : h('p.adm-cmd-empty', data ? 'Rien ne correspond.' : 'Chargement…'));
    input.setAttribute('aria-activedescendant', items.length ? `adm-cmd-${active}` : '');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); draw(); } else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]); }
  }

  input.addEventListener('input', () => { active = 0; draw(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  input.focus();
  draw();
  Promise.all([aget('/players'), aget('/groups'), aget('/coupons')])
    .then(([{ players }, { groups }, { coupons }]) => { data = { players, groups, coupons }; if (opened) draw(); })
    .catch(() => { data = { players: [], groups: [], coupons: [] }; if (opened) draw(); });
}
