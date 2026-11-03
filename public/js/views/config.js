import { get, patch } from '../api.js';
import { h } from '../dom.js';
import { betSettingsEditor } from '../settings-editor.js';
import { ctx, invalidate, loadGroup, navigate, rerender } from '../state.js';
import { run } from '../ui.js';

/** Réglages des paris (admins) : types, catégories et sources de données automatiques. */
export async function configView() {
  if (ctx.me.role !== 'admin') {
    navigate(`/${ctx.gid}/me`, { replace: true });
    return null;
  }
  const base = `/groups/${ctx.gid}`;
  await loadGroup(ctx.gid, { force: true }); // un autre admin a peut-être changé les réglages
  const { sources } = await get(`${base}/sources`);
  const editor = betSettingsEditor({
    settings: ctx.settings, sources,
    searchPlaces: async (q) => (await get(`${base}/places?q=${encodeURIComponent(q)}`)).places,
  });

  const save = h('button.btn.primary.wide', {
    type: 'button',
    onclick: async (e) => {
      if (await run(e.currentTarget, () => patch(`${base}/settings`, editor.value()), { success: 'Réglages enregistrés. Les paris des compétitions activées s’ouvrent dans un instant.' })) {
        invalidate();
        rerender();
      }
    },
  }, 'Enregistrer les réglages');

  const node = h('main.config',
    h('header.topbar', h('a.icon-btn', { href: `/${ctx.gid}/admin`, 'aria-label': 'Retour' }, '←'), h('h1', '🎛️ Réglages des paris')),
    h('section.card.stack', h('h2', '🧩 Types des paris maison'), ...editor.kinds),
    h('section.card.stack', h('h2', '🗂️ Catégories et paris automatiques'), ...editor.categories),
    h('div.save-bar', save));
  return { node, tab: 'settings' };
}
