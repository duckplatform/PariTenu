import { ApiError, get } from './api.js';
import { brand, brandLogo } from './brand.js';
import { cls, h } from './dom.js';
import { ctx, loadGroup, navigate, setRenderer } from './state.js';
import { icon } from './icons.js';
import { forgetGroup, lastGroup, myGroups, setGroups, setLastGroup } from './store.js';
import { toast } from './ui.js';
import { activityView } from './views/activity.js';
import { adminView } from './views/admin.js';
import { betView } from './views/bet.js';
import { betFormView } from './views/betform.js';
import { configView } from './views/config.js';
import { followView } from './views/follow.js';
import { helpView } from './views/help.js';
import { homeView } from './views/home.js';
import { liveView } from './views/live.js';
import { install, meView } from './views/me.js';
import { memberView } from './views/member.js';
import { rankView } from './views/rank.js';
import { deadGroupView, entryView, expiredInviteView } from './views/entry.js';
import { createGroupView, groupsView, siteHomeView } from './views/welcome.js';

const root = document.getElementById('app');

/**
 * Adresses (servies par src/app.js, toutes avec la même coquille) :
 *   /                        accueil du site (l'app installée s'ouvre, elle, sur le dernier groupe)
 *   /groups                  mes groupes        /groups/new[/<coupon>]   créer un groupe (seulement par le lien d'un
 *                                                                        coupon : aucun lien de l'app n'y mène)
 *   /invite/<jeton>          ancien lien d'invitation (expiré)     /help[/<section>]   aide (publique)
 *   /<g>  /<g>/new  /<g>/bet/<id>[/edit]  /<g>/rank[/<classement>[/<saison>]]  /<g>/activity  /<g>/members/<id>
 *   /<g>/me  /<g>/admin  /<g>/config  /<g>/follow (mes compétitions)  /<g>/live (direct : matchs et paris du jour)
 * Adresses en anglais, textes en français. Un groupe : son adresse, 16 caractères hexadécimaux ; elle sert aussi à y
 * entrer et à s'y connecter (pas de lien d'invitation), et un admin du groupe peut la changer.
 */
const GROUP_ID = /^[0-9a-f]{16}$/;
function parseRoute() {
  const [first, second, third, fourth] = location.pathname.split('/').filter(Boolean);
  if (!first) return { name: 'start' };
  if (first === 'invite' && second) return { name: 'invite' };
  if (first === 'groups') return second === 'new' ? { name: 'create', coupon: third ?? null } : { name: 'groups' };
  if (first === 'help') return { name: 'help', arg: second ?? null };
  if (GROUP_ID.test(first)) return { name: second ?? 'home', gid: first, arg: third, sub: fourth };
  return { name: 'unknown' };
}

// Anciennes adresses (favoris, liens partagés, applis installées) : « /#/… », puis en français ou abrégées.
const LEGACY = [
  [/^\/aide(?=\/|$)/, '/help'], [/^\/g\//, '/invite/'], [/^\/c\//, '/groups/new/'],
  [/^(\/[0-9a-f]{16})\/m\//, '$1/members/'], [/([?&])pari=/, '$1bet='],
];
/** Remplace une ancienne adresse par la nouvelle, sans recharger ni ajouter d'étape à l'historique. */
function upgradeAddress() {
  const hashed = location.pathname === '/' && location.hash.startsWith('#/');
  const before = hashed ? location.hash.slice(1) : location.pathname + location.search + location.hash;
  const after = LEGACY.reduce((path, [from, to]) => path.replace(from, to), before);
  if (hashed || after !== before) history.replaceState(null, '', after);
}

/** L'app installée sur l'écran d'accueil (sans barre d'adresse), et non un onglet du navigateur. */
const installed = () => navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

const VIEWS = {
  home: homeView,
  new: betFormView,
  bet: (route) => (route.sub === 'edit' ? betFormView(route) : betView(route)),
  rank: rankView,
  activity: activityView,
  members: memberView,
  me: meView,
  admin: adminView,
  config: configView,
  follow: followView,
  live: liveView,
};

const TABS = [['home', 'target', 'Paris', ''], ['live', 'tv', 'Direct', '/live'], ['rank', 'trophy', 'Classements', '/rank'], ['activity', 'activity', 'Activité', '/activity'], ['me', 'user', 'Moi', '/me']];
/** L'onglet « Direct » n'existe que si le groupe a activé des compétitions (ou d'autres paris automatiques). */
const tabs = () => TABS.filter(([id]) => id !== 'live' || Object.values(ctx.settings.sources ?? {}).some((s) => s.competitions?.length));

// Titre de chaque écran dans l'onglet, l'historique et le sélecteur d'applis : « page · groupe — <nom de l'installation> ».
// Une vue peut préciser le sien (out.title : la question d'un pari, le nom d'un classement, un pseudo…).
const PAGE_TITLES = {
  home: 'Paris', live: 'Direct', rank: 'Classements', activity: 'Activité', members: 'Profil', me: 'Moi', admin: 'Réglages du groupe',
  config: 'Réglages des paris', follow: 'Mes compétitions', new: 'Nouveau pari', bet: 'Pari',
};
function pageTitle(route, out) {
  const site = brand.name;
  if (route.gid) return `${out.title ?? PAGE_TITLES[route.name] ?? 'Paris'} · ${ctx.group.name} — ${site}`;
  if (route.name === 'help') return `Aide et règles — ${site}`;
  return out.title ? `${out.title} — ${site}` : `${site} · paris gratuits entre amis`;
}

/** Paris maison possibles : au moins un type et une catégorie activés (sinon le groupe ne vit que de ses compétitions). */
const canCreate = () => Object.values(ctx.settings.kinds).some(Boolean) && ctx.settings.categories.some((c) => !c.hidden);

/** PC : barre latérale avec la marque, la navigation du groupe, mes autres groupes et l'aide (cachée sur téléphone). */
function sidebar(out) {
  return h('aside.sidebar', { 'aria-label': 'Menu' },
    h('a.brand', { href: '/groups' }, brandLogo(34), brand.name),
    h('nav.side-nav', { 'aria-label': 'Navigation du groupe' }, tabs().map(([id, glyph, label, path]) => h('a', {
      href: `/${ctx.gid}${path}`, 'aria-current': out.tab === id ? 'page' : null,
    }, h('span.ico', icon(glyph)), h('span', label)))),
    canCreate() ? h('a.btn.accent.side-new', { href: `/${ctx.gid}/new` }, icon('plus'), ' Nouveau pari') : null,
    h('div.side-groups',
      h('span.side-title', 'Mes groupes'),
      myGroups().map((g) => {
        const here = g.id === ctx.gid;
        // Admin du groupe : ses réglages à portée de clic, à côté de son nom.
        const admin = here ? ctx.me.role === 'admin' : g.role === 'admin';
        return h('div.side-group',
          h('a', { href: `/${g.id}`, 'aria-current': here ? 'true' : null },
            h('span.big-emoji', { 'aria-hidden': 'true' }, g.emoji), h('span.grow', g.name)),
          admin ? h('a.side-gear', {
            href: `/${g.id}/admin`, title: 'Réglages du groupe', 'aria-label': `Réglages du groupe ${g.name}`,
            'aria-current': here && out.tab === 'settings' ? 'page' : null,
          }, icon('settings')) : null);
      })),
    h('a.side-help', { href: '/help' }, icon('help'), ' Aide et règles'));
}

/**
 * Téléphone : barre du bas avec « Parier » au centre (plus de bouton flottant sur les cartes) ; « Moi » passe en haut,
 * sur l'avatar (5 places au plus dans la barre).
 */
function bottomNav(out) {
  // « Moi » reste en bas quand il y a de la place (pas d'onglet Direct) : « Parier » tombe alors au milieu.
  const shown = tabs();
  const items = (shown.length > 4 ? shown.filter(([id]) => id !== 'me') : shown).map(([id, glyph, label, path]) => h('a', {
    href: `/${ctx.gid}${path}`, 'aria-current': out.tab === id ? 'page' : null,
  }, h('span.ico', icon(glyph)), h('span', label)));
  if (canCreate()) {
    items.splice(Math.floor(items.length / 2), 0, h('a.nav-new', { href: `/${ctx.gid}/new`, 'aria-label': 'Nouveau pari' },
      h('span.nav-plus', icon('plus')), h('span', { 'aria-hidden': 'true' }, 'Parier')));
  }
  return h('nav.nav', { 'aria-label': 'Navigation' }, h('div.nav-inner', items));
}

function layout(out) {
  return [sidebar(out), out.node, bottomNav(out)];
}

let current = { cleanup: null, refreshable: false };
let seq = 0;
let lastKey = '';

let requested = '';

async function render() {
  requested = location.href;
  const mySeq = ++seq;
  current.cleanup?.();
  current = { cleanup: null, refreshable: false };
  const route = parseRoute();
  try {
    let out;
    if (route.name === 'invite') out = expiredInviteView();
    else if (route.name === 'start') {
      // Dans un navigateur, « / » est l'accueil du site ; l'app installée, elle, s'ouvre sur le dernier groupe.
      const last = installed() ? lastGroup() : null;
      if (last) return navigate(`/${last}`, { replace: true });
      out = await siteHomeView();
    } else if (route.name === 'groups') out = await groupsView();
    else if (route.name === 'create') out = await createGroupView(route);
    else if (route.name === 'help') out = await helpView(route);
    else if (route.name === 'unknown') return navigate('/', { replace: true });
    else {
      await loadGroup(route.gid);
      setLastGroup(route.gid);
      out = await (VIEWS[route.name] ?? homeView)(route);
    }
    if (mySeq !== seq) { out?.cleanup?.(); return; }
    if (!out) return; // la vue a redirigé ailleurs
    current = { cleanup: out.cleanup ?? null, refreshable: !!out.refreshable };
    document.title = pageTitle(route, out);
    // Même adresse (rafraîchissement) : on garde la position ; nouvelle adresse : en haut de page.
    const key = location.pathname + location.search;
    const scroll = key === lastKey ? window.scrollY : 0;
    lastKey = key;
    root.replaceChildren(...[route.gid ? layout(out) : out.node].flat().filter(Boolean));
    root.className = cls('app', route.gid && 'with-nav');
    window.scrollTo(0, scroll);
  } catch (err) {
    if (mySeq !== seq) return;
    /** Une page hors du groupe (son entrée, un lien périmé, une erreur) : sans la navigation du groupe. */
    const showPage = (out) => {
      if (mySeq !== seq || !out) return;
      document.title = `${out.title} — ${brand.name}`;
      lastKey = location.pathname + location.search;
      root.replaceChildren(out.node);
      root.className = 'app';
      window.scrollTo(0, 0);
    };
    if (err instanceof ApiError && route.gid && (err.status === 401 || err.code === 'not_member')) {
      // Pas connecté (nouvel appareil, déconnexion, PIN réinitialisé…), ou pas (plus) dans ce groupe : son adresse sert
      // à y entrer ou à s'y connecter, sur place ; ensuite la même adresse s'affiche (le groupe, le pari partagé…).
      forgetGroup(route.gid);
      showPage(await entryView(route).catch(oops));
      return;
    }
    if (err instanceof ApiError && err.code === 'group_not_found' && route.gid) {
      // Adresse inconnue, ou changée par un admin du groupe (un membre retrouve la nouvelle dans « Mes groupes »).
      forgetGroup(route.gid);
      showPage(deadGroupView(err.message));
      return;
    }
    if (err instanceof ApiError && err.status === 404 && route.gid) {
      toast(err.message, 'error');
      if (route.name !== 'home') navigate(`/${route.gid}`, { replace: true });
      else { forgetGroup(route.gid); navigate('/groups', { replace: true }); }
      return;
    }
    showPage(oops(err));
  }
}

/** Une erreur inattendue : le message, et de quoi réessayer. */
function oops(err) {
  return {
    title: 'Oups',
    node: h('main.welcome', h('div.card.center.stack',
      h('div.empty-emoji', '😵'), h('h1', 'Oups'), h('p', err.message || 'Erreur inattendue.'),
      h('button.btn.primary', { type: 'button', onclick: () => render() }, 'Réessayer'))),
  };
}

setRenderer(render);
// Retour et avance du navigateur ; une ancienne adresse (« #/… » tapé à la main…) devient la nouvelle. Un seul rendu par
// adresse.
const onUrlChange = () => {
  upgradeAddress();
  if (location.href !== requested) render();
};
window.addEventListener('hashchange', onUrlChange);
window.addEventListener('popstate', onUrlChange);

// Les liens de l'app (/groups, /<groupe>/bet/<id>…) changent d'écran sans recharger la page ; les autres (admin, API,
// fichiers, autres sites, nouvel onglet, clic avec Ctrl ou Maj) restent ceux du navigateur.
const APP_PATH = /^\/(?:$|groups(?:\/|$)|help(?:\/|$)|invite\/|[0-9a-f]{16}(?:\/|$))/;
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.('a[href]');
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !APP_PATH.test(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});
// De retour dans l'app (onglet ou appli réaffichés) : on rafraîchit la vue si elle le permet.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current.refreshable) render();
});
// Connecté : mes groupes sont ceux de mon compte (il a pu en créer ou en rejoindre depuis un autre appareil).
get('/account').then(({ account, groups }) => { if (account) setGroups(groups); }).catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.prompt = e;
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

upgradeAddress();
render();
