// Avatars sportifs. Une valeur d'avatar (≤ 16 caractères, stockée telle quelle) est :
//   · un emoji (sports, sportifs en action) ;
//   · un drapeau « f:fr » — dessiné en SVG, car Windows n'affiche pas les drapeaux emoji ;
//   · un maillot « j:3:9:10 » — couleur du maillot, couleur des manches et du numéro (index de COLORS), numéro 0 à 99
//     (deux chiffres au plus, vérifié aussi par le serveur).
// face(valeur) rend le dessin ; avatarPicker() permet de choisir (et de composer son maillot).
import { h } from './dom.js';

export const SPORTS = ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🥊', '🏒', '⛳', '🏓', '🏸', '🏎️', '🏍️', '🚴', '⛷️', '🥅', '🏆', '🥇', '🎯'];
export const PLAYERS = ['⛹️', '⛹️‍♀️', '🏃', '🏃‍♀️', '🤾', '🤾‍♀️', '🏌️', '🏄', '🚴‍♀️', '🤸', '🧗', '🏋️', '🏋️‍♀️', '🤼', '🤺', '🏇', '🏊', '🤽', '🥷', '🧑‍✈️'];
export const COLORS = [
  ['#0b1426', 'Nuit'], ['#ffffff', 'Blanc'], ['#d62828', 'Rouge'], ['#1d4ed8', 'Bleu'], ['#38bdf8', 'Ciel'], ['#00a651', 'Vert'],
  ['#c8f31d', 'Fluo'], ['#fbbf24', 'Or'], ['#ff6b1a', 'Orange'], ['#7c3aed', 'Violet'], ['#e11d74', 'Rose'], ['#6b7280', 'Gris'],
];

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// ——— Drapeaux (viewBox 30 × 20)
const rect = (x, y, w, hh, fill) => svg('rect', { x, y, width: w, height: hh, fill });
const vertical = (...c) => c.map((fill, i) => rect((30 / c.length) * i, 0, 30 / c.length + 0.1, 20, fill));
const horizontal = (...c) => c.map((fill, i) => rect(0, (20 / c.length) * i, 30, 20 / c.length + 0.1, fill));
const circle = (cx, cy, r, fill) => svg('circle', { cx, cy, r, fill });
/** Étoile à 5 branches de centre (cx, cy) et de rayon r. */
function star(cx, cy, r, fill, attrs = {}) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  });
  return svg('polygon', { points: pts.join(' '), fill, ...attrs });
}
const cross = (bg, fg, x = 11) => [rect(0, 0, 30, 20, bg), rect(x - 2, 0, 4, 20, fg), rect(0, 8, 30, 4, fg)];

export const FLAGS = {
  fr: ['France', () => vertical('#002654', '#ffffff', '#ce1126')],
  be: ['Belgique', () => vertical('#000000', '#fdda24', '#ef3340')],
  it: ['Italie', () => vertical('#009246', '#ffffff', '#ce2b37')],
  es: ['Espagne', () => [rect(0, 0, 30, 20, '#aa151b'), rect(0, 5, 30, 10, '#f1bf00')]],
  pt: ['Portugal', () => [rect(0, 0, 30, 20, '#da291c'), rect(0, 0, 12, 20, '#046a38'), circle(12, 10, 3.6, '#ffcc29')]],
  de: ['Allemagne', () => horizontal('#000000', '#dd0000', '#ffce00')],
  nl: ['Pays-Bas', () => horizontal('#ae1c28', '#ffffff', '#21468b')],
  gb: ['Angleterre', () => [rect(0, 0, 30, 20, '#ffffff'), rect(13, 0, 4, 20, '#ce1124'), rect(0, 8, 30, 4, '#ce1124')]],
  sc: ['Écosse', () => [rect(0, 0, 30, 20, '#005eb8'), svg('path', { d: 'M0 0L30 20M30 0L0 20', stroke: '#ffffff', 'stroke-width': 3.4 })]],
  ie: ['Irlande', () => vertical('#169b62', '#ffffff', '#ff883e')],
  ch: ['Suisse', () => [rect(0, 0, 30, 20, '#da291c'), rect(13, 4, 4, 12, '#ffffff'), rect(9, 8, 12, 4, '#ffffff')]],
  se: ['Suède', () => cross('#006aa7', '#fecc00')],
  dk: ['Danemark', () => cross('#c8102e', '#ffffff')],
  pl: ['Pologne', () => horizontal('#ffffff', '#dc143c')],
  ua: ['Ukraine', () => horizontal('#0057b7', '#ffd700')],
  br: ['Brésil', () => [rect(0, 0, 30, 20, '#009c3b'), svg('polygon', { points: '15,2.5 27,10 15,17.5 3,10', fill: '#ffdf00' }), circle(15, 10, 4.2, '#002776')]],
  ar: ['Argentine', () => [...horizontal('#74acdf', '#ffffff', '#74acdf'), circle(15, 10, 2.2, '#f6b40e')]],
  mx: ['Mexique', () => [...vertical('#006847', '#ffffff', '#ce1126'), circle(15, 10, 2.4, '#8c6d1f')]],
  us: ['États-Unis', () => [...horizontal('#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234'), rect(0, 0, 13, 11.5, '#3c3b6e')]],
  jp: ['Japon', () => [rect(0, 0, 30, 20, '#ffffff'), circle(15, 10, 6, '#bc002d')]],
  sn: ['Sénégal', () => [...vertical('#00853f', '#fdef42', '#e31b23'), star(15, 10, 3.6, '#00853f')]],
  ci: ['Côte d’Ivoire', () => vertical('#f77f00', '#ffffff', '#009e60')],
  cm: ['Cameroun', () => [...vertical('#007a5e', '#ce1126', '#fcd116'), star(15, 10, 3.2, '#fcd116')]],
  ma: ['Maroc', () => [rect(0, 0, 30, 20, '#c1272d'), star(15, 10, 5, 'none', { stroke: '#006233', 'stroke-width': 1.2 })]],
  dz: ['Algérie', () => [rect(0, 0, 15, 20, '#006233'), rect(15, 0, 15, 20, '#ffffff'),
    circle(15, 10, 5, '#d21034'), circle(16.5, 10, 4, '#ffffff'), star(17.6, 10, 2.4, '#d21034')]],
  tn: ['Tunisie', () => [rect(0, 0, 30, 20, '#e70013'), circle(15, 10, 5, '#ffffff'), circle(15, 10, 3.6, '#e70013'), circle(16, 10, 3, '#ffffff'), star(16, 10, 2, '#e70013')]],
};

/** Maillot : corps, manches et numéro ; c1 et c2 sont des index de COLORS. */
function jersey(c1, c2, num) {
  const body = COLORS[c1]?.[0] ?? COLORS[0][0];
  const trim = COLORS[c2]?.[0] ?? COLORS[1][0];
  // Le numéro tient dans le corps du maillot (x de 13 à 27) : deux chiffres sont resserrés sur 10 unités au plus.
  const digits = String(Math.max(0, Math.min(99, num)));
  const text = svg('text', {
    x: 20, y: 29.5, 'text-anchor': 'middle', 'font-size': digits.length > 1 ? 10.5 : 12, 'font-weight': 800,
    'font-family': 'Bahnschrift, "DIN Alternate", "Arial Narrow", system-ui, sans-serif', fill: trim,
    ...(digits.length > 1 ? { textLength: 10, lengthAdjust: 'spacingAndGlyphs' } : {}),
  });
  text.textContent = digits;
  return svg('svg', { viewBox: '0 0 40 40', class: 'jersey', 'aria-hidden': 'true' },
    svg('path', { d: 'M14 4h12l9 6-4 7-4-2v21H13V15l-4 2-4-7z', fill: body, stroke: 'rgb(0 0 0 / 25%)', 'stroke-width': 0.8 }),
    svg('path', { d: 'M5 10l4 7 4-2v-4zM35 10l-4 7-4-2v-4z', fill: trim }),
    svg('path', { d: 'M15 4c1 3 3 4.5 5 4.5s4-1.5 5-4.5', fill: 'none', stroke: trim, 'stroke-width': 1.6 }),
    text);
}

const JERSEY = /^j:(\d{1,2}):(\d{1,2}):(\d{1,2})$/;
const FLAG = /^f:([a-z]{2})$/;

/** Ce que montre un avatar : un dessin (drapeau, maillot) ou l'emoji tel quel. */
export function face(value) {
  const j = JERSEY.exec(value ?? '');
  if (j) return jersey(Number(j[1]), Number(j[2]), Number(j[3]));
  const f = FLAG.exec(value ?? '');
  if (f && FLAGS[f[1]]) return svg('svg', { viewBox: '0 0 30 20', class: 'flag', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }, FLAGS[f[1]][1]());
  return value || '❔';
}

/** Version texte (listes déroulantes, partages) : l'emoji, ou une description courte. */
export function faceText(value) {
  const j = JERSEY.exec(value ?? '');
  if (j) return `#${j[3]}`;
  const f = FLAG.exec(value ?? '');
  if (f) return FLAGS[f[1]]?.[0] ?? '🏳️';
  return value || '❔';
}

/** Pseudo et avatar d'un nouveau compte (en créant ou en rejoignant un premier groupe). .el, .pseudo, .avatar. */
export function identityFields({ defaultAvatar = '⚽' } = {}) {
  const pseudo = h('input', { name: 'pseudo', maxlength: 20, placeholder: 'Ton pseudo', autocomplete: 'nickname', required: true });
  const picker = avatarPicker(defaultAvatar);
  const el = h('div.stack',
    h('label.field', h('span.label', 'Ton pseudo'), pseudo),
    h('div.field', h('span.label', 'Ton avatar'), picker.el),
    h('small.hint', 'Ton pseudo est à toi sur toute l’app : le même dans tous tes groupes.'));
  return { el, get pseudo() { return pseudo.value; }, get avatar() { return picker.value; } };
}

/** Choix d'avatar : onglets Sports, Joueurs, Drapeaux et Maillot ; .value donne la valeur choisie. */
export function avatarPicker(initial = '⚽', { label = 'Ton avatar' } = {}) {
  let value = initial;
  const preview = h('span.avatar.xl', face(value));
  const body = h('div.picker-body');
  const set = (v) => {
    value = v;
    preview.replaceChildren(face(v));
    for (const b of body.querySelectorAll('[role=radio]')) b.setAttribute('aria-checked', String(b.dataset.value === v));
  };
  const grid = (values) => h('div.emoji-grid', { role: 'radiogroup', 'aria-label': label }, values.map((v) => h('button.emoji-choice', {
    type: 'button', role: 'radio', 'aria-checked': String(v === value), 'aria-label': faceText(v), dataset: { value: v }, onclick: () => set(v),
  }, face(v))));
  const jerseyMaker = () => {
    const [, a = '3', b = '1', n = '10'] = JERSEY.exec(value) ?? [];
    let c1 = Number(a);
    let c2 = Number(b);
    let num = Number(n);
    const apply = () => set(`j:${c1}:${c2}:${num}`);
    const swatches = (current, pick, name) => h('div.swatches', { role: 'radiogroup', 'aria-label': name }, COLORS.map(([hex, label2], i) => h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': String(i === current), 'aria-label': `${name} : ${label2}`, title: label2,
      onclick: (e) => { pick(i); for (const s of e.currentTarget.parentElement.children) s.setAttribute('aria-checked', String(s === e.currentTarget)); apply(); },
    }, h('span.swatch-dot', { dataset: { color: hex } }))));
    // Deux chiffres au plus : le champ refuse tout le reste (un champ « number » laisse taper 123 ou 1e5).
    const number = h('input', {
      type: 'text', value: String(num), maxlength: 2, pattern: '[0-9]{1,2}', 'aria-label': 'Numéro', inputmode: 'numeric', autocomplete: 'off',
      oninput: (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
        if (digits !== e.target.value) e.target.value = digits;
        num = Number(digits || 0);
        apply();
      },
    });
    const el = h('div.stack.jersey-maker',
      h('div.field', h('span.label', 'Maillot'), swatches(c1, (i) => { c1 = i; }, 'Couleur du maillot')),
      h('div.field', h('span.label', 'Manches et numéro'), swatches(c2, (i) => { c2 = i; }, 'Couleur des manches')),
      h('label.field.number-field', h('span.label', 'Numéro'), number));
    for (const dot of el.querySelectorAll('.swatch-dot')) dot.style.background = dot.dataset.color;
    apply();
    return el;
  };
  const tabs = [['Sports', () => grid(SPORTS)], ['Joueurs', () => grid(PLAYERS)], ['Drapeaux', () => grid(Object.keys(FLAGS).map((c) => `f:${c}`))], ['Maillot', jerseyMaker]];
  const tabBar = h('div.segmented', { role: 'tablist', 'aria-label': 'Familles d’avatars' });
  const show = (i) => {
    tabBar.replaceChildren(...tabs.map(([name], k) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === i), onclick: () => show(k) }, name)));
    body.replaceChildren(tabs[i][1]());
  };
  show(JERSEY.test(initial) ? 3 : FLAG.test(initial) ? 2 : PLAYERS.includes(initial) ? 1 : 0);
  const el = h('div.avatar-picker', h('div.picker-head', preview, h('span.muted', 'Choisis ton avatar : sport, joueur, drapeau ou ton maillot.')), tabBar, body);
  return { el, get value() { return value; } };
}
