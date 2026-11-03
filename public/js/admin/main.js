// Admin de l'instance (/admin) : connexion par mot de passe (choisi sur le serveur), puis comptes, groupes, coupons.
//   /admin  vue d'ensemble    /admin/users[/<id>]    /admin/groups[/<id>[/rankings|/settings|/edit]]    /admin/coupons
//   /admin/sources[/<id>]    /admin/configuration[/<onglet>]    /admin/log
// Adresses en anglais, textes en français ; les anciennes (« /admin#/comptes… ») sont converties (upgradeAddress).
// PC : menu à gauche, rangé en trois blocs ; téléphone : barre du bas (« Plus » pour le reste). Ctrl K : recherche.
import { ApiError, get, post } from '../api.js';
import { brand, brandLogo } from '../brand.js';
import { cls, h } from '../dom.js';
import { icon } from '../icons.js';
import { field, openSheet, toast } from '../ui.js';
import { configurationView } from './configuration.js';
import { couponsView } from './coupons.js';
import { dashboardView, logView } from './dashboard.js';
import { groupEditView, groupsView, groupView } from './groups.js';
import { aget, go, plural, setNavigateHandler, setSearchHandler, setSignedOutHandler } from './kit.js';
import { playersView } from './players.js';
import { searchDialog } from './search.js';
import { sourcesView } from './sources.js';

const root = document.getElementById('app');
const app = () => `Admin — ${brand.name}`;

// [section, icône, libellé, compteur de /api/admin/nav (pastille rouge : attention, orange : sources)]
const NAV = [
  ['Suivi', [['', 'dashboard', 'Vue d’ensemble', 'attention'], ['log', 'scroll', 'Journal']]],
  ['Joueurs', [['users', 'user', 'Comptes', 'players'], ['groups', 'users', 'Groupes', 'groups'], ['coupons', 'ticket', 'Coupons', 'coupons']]],
  ['Site', [['sources', 'radio', 'Sources', 'sources'], ['configuration', 'settings', 'Configuration']]],
];
const TABS = [['', 'dashboard', 'Accueil', 'attention'], ['users', 'user', 'Comptes'], ['groups', 'users', 'Groupes'], ['coupons', 'ticket', 'Coupons']];
const ALERTS = { attention: 'bad', sources: 'warn' }; // ces compteurs-là signalent quelque chose à faire
const pathOf = (section) => (section ? `/admin/${section}` : '/admin');

function route() {
  const [section = '', id, sub] = location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  return { section, id, sub };
}

// Anciennes adresses « /admin#/… », en français (l'ancienne page Apparence est l'onglet Thème de la Configuration).
const LEGACY = { comptes: 'users', groupes: 'groups', modifier: 'edit', journal: 'log', apparence: 'configuration/theme' };
function upgradeAddress() {
  if (!location.hash.startsWith('#/')) return;
  const parts = location.hash.slice(2).split('/').filter(Boolean).map((p) => LEGACY[p] ?? p);
  history.replaceState(null, '', ['/admin', ...parts].join('/'));
}

const VIEWS = {
  '': (r, ctx) => dashboardView(ctx),
  users: (r, ctx) => playersView({ ...ctx, id: r.id ?? null }),
  groups: (r, ctx) => {
    if (!r.id) return groupsView(ctx);
    return r.sub === 'edit' ? groupEditView({ ...ctx, id: r.id }) : groupView({ ...ctx, id: r.id, tab: r.sub ?? 'members' });
  },
  coupons: (r, ctx) => couponsView(ctx),
  sources: (r, ctx) => sourcesView({ ...ctx, id: r.id }),
  configuration: (r, ctx) => configurationView({ ...ctx, tab: r.id }),
  log: () => logView(),
};

/** Le nombre à droite d'une entrée du menu : discret, ou en pastille quand il y a quelque chose à faire. */
function counter(key, counts) {
  const n = counts?.[key];
  if (!n && ALERTS[key]) return null;
  if (n == null) return null;
  return ALERTS[key] ? h('span.adm-pill', { class: `is-${ALERTS[key]}`, 'aria-label': `${n} à traiter` }, String(n)) : h('span.adm-count', String(n));
}

function layout(r, node, counts) {
  const link = ([id, name, label, key]) => h('a', { href: pathOf(id), 'aria-current': r.section === id ? 'page' : null },
    icon(name), h('span.adm-nav-label', label), key ? counter(key, counts) : null);
  return [
    h('div.adm-shell',
      h('aside.adm-side',
        h('a.adm-brand', { href: '/admin' }, brandLogo(30), h('span', h('b', brand.name), h('small', 'Administration'))),
        h('button.adm-search-btn', { type: 'button', onclick: openSearch, 'aria-label': 'Rechercher (Ctrl K)' },
          icon('search', 'sm'), h('span', 'Rechercher'), h('kbd', 'Ctrl K')),
        h('nav.adm-nav', { 'aria-label': 'Admin' }, NAV.map(([title, items]) => h('div.adm-nav-group',
          h('p.adm-nav-h', title), items.map(link)))),
        h('div.adm-side-foot',
          h('a', { href: '/', target: '_blank', rel: 'noopener' }, icon('external'), h('span', 'Voir le site')),
          h('div.adm-me', h('span.adm-dot', { 'aria-hidden': 'true' }),
            h('span', counts?.sessions > 1 ? `Connecté · ${plural(counts.sessions, 'session')}` : 'Connecté'),
            h('button.btn.icon.ghost.small', { type: 'button', onclick: logout, 'aria-label': 'Se déconnecter', title: 'Se déconnecter' }, icon('logout', 'sm'))))),
      h('main.adm-main', node)),
    h('nav.adm-bnav', { 'aria-label': 'Admin' },
      TABS.map(([id, name, label, key]) => h('a', { href: pathOf(id), 'aria-current': r.section === id ? 'page' : null },
        h('span.adm-bnav-icon', icon(name), key ? counter(key, counts) : null), h('span', label))),
      h('button', { type: 'button', class: cls(['sources', 'configuration', 'log'].includes(r.section) && 'is-on'), onclick: () => morePanel(counts) },
        h('span.adm-bnav-icon', icon('menu'), counter('sources', counts)), h('span', 'Plus'))),
  ];
}

/** Téléphone, « Plus » : les pages qui ne tiennent pas dans la barre du bas, le site, la déconnexion. */
function morePanel(counts) {
  openSheet('Plus', (close) => {
    const item = (href, name, label, extra = null) => h('a.adm-act', { href, onclick: () => close(null) }, icon(name, 'sm'), h('span.adm-grow', label), extra, icon('right', 'xs'));
    return h('div.adm-more-list',
      item('/admin/sources', 'radio', 'Sources', counter('sources', counts)),
      item('/admin/configuration', 'settings', 'Configuration'),
      item('/admin/log', 'scroll', 'Journal'),
      h('button.adm-act', { type: 'button', onclick: () => { close(null); openSearch(); } }, icon('search', 'sm'), h('span.adm-grow', 'Rechercher')),
      h('a.adm-act', { href: '/', target: '_blank', rel: 'noopener' }, icon('external', 'sm'), h('span.adm-grow', 'Voir le site')),
      h('button.adm-act.is-danger', { type: 'button', onclick: () => { close(null); logout(); } }, icon('logout', 'sm'), h('span.adm-grow', 'Se déconnecter')));
  });
}

const openSearch = () => { if (root.querySelector('.adm-main')) searchDialog(); };
setSearchHandler(openSearch);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  }
});

let seq = 0;
async function render() {
  const mine = ++seq;
  const r = route();
  try {
    const [out, counts] = await Promise.all([
      (VIEWS[r.section] ?? VIEWS[''])(r, { refresh: render }),
      aget('/nav').catch(() => null),
    ]);
    if (mine !== seq) return;
    document.title = `${out.title} · ${app()}`;
    const y = window.scrollY;
    const same = root.dataset.route === location.pathname;
    root.dataset.route = location.pathname;
    root.replaceChildren(...layout(r, out.node, counts));
    window.scrollTo(0, same ? y : 0);
    out.mounted?.();
  } catch (err) {
    if (mine !== seq) return;
    if (err instanceof ApiError && err.code === 'admin_unauthorized') return;
    if (err instanceof ApiError && err.status === 404 && r.id) {
      toast(err.message, 'error');
      go(pathOf(r.section), { replace: true });
      return;
    }
    root.replaceChildren(h('main.adm-login', h('div.card.adm-login-card', icon('alert'), h('h1', 'Oups'), h('p', err.message || 'Erreur inattendue.'),
      h('button.btn.primary', { type: 'button', onclick: render }, 'Réessayer'))));
  }
}

async function logout() {
  await post('/admin/logout').catch(() => {});
  signIn({ signedIn: false, hasPassword: true });
}

/** Écran de connexion ; sans mot de passe, comment le choisir sur le serveur. */
function signIn(session) {
  seq++;
  document.title = `Connexion · ${app()}`;
  const head = h('div.adm-login-brand', brandLogo(44), h('div', h('b', brand.name), h('small', 'Administration du site')));
  if (!session.hasPassword) {
    root.replaceChildren(h('main.adm-login', h('section.card.adm-login-card',
      head,
      h('h1', 'Choisis le mot de passe'),
      h('p', 'Pas encore de mot de passe. Il se choisit sur le serveur, jamais depuis le site : dans le dossier de l’app, lance'),
      h('pre.adm-cmd', 'npm run admin'),
      h('p.muted', 'Tape deux fois ton mot de passe (12 caractères au moins), puis reviens ici.'),
      h('button.btn.primary.wide', { type: 'button', onclick: boot }, 'C’est fait'))));
    return;
  }
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const err = h('p.form-error', { role: 'alert' });
  const button = h('button.btn.primary.wide', { type: 'submit' }, 'Se connecter');
  root.replaceChildren(h('main.adm-login', h('section.card.adm-login-card',
    head,
    h('h1', 'Connexion'),
    h('p.muted', 'Comptes, groupes, coupons et réglages du site.'),
    h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        button.disabled = true;
        try {
          await post('/admin/login', { password: password.value });
          render();
        } catch (error) {
          err.textContent = error.message;
          password.select();
        } finally {
          button.disabled = false;
        }
      },
    }, field('Mot de passe', password), err, button),
    h('small.hint', 'Mot de passe oublié ou admin bloqué : « npm run admin » sur le serveur en choisit un nouveau.'))));
  password.focus();
}

setSignedOutHandler(() => {
  toast('Session admin fermée : reconnecte-toi.', 'error');
  signIn({ signedIn: false, hasPassword: true });
});

async function boot() {
  try {
    const session = await get('/admin/session');
    if (session.signedIn) render();
    else signIn(session);
  } catch (err) {
    root.replaceChildren(h('main.adm-login', h('div.card.adm-login-card', h('h1', 'Oups'), h('p', err.message))));
  }
}

// Changer de page (liens, retour du navigateur) : seulement une fois connecté (sinon l'écran de connexion reste).
const onUrlChange = () => {
  upgradeAddress();
  if (root.querySelector('.adm-main')) render();
};
setNavigateHandler(onUrlChange);
window.addEventListener('popstate', onUrlChange);
window.addEventListener('hashchange', onUrlChange);

// Les liens de l'admin (/admin/…) changent de page sans recharger ; les autres restent ceux du navigateur.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.('a[href]');
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !/^\/admin(\/|$)/.test(url.pathname)) return;
  e.preventDefault();
  go(url.pathname + url.search);
});

upgradeAddress();
boot();
