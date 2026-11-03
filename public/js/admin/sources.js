// Sources de données pour tout le site : couper ou rallumer une source (foot, padel, météo…) dans tous les groupes, et
// voir si chacune répond (dernière lecture réussie, gardée en mémoire par le serveur depuis son démarrage).
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { confirmSheet, run } from '../ui.js';
import { ago, apatch, aget, badge, card, pageHead, plural, tile } from './kit.js';

const CATEGORIES = [['sport', 'Sport'], ['meteo', 'Météo'], ['eco', 'Économie'], ['actu', 'Actualité']];

export async function sourcesView({ id: focus, refresh }) {
  const { sources } = await aget('/sources');

  const toggle = async (s, el) => {
    const off = s.enabled;
    const ok = await confirmSheet(off ? `Couper ${s.emoji} ${s.name} ?` : `Rallumer ${s.emoji} ${s.name} ?`, off
      ? `Plus aucun groupe ne la verra dans ses réglages ni sur l’accueil, et plus aucun pari ne s’ouvre. Ses paris sans pronostic disparaissent ; ceux déjà joués (${s.openBets} en cours) vont jusqu’à leur résultat. Les réglages des groupes sont gardés pour la rallumer.`
      : `Elle revient dans les réglages des groupes, et ses paris se rouvrent tout seuls dans les ${s.groups} groupe(s) qui l’avaient réglée.`,
    { confirm: off ? 'Couper pour tout le site' : 'Rallumer', danger: off });
    if (!ok) return;
    if (await run(el, () => apatch(`/sources/${s.id}`, { enabled: !s.enabled }))) refresh();
  };

  // Ce que dit la source : coupée, clé manquante, ne répond plus, lue il y a…, ou pas encore lue (aucun groupe ne l'utilise).
  const state = (s) => {
    if (s.key === 'missing') return badge('Clé manquante', 'warn');
    if (!s.enabled) return badge('Coupée', 'bad');
    if (s.failingSince && (!s.readAt || s.failingSince > s.readAt)) return h('span', { title: s.error ?? '' }, badge('Ne répond plus', 'bad'));
    if (s.readAt) return h('span.adm-fresh', icon('checkCircle', 'xs'), `lue ${ago(s.readAt)}`);
    return h('span.muted.small', s.groups ? 'pas encore lue' : 'pas utilisée');
  };
  const row = (s) => h('li.adm-src', { id: `source-${s.id}`, class: [s.enabled ? '' : 'is-off', s.id === focus ? 'is-focus' : ''].join(' ') },
    tile(s.emoji),
    h('div.adm-grow', h('b', s.name), h('small', [s.provider, s.competitions ? plural(s.competitions, 'compétition') : null].filter(Boolean).join(' · ')),
      s.key === 'missing' ? h('small.adm-src-key', 'Clé à ajouter dans .env : ', h('code', s.keyName)) : null),
    h('span.adm-src-use', s.groups ? `${plural(s.groups, 'groupe')} · ${plural(s.openBets, 'pari')}` : h('span.muted', 'aucun groupe')),
    h('span.adm-src-state', state(s)),
    s.key === 'missing'
      ? h('button.adm-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': `Source ${s.name}`, disabled: true, title: `Ajoute ${s.keyName} dans le fichier .env du serveur` }, h('i'))
      : h('button.adm-switch', {
        type: 'button', role: 'switch', 'aria-checked': String(s.enabled), 'aria-label': `Source ${s.name}`,
        title: s.enabled ? 'Allumée pour tout le site : toucher pour la couper' : 'Coupée pour tout le site : toucher pour la rallumer',
        onclick: (e) => toggle(s, e.currentTarget),
      }, h('i')));

  const of = (cat) => sources.filter((s) => s.category === cat);
  const block = ([cat, title]) => (of(cat).length ? card(title, { flush: true, extra: h('span.adm-count', String(of(cat).length)) }, h('ul.adm-srcs', of(cat).map(row))) : null);
  const off = sources.filter((s) => !s.enabled).length;
  const on = sources.filter((s) => s.enabled && s.key !== 'missing').length;
  const toFix = sources.filter((s) => s.enabled && (s.key === 'missing' || (s.failingSince && (!s.readAt || s.failingSince > s.readAt)))).length;
  return {
    title: 'Sources',
    node: h('div.adm-page',
      pageHead({
        title: 'Sources', sub: 'Les données qui ouvrent les paris tout seuls et apportent les résultats. Un interrupteur vaut pour tous les groupes.',
        meta: [badge(`${on} allumée${on > 1 ? 's' : ''}`, 'ok'), off ? badge(`${off} coupée${off > 1 ? 's' : ''}`, 'bad') : null,
          toFix ? badge(`${toFix} à régler`, 'warn') : null],
      }),
      h('div.adm-aside-grid.is-wide',
        h('div.adm-col', block(CATEGORIES[0])),
        h('div.adm-col', CATEGORIES.slice(1).map(block),
          card('Couper une source', { tone: 'note' },
            h('p.small', 'Elle disparaît des réglages des groupes et plus aucun pari ne s’ouvre. Ses paris sans pronostic sont retirés ; ceux déjà joués vont jusqu’à leur résultat. Une confirmation est demandée.'),
            h('p.small.muted', '« Lue il y a… » : la dernière fois que la source a répondu, depuis le démarrage du serveur. Une source qu’aucun groupe n’utilise n’est pas lue.'))))),
    mounted: () => { if (focus) document.getElementById(`source-${focus}`)?.scrollIntoView({ block: 'center' }); },
  };
}
