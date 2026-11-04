// Configuration de l'installation, en onglets : identité (nom, adresse publique, hébergeur) avec son aperçu, page
// d'accueil (textes), icône, thème de l'appli. PariTenu est un logiciel libre : chaque installation se personnalise ici,
// sans toucher au code (src/services/branding.js). Les textes s'enregistrent d'un coup (barre en bas dès qu'un champ
// change) ; l'icône et le thème s'appliquent tout de suite.
import { brand } from '../brand.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { confirmSheet, field, run, toast } from '../ui.js';
import { themeCards } from './appearance.js';
import { adel, aget, apatch, aput, button, card, pageHead, plural } from './kit.js';

const ICON_MAX_BYTES = 2 * 1024 * 1024;
const TABS = [['identity', 'globe', 'Identité'], ['home', 'home', 'Page d’accueil'], ['icon', 'image', 'Icône'], ['theme', 'palette', 'Thème']];

/** Le fichier choisi, en base64 (sans l'en-tête « data:image/png;base64, »). */
const base64Of = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
  reader.onerror = () => reject(new Error('Impossible de lire ce fichier.'));
  reader.readAsDataURL(file);
});

export async function configurationView({ refresh, tab: wanted }) {
  const { branding: b, icons, theme, themes } = await aget('/configuration');
  const tab = TABS.some(([id]) => id === wanted) ? wanted : 'identity';

  const input = (name, attrs) => h('input', { name, value: b[name], autocomplete: 'off', ...attrs });
  const inputs = {
    name: input('name', { maxlength: 40, required: true }),
    shortName: input('shortName', { maxlength: 14, required: true }),
    publicUrl: input('publicUrl', { type: 'url', inputmode: 'url', maxlength: 200, placeholder: 'https://paris.example.fr' }),
    hostName: input('hostName', { maxlength: 60, placeholder: 'Facultatif' }),
    hostUrl: input('hostUrl', { type: 'url', inputmode: 'url', maxlength: 200, placeholder: 'https://…' }),
    tagline: input('tagline', { maxlength: 120 }),
    intro: h('textarea', { name: 'intro', rows: 4, maxlength: 400 }, b.intro),
    footerNote: input('footerNote', { maxlength: 200, placeholder: 'Facultatif' }),
  };
  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
  const initial = values();

  // Aperçu en direct : ce que verront l'onglet, l'écran du téléphone et les amis invités.
  const preview = { tab: h('span'), phone: h('small'), invite: h('code'), share: h('span') };
  const counter = h('span.adm-counter.num');
  // Ce qui n'est pas encore enregistré : la barre du bas le dit, « Annuler » remet tout comme avant.
  const pending = h('span.adm-grow');
  const saveButton = h('button.btn.primary', { type: 'submit' }, 'Enregistrer');
  const bar = h('div.adm-savebar', { hidden: true }, icon('pencil', 'sm'), pending,
    h('button.btn.ghost', { type: 'button', onclick: () => { for (const [k, el] of Object.entries(inputs)) el.value = initial[k]; update(); } }, 'Annuler'),
    saveButton);
  const update = () => {
    const v = values();
    preview.tab.textContent = v.name || '—';
    preview.phone.textContent = v.shortName || '—';
    preview.share.textContent = `Rejoins « Les Potes » sur ${v.name || '—'}`;
    preview.invite.textContent = `${(v.publicUrl || location.origin).replace(/\/+$/, '')}/a1b2c3d4e5f60718`; // une adresse de groupe pour l'exemple
    counter.textContent = `${v.shortName.length} / 14`;
    const changed = Object.keys(v).filter((k) => v[k] !== initial[k]).length;
    pending.textContent = `${plural(changed, 'modification non enregistrée', 'modifications non enregistrées')}`;
    bar.hidden = changed === 0;
  };
  for (const el of Object.values(inputs)) el.addEventListener('input', update);

  const save = async () => {
    const result = await run(saveButton, () => apatch('/branding', values()));
    if (!result) return;
    toast(result.changed.length ? 'Configuration enregistrée : chaque joueur la voit à sa prochaine page.' : 'Rien n’a changé.', 'ok');
    Object.assign(brand, result.brand);
    refresh();
  };

  const panels = {
    identity: h('div.adm-aside-grid.is-config',
      card('Identité',
        field(h('span.adm-label-row', 'Nom'), inputs.name, 'Dans l’onglet, en haut de chaque page et dans les messages partagés. Le logiciel reste PariTenu : le pied de page le dit (« Propulsé par PariTenu »).'),
        field(h('span.adm-label-row', 'Nom court', counter), inputs.shortName, 'Sous l’icône de l’app sur l’écran d’accueil du téléphone : 14 caractères au plus.'),
        field('Adresse publique', inputs.publicUrl, 'Les liens des groupes, des coupons et des paris partagés commencent par elle. Vide : l’adresse de la page ouverte. L’app reste joignable à ses autres adresses, rien n’est redirigé.'),
        field('Hébergeur', inputs.hostName, '« Hébergé par … » en bas de l’accueil et de l’aide. Sans nom, rien n’est affiché.'),
        field('Adresse de l’hébergeur', inputs.hostUrl)),
      card('Aperçu', h('div.adm-preview',
        h('div.adm-pv-tab', h('img', { src: icons?.tab ?? '/icons/icon.svg', alt: '', width: 16, height: 16 }), preview.tab, icon('x', 'xs')),
        h('div.adm-pv-row',
          h('div.adm-pv-home', h('img', { src: icons?.phone ?? '/icons/apple-touch-icon.png', alt: '', width: 56, height: 56 }), preview.phone),
          h('div.adm-pv-msg', h('b', 'Lien du groupe partagé'), h('p', preview.share), preview.invite))))),
    home: h('div.adm-form-col', card('Page d’accueil',
      field('Accroche', inputs.tagline, 'Le titre de l’accueil ; sa dernière phrase est mise en valeur.'),
      field('Présentation', inputs.intro, 'Sous le titre, et comme description du site (aperçu des liens partagés, moteurs de recherche).'),
      field('Note de pied de page', inputs.footerNote, 'Une ligne de plus en bas de l’accueil : un mot de bienvenue, un contact…'))),
    icon: iconPanel({ icons, refresh }),
    theme: card('Thème de l’appli', { extra: h('small.muted', 'Cette page d’admin garde son habillage (clair le jour, sombre la nuit).') },
      themeCards({ theme, themes, refresh })),
  };
  const show = (id) => {
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== id;
    for (const a of tabs.children) a.setAttribute('aria-selected', String(a.dataset.tab === id));
    history.replaceState(null, '', id === 'identity' ? '/admin/configuration' : `/admin/configuration/${id}`);
  };
  const tabs = h('div.adm-tabs', { role: 'tablist', 'aria-label': 'Configuration' }, TABS.map(([id, name, label]) => h('button', {
    type: 'button', role: 'tab', dataset: { tab: id }, 'aria-selected': String(id === tab), onclick: () => show(id),
  }, icon(name, 'sm'), label)));
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== tab;
  update();

  return {
    title: 'Configuration',
    node: h('div.adm-page.adm-config',
      pageHead({ title: 'Configuration', sub: 'L’identité de ce site : son nom, son adresse, sa page d’accueil, son icône et son thème. Pour tous les groupes et tous les joueurs.' }),
      tabs,
      h('form', { onsubmit: (e) => { e.preventDefault(); save(); } }, panels.identity, panels.home, bar),
      panels.icon, panels.theme),
  };
}

/** Icône et logo : un PNG carré, décliné pour l'onglet, l'écran du téléphone et l'en-tête des pages. */
function iconPanel({ icons, refresh }) {
  const picker = h('input.adm-offscreen', { type: 'file', accept: 'image/png', 'aria-label': 'Image PNG de l’icône' });
  const choose = button(icons ? 'Changer l’icône' : 'Choisir une image PNG', { icon: 'image', kind: 'primary', onclick: () => picker.click() });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    if (file.type && file.type !== 'image/png') return toast('L’icône doit être une image PNG.', 'error');
    if (file.size > ICON_MAX_BYTES) return toast('L’image fait plus de 2 Mo : réduis-la avant de l’envoyer.', 'error');
    const result = await run(choose, async () => aput('/icon', { png: await base64Of(file) }), { success: 'Nouvelle icône pour tout le site.' });
    if (!result) return;
    Object.assign(brand, result.brand);
    refresh();
  });
  const reset = async (el) => {
    const ok = await confirmSheet('Revenir à l’icône d’origine ?', 'L’icône de PariTenu reprend sa place partout : onglet, écran du téléphone, en-tête des pages.', { confirm: 'Revenir à l’origine' });
    if (!ok) return;
    const result = await run(el, () => adel('/icon'), { success: 'Icône d’origine remise.' });
    if (!result) return;
    Object.assign(brand, result.brand);
    refresh();
  };

  const tab = icons?.tab ?? '/icons/icon.svg';
  const phone = icons?.phone ?? '/icons/apple-touch-icon.png';
  const logo = icons?.logo ?? '/icons/icon.svg';
  return card('Icône et logo',
    h('div.adm-icons',
      h('figure', h('div.adm-icon-tab', h('img', { src: tab, alt: '', width: 16, height: 16 }), h('span', brand.name)), h('figcaption', 'Onglet')),
      h('figure', h('img.adm-icon-phone', { src: phone, alt: '', width: 60, height: 60 }), h('figcaption', 'Écran du téléphone')),
      h('figure', h('div.adm-icon-head', h('img', { src: logo, alt: '', width: 34, height: 34 }), h('b', brand.name)), h('figcaption', 'En-tête des pages'))),
    h('small.hint', 'Une image PNG carrée, 512 × 512 pixels conseillés (192 au moins, 2 Mo au plus). Une image rectangulaire est recadrée au centre.'),
    h('div.row-wrap', choose, picker,
      icons ? h('button.btn', { type: 'button', onclick: (e) => reset(e.currentTarget) }, 'Revenir à l’icône d’origine') : null));
}
