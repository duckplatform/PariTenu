// Réglages d'un groupe, modifiables : points et délais, types des paris maison, catégories et paris automatiques.
// Partagés par les pages d'un admin du groupe (Réglages du groupe, Réglages des paris) et par l'admin du site (/admin).
import { fill, h } from './dom.js';
import { field, run, toast } from './ui.js';

const KINDS = [
  ['yesno', 'Oui / Non', 'Une question, deux réponses. Ex. : « Julien arrive en retard ? »'],
  ['multi', 'Choix multiples', 'De 2 à 8 réponses. Ex. : « Qui gagne le tournoi ? »'],
];

/** Interrupteur : une case à cocher (clavier, lecteurs d'écran) habillée en bouton glissant. */
export function toggle({ label, hint, checked, disabled = false, onchange, ariaLabel }) {
  return h('label.switch',
    h('span.switch-box',
      h('input', { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': ariaLabel, onchange: (e) => onchange(e.target.checked) }),
      h('span.switch-track', { 'aria-hidden': 'true' })),
    label ? h('span.switch-text', h('b', label), hint ? h('small.hint', hint) : null) : null);
}

const placeLabel = (place) => (place.country ? `${place.name} (${place.country})` : place.name);

/** Points de base, plafond de cote, prime d'arbitre, délais, commentaires : { node, value() } (value : le corps à envoyer). */
export function pointsEditor(s) {
  const num = (value, attrs) => h('input', { type: 'number', inputmode: 'numeric', value: value ?? '', ...attrs });
  const basePoints = num(s.basePoints, { name: 'basePoints', min: 10, max: 1000, step: 10 });
  const oddsCap = num(s.oddsCap, { name: 'oddsCap', min: 1.5, max: 100, step: 0.5, placeholder: 'Aucun' });
  const arbiterBonus = num(s.arbiterBonus, { name: 'arbiterBonus', min: 0, max: 500, step: 5 });
  const validationHours = num(s.validationHours, { name: 'validationHours', min: 1, max: 168 });
  const voteHours = num(s.voteHours, { name: 'voteHours', min: 1, max: 168 });
  let comments = s.comments !== false;
  return {
    node: h('div.stack', h('div.grid-2',
      field('Points de base', basePoints, 'Multipliés par la cote'),
      field('Plafond de cote', oddsCap, 'Vide : pas de plafond'),
      field('Prime d’arbitre', arbiterBonus, 'Par pari bien tranché'),
      field('Validation (heures)', validationHours, 'Délai pour contester'),
      field('Vote (heures)', voteHours, 'Après une contestation')),
      toggle({ label: '💬 Commentaires sur les paris', hint: 'Désactivés : plus personne ne commente, et ils n’apparaissent plus (fiche d’un pari, page Activité).', checked: comments, onchange: (on) => { comments = on; } })),
    value: () => ({
      basePoints: Number(basePoints.value), oddsCap: oddsCap.value === '' ? null : Number(oddsCap.value),
      arbiterBonus: Number(arbiterBonus.value), validationHours: Number(validationHours.value), voteHours: Number(voteHours.value), comments,
    }),
  };
}

/**
 * Types des paris maison, catégories et sources de données : { kinds, categories } (le contenu de chaque section, sans
 * son titre) et value() ({ kinds, categories, sources } à envoyer). sources : la liste des sources telles que le groupe
 * les a réglées ; searchPlaces(q, button) : les villes trouvées (météo).
 */
export function betSettingsEditor({ settings, sources, searchPlaces }) {
  const kinds = { ...settings.kinds };
  const categories = settings.categories.map((c) => ({ ...c }));
  const config = Object.fromEntries(sources.map((s) => [s.id, { competitions: [...s.selected], params: structuredClone(s.values) }]));

  const kindNodes = [
    h('p.muted', 'Pour les paris lancés avec « Nouveau pari ». Un type désactivé disparaît du formulaire ; les paris déjà lancés continuent. Aucun type : pas de paris maison. Les compétitions n’en dépendent pas.'),
    ...KINDS.map(([id, label, hint]) => toggle({ label, hint, checked: kinds[id], onchange: (on) => { kinds[id] = on; } })),
  ];

  function paramEditor(p, cfg) {
    if (p.type === 'multi') {
      return h('div.field', h('span.label', p.label), h('div.chips.wrap', { role: 'group', 'aria-label': p.label }, p.choices.map((choice) => h('button.chip', {
        type: 'button', 'aria-pressed': String(cfg.params[p.key].includes(choice.id)),
        onclick: (e) => {
          const list = cfg.params[p.key];
          const i = list.indexOf(choice.id);
          if (i >= 0 && list.length === 1) { toast('Garde au moins un choix.', 'error'); return; }
          if (i >= 0) list.splice(i, 1);
          else list.push(choice.id);
          e.currentTarget.setAttribute('aria-pressed', String(i < 0));
        },
      }, choice.label))));
    }
    if (p.type === 'text') {
      return field(p.label, h('input', {
        type: 'text', maxlength: p.max, value: cfg.params[p.key], placeholder: p.placeholder ?? '',
        oninput: (e) => { cfg.params[p.key] = e.target.value; },
      }));
    }
    // Ville : recherche par nom, puis choix dans la liste (coordonnées pour la météo).
    const current = h('b', placeLabel(cfg.params[p.key]));
    const results = h('div.chips.wrap');
    const input = h('input', { type: 'text', maxlength: 60, placeholder: 'Chercher une ville', 'aria-label': 'Chercher une ville' });
    const button = h('button.btn.small', { type: 'button' }, 'Chercher');
    const search = async () => {
      const q = input.value.trim();
      if (q.length < 2) { toast('Tape au moins 2 lettres.', 'error'); return; }
      const places = await run(button, () => searchPlaces(q));
      if (!places) return;
      fill(results, places.length ? places.map((place) => h('button.chip', {
        type: 'button',
        onclick: () => {
          cfg.params[p.key] = place;
          current.textContent = placeLabel(place);
          input.value = '';
          fill(results);
        },
      }, `${place.name} · ${place.country}`)) : h('small.hint', 'Aucune ville trouvée.'));
    };
    button.addEventListener('click', search);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    return h('div.field', h('span.label', p.label), h('p', '📍 ', current), h('div.search-row', input, button), results);
  }

  // Sport : une puce par compétition (chacune a son classement). Autres sources : un interrupteur pour toute la source.
  // Indépendant de l'interrupteur de la catégorie, qui ne règle que les paris maison.
  function sourceCard(source) {
    const cfg = config[source.id];
    const on = cfg.competitions.length > 0;
    const picker = source.competitions
      ? h('div.chips.wrap', { role: 'group', 'aria-label': `Compétitions : ${source.name}` }, source.competitions.map((c) => h('button.chip', {
        type: 'button', 'aria-pressed': String(cfg.competitions.includes(c.id)),
        onclick: () => {
          const i = cfg.competitions.indexOf(c.id);
          if (i >= 0) cfg.competitions.splice(i, 1);
          else cfg.competitions.push(c.id);
          drawCategories();
        },
      }, c.label)))
      : null;
    return h('div.source-card', { class: on ? null : 'off', dataset: { source: source.id } },
      h('div.source-head',
        h('span.source-emoji', { 'aria-hidden': 'true' }, source.emoji),
        h('div.grow', h('b', source.name), h('small.hint', source.about)),
        source.competitions
          ? h('span.tag', { class: on ? 't-ok' : null }, cfg.competitions.length ? `${cfg.competitions.length} activée${cfg.competitions.length > 1 ? 's' : ''}` : 'Rien d’activé')
          : toggle({
            checked: cfg.competitions.length > 0, ariaLabel: `Paris automatiques : ${source.name}`,
            onchange: (value) => { cfg.competitions = value ? [source.id] : []; drawCategories(); },
          })),
      picker,
      on ? source.params.map((p) => paramEditor(p, cfg)) : null,
      h('small.source-credit', 'Données : ', h('a', { href: source.provider.url, target: '_blank', rel: 'noopener noreferrer' }, `${source.provider.name} ↗`)));
  }

  const catList = h('div.cat-config');
  function drawCategories() {
    fill(catList, categories.map((c) => {
      const own = sources.filter((s) => s.category === c.id);
      return h('div.cat-block', { class: c.hidden ? 'off' : null, dataset: { cat: c.id ?? '' } },
        h('div.cat-row',
          h('input.cat-emoji', { type: 'text', maxlength: 4, value: c.emoji, 'aria-label': 'Emoji', oninput: (e) => { c.emoji = e.target.value; } }),
          h('input', { type: 'text', maxlength: 30, value: c.label, 'aria-label': 'Nom de la catégorie', oninput: (e) => { c.label = e.target.value; } }),
          toggle({ label: 'Paris maison', checked: !c.hidden, ariaLabel: `Paris maison : ${c.label}`, onchange: (value) => { c.hidden = !value; drawCategories(); } })),
        own.length ? h('div.source-list', h('span.source-title', '📡 Paris ouverts tout seuls, résultat automatique'), own.map((s) => sourceCard(s))) : null);
    }));
  }
  drawCategories();

  const categoryNodes = [
    h('p.muted', h('b', 'Paris maison'), ' : ceux que les membres lancent avec « Nouveau pari », dans les catégories où ils sont activés (ceux en cours continuent si tu coupes). Aucune catégorie activée : pas de bouton « Nouveau pari ».'),
    h('p.muted', h('b', 'Paris automatiques'), ' : active une compétition, tous ses paris disponibles s’ouvrent tout seuls, le résultat arrive tout seul, et elle a son propre classement, saison par saison. Ils ne dépendent pas des paris maison ; aucune compétition n’est activée d’office.'),
    catList,
    h('button.btn.ghost', {
      type: 'button',
      onclick: () => {
        categories.push({ emoji: '⭐', label: 'Nouvelle catégorie', hidden: false });
        drawCategories();
        catList.lastElementChild?.querySelector('input:not(.cat-emoji)')?.select();
      },
    }, '＋ Ajouter une catégorie'),
    h('small.hint', 'Une catégorie ne se supprime pas (des paris l’utilisent peut-être) : désactive-la.'),
  ];

  return { kinds: kindNodes, categories: categoryNodes, value: () => ({ kinds, categories, sources: config }) };
}
