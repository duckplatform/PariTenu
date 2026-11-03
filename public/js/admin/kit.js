// Outils communs de l'admin : appels à /api/admin, navigation, dates, badges, en-têtes de page, cartes, tableaux,
// menus « ⋯ », filtres et copier. Mise en page : admin.css (Sobre en clair, Cockpit en sombre).
import { api, ApiError } from '../api.js';
import { face } from '../avatars.js';
import { brandLogo } from '../brand.js';
import { cls, fill, h } from '../dom.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';

/** Session fermée (2 h sans activité, 12 h au plus) : main.js réaffiche la connexion. */
let onSignedOut = () => {};
export const setSignedOutHandler = (fn) => { onSignedOut = fn; };

/** Changer de page : main.js affiche celle de la nouvelle adresse. */
let onNavigate = () => {};
export const setNavigateHandler = (fn) => { onNavigate = fn; };
/** Va vers une page de l'admin (« /admin/groups/<id> ») sans recharger. */
export function go(path, { replace = false } = {}) {
  if (path !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  onNavigate();
}

/** La recherche (Ctrl K) : main.js l'ouvre ; le bouton loupe des en-têtes sur téléphone aussi. */
let onSearch = () => {};
export const setSearchHandler = (fn) => { onSearch = fn; };
export const openSearch = () => onSearch();

async function call(method, path, body) {
  try {
    return await api(method, `/admin${path}`, body);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'admin_unauthorized') onSignedOut();
    throw err;
  }
}
export const aget = (path) => call('GET', path);
export const apost = (path, body) => call('POST', path, body);
export const apatch = (path, body) => call('PATCH', path, body);
export const aput = (path, body) => call('PUT', path, body);
export const adel = (path, body) => call('DELETE', path, body);

// ——— Dates

const dateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const hourOnly = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** « 31 oct. 2026, 14:16 » ; avec { day: true } : « 31 oct. 2026 ». */
export const when = (ts, { day = false } = {}) => (ts ? (day ? dateOnly : dateTime).format(new Date(ts)) : '—');
/** Une heure du jour même (« 14:32 »), sinon la date complète. */
export const clock = (ts) => (new Date(ts).toDateString() === new Date().toDateString() ? hourOnly.format(new Date(ts)) : when(ts));

/** « il y a 3 min », « il y a 2 j » : l'activité récente se lit d'un coup d'œil. */
export function ago(ts) {
  if (!ts) return 'jamais';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86_400)} j`;
}

/** « dans 3 h », « dans 2 j » : une échéance proche. */
export function soon(ts) {
  const s = Math.max(0, (ts - Date.now()) / 1000);
  if (s < 3600) return `dans ${Math.max(1, Math.ceil(s / 60))} min`;
  if (s < 86_400) return `dans ${Math.ceil(s / 3600)} h`;
  return `dans ${Math.ceil(s / 86_400)} j`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

// ——— Petits éléments

export const badge = (text, kind = '') => h('span.adm-badge', { class: kind ? `is-${kind}` : '' }, text);

export const PLAYER_STATES = { ok: ['Actif', 'ok'], locked: ['Bloqué', 'bad'], new_pin: ['PIN à choisir', 'warn'] };
export const COUPON_STATES = { available: ['Disponible', 'ok'], used: ['Utilisé', 'info'], revoked: ['Annulé', 'muted'], expired: ['Expiré', 'muted'] };
export const stateBadge = (states, state) => badge(...(states[state] ?? [state]));

export const avatar = (value, size = 'sm') => h('span.avatar', { class: size, 'aria-hidden': 'true' }, face(value));
/** L'emoji d'un groupe ou d'une source dans sa tuile. */
export const tile = (emoji, size = '') => h('span.adm-tile', { class: size, 'aria-hidden': 'true' }, emoji);
/** Une icône dans une pastille colorée (ok, warn, bad, info, muted) : journal, « à traiter ». */
export const iconTile = (name, tone = 'muted', size = '') => h('span.adm-itile', { class: cls(`is-${tone}`, size) }, icon(name, 'sm'));

/**
 * Un bouton (ou un lien quand href est donné) : icône et texte. compact : dans un en-tête, sur téléphone, seule l'icône
 * reste (le texte devient le nom du bouton).
 */
export function button(label, { icon: name, kind = '', small = false, href, onclick, compact = false, disabled, attrs = {} } = {}) {
  return h(href ? 'a.btn' : 'button.btn', {
    type: href ? null : 'button', href, onclick, disabled,
    class: cls(kind, small && 'small', compact && 'compact'),
    'aria-label': compact ? label : null, title: compact ? label : null, ...attrs,
  }, name ? icon(name, 'sm') : null, h('span.btn-label', label));
}

/**
 * L'en-tête d'une page : fil d'Ariane (ses parents), titre, sous-titre, état (meta : des badges) et actions (la principale
 * en dernier).
 * Sur téléphone, le parent devient un lien « ‹ Retour » et les pages du menu ont le logo et la loupe.
 */
export function pageHead({ title, sub, meta = null, crumbs = [], lead = null, actions = [] }) {
  return h('header.adm-head',
    crumbs.length ? h('nav.adm-crumbs', { 'aria-label': 'Fil d’Ariane' }, crumbs.map(([label, href]) => h('a', { href },
      icon('left', 'xs'), h('span', label), icon('right', 'xs')))) : null,
    h('div.adm-head-row',
      crumbs.length ? null : h('span.adm-head-logo', brandLogo(30)),
      lead,
      h('div.adm-head-text', h('h1', title), sub ? h('p.adm-sub', sub) : null, meta ? h('div.adm-head-meta', meta) : null),
      h('div.adm-head-actions',
        crumbs.length ? null : h('button.btn.icon.ghost.adm-head-search', { type: 'button', 'aria-label': 'Rechercher', onclick: openSearch }, icon('search')),
        actions)));
}

/**
 * Une carte : titre (et ce qui va à sa droite : un compteur, un lien « Tout voir »), puis son contenu.
 * opts.flush : contenu sans marge (un tableau, une liste).
 */
export function card(title, opts, ...children) {
  if (opts == null || opts instanceof Node || Array.isArray(opts) || typeof opts !== 'object') {
    children.unshift(opts);
    opts = {};
  }
  const { flush = false, extra = null, tone = '', id } = opts;
  return h('section.card.adm-section', { class: tone ? `is-${tone}` : '', id },
    title ? h('div.adm-card-h', h('h2', title), extra) : null,
    h('div.adm-card-b', { class: flush ? 'is-flush' : '' }, children));
}
/** Ancien nom : une carte titrée. */
export const section = (title, ...children) => card(title, {}, ...children);

/** « Tout voir › » à droite du titre d'une carte. */
export const more = (label, href) => h('a.adm-more', { href }, label, icon('right', 'xs'));

/** Les chiffres clés d'une fiche : « Créé · 31 oct. 2026 ». */
export const facts = (pairs) => h('dl.adm-facts', pairs.filter(Boolean).map(([k, v]) => h('div', h('dt', k), h('dd', v))));

/** Un encadré d'alerte (bloqué, PIN à choisir…) avec son action. */
export const alertBox = (tone, name, title, text, action = null) => h('div.adm-alert', { class: `is-${tone}`, role: tone === 'bad' ? 'alert' : null },
  icon(name, 'sm'), h('div.adm-grow', h('b', title), text ? h('small', text) : null), action);

// ——— Tableaux

/**
 * Tableau : colonnes [titre, cellule(ligne), options]. Options d'une colonne : align ('right'), sort (valeur de tri ;
 * desc : trier d'abord du plus grand), phone ('main' : la ligne de titre ; 'sub' : la ligne du dessous ; 'side' : à
 * droite ; 'hide'), unit (ajoutée au chiffre sur téléphone : « 48 pronos » ; texte, ou fonction de la ligne).
 * Options du tableau : href(ligne) rend toute la ligne cliquable, rowClass, sort { col, dir } au départ.
 * Sur téléphone, chaque ligne devient une ligne de liste (titre, détails en dessous, état à droite).
 */
export function table(columns, rows, { emptyText = 'Rien pour l’instant.', rowClass, href, sort: initial = null, label } = {}) {
  if (!rows.length) return h('p.muted.adm-empty', emptyText);
  const cols = columns.map(([title, cell, o = {}], i) => ({ title, cell, ...o, phone: o.phone ?? (i === 0 ? 'main' : title ? 'sub' : 'side') }));
  let sort = initial;
  const tbody = h('tbody');
  const headRow = h('tr');

  const ordered = () => {
    if (!sort) return rows;
    const key = cols[sort.col].sort;
    return [...rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // sans valeur : à la fin
      const d = typeof x === 'string' ? x.localeCompare(y, 'fr', { sensitivity: 'base' }) : x - y;
      return sort.dir === 'desc' ? -d : d;
    });
  };
  const line = (r) => {
    const link = href?.(r);
    return h('tr', {
      class: cls(rowClass?.(r), link && 'is-link'),
      onclick: link ? (e) => { if (!e.target.closest('a, button, input, select, label, summary')) go(link); } : null,
    }, cols.map((c) => h('td', {
      class: cls(`is-${c.phone}`, c.align && `is-${c.align}`),
      dataset: { label: c.title, ...(c.unit ? { unit: typeof c.unit === 'function' ? c.unit(r) : c.unit } : {}) },
    }, c.cell(r))));
  };
  const draw = () => {
    fill(headRow, cols.map((c, i) => h('th', {
      scope: 'col', class: c.align ? `is-${c.align}` : '',
      'aria-sort': sort?.col === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null,
    }, c.sort ? h('button.adm-sort', {
      type: 'button',
      onclick: () => {
        sort = { col: i, dir: sort?.col === i ? (sort.dir === 'asc' ? 'desc' : 'asc') : (c.desc ? 'desc' : 'asc') };
        draw();
      },
    }, c.title, sort?.col === i ? icon(sort.dir === 'asc' ? 'arrowUp' : 'arrowDown', 'xs') : null) : c.title)));
    fill(tbody, ordered().map(line));
  };
  draw();
  return h('div.adm-table-wrap', h('table.adm-table', { 'aria-label': label ?? null }, h('thead', headRow), tbody));
}

// ——— Menus « ⋯ »

let openMenu = null;
const closeMenu = () => { openMenu?.(); openMenu = null; };

/**
 * Le bouton « ⋯ » et son menu : items { label, icon, onclick | href, danger } ; '-' sépare. Les actions rares ou
 * dangereuses y vont, l'action principale reste un bouton visible.
 */
export function moreMenu(items, { label = 'Plus d’actions', small = true } = {}) {
  const trigger = h('button.btn.icon.ghost.adm-more-btn', {
    type: 'button', class: small ? 'small' : '', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: (e) => {
      e.stopPropagation();
      if (trigger.getAttribute('aria-expanded') === 'true') return closeMenu();
      open();
    },
  }, icon('more', 'sm'));

  function open() {
    closeMenu();
    const entries = items.filter(Boolean).map((it) => (it === '-' ? h('hr') : h('button.adm-menu-item', {
      type: 'button', role: 'menuitem', class: it.danger ? 'is-danger' : '',
      onclick: () => { closeMenu(); trigger.focus(); if (it.href) go(it.href); else it.onclick?.(); },
    }, it.icon ? icon(it.icon, 'sm') : null, h('span', it.label))));
    const pop = h('div.adm-menu', { role: 'menu', 'aria-label': label }, entries);
    document.body.append(pop);
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const below = r.bottom + 4 + pop.offsetHeight < innerHeight;
    pop.style.setProperty('left', `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`);
    pop.style.setProperty('top', `${below ? r.bottom + 4 : Math.max(8, r.top - pop.offsetHeight - 4)}px`);
    trigger.setAttribute('aria-expanded', 'true');
    const buttons = [...pop.querySelectorAll('button')];
    buttons[0]?.focus();
    const onKey = (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); trigger.focus(); } else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); } else if (e.key === 'Tab') closeMenu();
    };
    const onDown = (e) => { if (!pop.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) closeMenu(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', closeMenu, { once: true, passive: true });
    openMenu = () => {
      pop.remove();
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }
  return trigger;
}
// Changer de page ferme le menu ouvert.
window.addEventListener('popstate', closeMenu);

// ——— Filtres

/**
 * Filtre de liste : une recherche et des choix (Tous, Bloqués…), appliqués à chaque frappe. choices : [id, libellé,
 * nombre ?] ; initial : le choix de départ (sinon le premier).
 */
export function filters({ choices, placeholder, onChange, initial }) {
  let choice = choices.some(([id]) => id === initial) ? initial : choices[0][0];
  let text = '';
  const seg = h('div.adm-seg', { role: 'tablist', 'aria-label': 'Filtrer' }, choices.map(([id, label, n]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(id === choice),
    onclick: (e) => {
      choice = id;
      for (const b of seg.children) b.setAttribute('aria-selected', String(b === e.currentTarget));
      onChange({ choice, text });
    },
  }, label, n == null ? null : h('span.n', String(n)))));
  const input = h('input', {
    type: 'search', placeholder, 'aria-label': placeholder,
    oninput: () => { text = input.value.trim().toLowerCase(); onChange({ choice, text }); },
  });
  const el = h('div.adm-toolbar', h('label.adm-search', icon('search', 'sm'), input), seg);
  return Object.assign(el, { choice: () => choice });
}

/** Copie dans le presse-papiers (https ou localhost), sinon par une sélection de secours. */
export async function copy(text, done = 'Copié.') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea.adm-offscreen', { readonly: true }, text);
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) { toast('Copie impossible : sélectionne le texte à la main.', 'error'); return; }
  }
  toast(done, 'ok');
}
