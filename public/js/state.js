import { get } from './api.js';
import { appUrl } from './brand.js';
import { syncClock } from './format.js';
import { rememberGroup } from './store.js';

/** Le groupe affiché : infos, réglages, membre connecté et annuaire des membres. */
export const ctx = { gid: null, group: null, settings: null, me: null, members: new Map(), loadedAt: 0 };

export async function loadGroup(gid, { force = false } = {}) {
  if (!force && ctx.gid === gid && Date.now() - ctx.loadedAt < 10_000) return ctx;
  const data = await get(`/groups/${gid}`);
  syncClock(data.now);
  Object.assign(ctx, {
    gid,
    group: data.group,
    settings: data.settings,
    me: data.me,
    members: new Map(data.members.map((m) => [m.id, m])),
    loadedAt: Date.now(),
  });
  rememberGroup({ ...data.group, role: data.me.role });
  return ctx;
}

export const invalidate = () => { ctx.loadedAt = 0; };

export const memberOf = (id) => ctx.members.get(id) ?? { id, pseudo: '?', avatar: '❔', status: 'removed' };
export const categoryOf = (id) => ctx.settings?.categories.find((c) => c.id === id) ?? { id, emoji: '🎲', label: 'Autre' };
export const activeMembers = () => [...ctx.members.values()].filter((m) => m.status === 'active');
/** Le lien du groupe à partager (son adresse : elle sert à entrer et à se connecter), ou d'une de ses pages. */
export const groupUrl = (path = '') => appUrl(`/${ctx.gid}${path}`);

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const rerender = () => renderer();

/** Va vers une adresse de l'app (« /groups », « /<groupe>/bet/<id> »…) sans recharger la page. */
export function navigate(path, { replace = false } = {}) {
  // Déjà sur cette adresse : on redessine seulement (pas de doublon dans l'historique).
  if (path !== location.pathname + location.search + location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  renderer();
}
