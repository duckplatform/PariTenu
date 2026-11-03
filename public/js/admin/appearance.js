// Apparence du site : le thème de l'appli (couleurs, polices, formes), le même pour tous les groupes et tous les joueurs.
// Une section de la page Configuration (configuration.js). Aperçus : captures de la démo sur téléphone
// (public/img/themes/<id>.jpg).
import { h } from '../dom.js';
import { confirmSheet, run } from '../ui.js';
import { aput, badge } from './kit.js';

const SCHEME = { auto: 'clair ou sombre selon le téléphone', light: 'clair', dark: 'sombre' };

/** Les cartes des thèmes ; en choisir un l'applique tout de suite, après confirmation. */
export function themeCards({ theme, themes, refresh }) {
  const choose = async (t, button) => {
    const ok = await confirmSheet(`Passer au thème ${t.name} ?`,
      `Tous les joueurs le verront à leur prochaine page, dans tous les groupes. Tu pourras revenir au thème d’avant quand tu veux.`,
      { confirm: `Choisir ${t.name}` });
    if (!ok) return;
    if (await run(button, () => aput('/theme', { theme: t.id }), { success: `Thème « ${t.name} » appliqué à tout le site.` })) refresh();
  };

  const swatch = (color) => {
    const el = h('span.adm-swatch', { title: color });
    el.style.setProperty('--swatch', color);
    return el;
  };
  const card = (t) => h('article.adm-theme', { class: t.id === theme ? 'is-current' : '', dataset: { theme: t.id } },
    h('img.adm-theme-shot', { src: `/img/themes/${t.id}.jpg`, alt: `Aperçu du thème ${t.name} sur téléphone`, width: 195, height: 422, loading: 'lazy' }),
    h('div.adm-theme-body',
      h('div.adm-theme-head', h('h2', t.name), t.id === theme ? badge('Thème actuel', 'ok') : null),
      h('p', t.tagline),
      h('div.adm-swatches', { 'aria-hidden': 'true' }, t.swatches.map(swatch)),
      h('small.muted', `${t.style} · ${t.fonts} · ${SCHEME[t.scheme]}`),
      t.id === theme ? null : h('button.btn.primary', {
        type: 'button', 'aria-label': `Choisir le thème ${t.name}`, onclick: (e) => choose(t, e.currentTarget),
      }, `Choisir ${t.name}`)));

  return h('div.adm-themes', themes.map(card));
}
