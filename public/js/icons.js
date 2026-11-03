// Icônes au trait (dessins de Lucide, licence ISC) pour la structure de l'app : navigation, barres, titres de section,
// états des paris. Les emoji changent d'un téléphone à l'autre ; ils restent pour ce que les joueurs choisissent
// (avatars, emoji des groupes et des catégories).
const NS = 'http://www.w3.org/2000/svg';

const p = (d) => ['path', { d }];
const c = (cx, cy, r) => ['circle', { cx, cy, r }];
const pl = (points) => ['polyline', { points }];

const SHAPES = {
  target: [c(12, 12, 10), c(12, 12, 6), c(12, 12, 2)],
  tv: [['rect', { width: 20, height: 15, x: 2, y: 7, rx: 2 }], pl('17 2 12 7 7 2')],
  trophy: [p('M6 9H4.5a2.5 2.5 0 0 1 0-5H6'), p('M18 9h1.5a2.5 2.5 0 0 0 0-5H18'), p('M4 22h16'),
    p('M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22'), p('M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22'),
    p('M18 2H6v7a6 6 0 0 0 12 0V2Z')],
  activity: [p('M22 12h-4l-3 9L9 3l-3 9H2')],
  user: [p('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), c(12, 7, 4)],
  users: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75')],
  plus: [p('M5 12h14'), p('M12 5v14')],
  down: [p('m6 9 6 6 6-6')],
  right: [p('m9 18 6-6-6-6')],
  clock: [c(12, 12, 10), pl('12 6 12 12 16 14')],
  check: [p('M20 6 9 17l-5-5')],
  x: [p('M18 6 6 18'), p('m6 6 12 12')],
  lock: [['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2 }], p('M7 11V7a5 5 0 0 1 10 0v4')],
  scale: [p('m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z'), p('m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z'), p('M7 21h10'), p('M12 3v18'),
    p('M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2')],
  flag: [p('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'), p('M4 22v-7')],
  radio: [p('M4.9 19.1C1 15.2 1 8.8 4.9 4.9'), p('M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5'), c(12, 12, 2), p('M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5'), p('M19.1 4.9C23 8.8 23 15.1 19.1 19')],
  compass: [c(12, 12, 10), ['polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' }]],
  help: [c(12, 12, 10), p('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), p('M12 17h.01')],
  scroll: [p('M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4'), p('M19 17V5a2 2 0 0 0-2-2H4')],
  settings: [p('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'), c(12, 12, 3)],
  // Admin du site
  dashboard: [['rect', { width: 7, height: 9, x: 3, y: 3, rx: 1 }], ['rect', { width: 7, height: 5, x: 14, y: 3, rx: 1 }],
    ['rect', { width: 7, height: 9, x: 14, y: 12, rx: 1 }], ['rect', { width: 7, height: 5, x: 3, y: 16, rx: 1 }]],
  ticket: [p('M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z'), p('M13 5v2'), p('M13 17v2'), p('M13 11v2')],
  search: [c(11, 11, 8), p('m21 21-4.3-4.3')],
  more: [c(12, 12, 1), c(19, 12, 1), c(5, 12, 1)],
  menu: [p('M4 12h16'), p('M4 6h16'), p('M4 18h16')],
  left: [p('m15 18-6-6 6-6')],
  logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), pl('16 17 21 12 16 7'), p('M21 12H9')],
  login: [p('M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'), pl('10 17 15 12 10 7'), p('M15 12H3')],
  external: [p('M15 3h6v6'), p('M10 14 21 3'), p('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')],
  unlock: [['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2 }], p('M7 11V7a5 5 0 0 1 9.9-1')],
  key: [p('M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'), c(16.5, 7.5, 0.5)],
  alert: [p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'), p('M12 9v4'), p('M12 17h.01')],
  copy: [['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2 }], p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
  link: [p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
  pencil: [p('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'), p('m15 5 4 4')],
  trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
  phone: [['rect', { width: 14, height: 20, x: 5, y: 2, rx: 2 }], p('M12 18h.01')],
  userPlus: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M19 8v6'), p('M22 11h-6')],
  userMinus: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M22 11h-6')],
  refresh: [p('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'), p('M21 3v5h-5'), p('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'), p('M8 16H3v5')],
  arrowDown: [p('M12 5v14'), p('m19 12-7 7-7-7')],
  arrowUp: [p('m5 12 7-7 7 7'), p('M12 19V5')],
  checkCircle: [c(12, 12, 10), p('m9 12 2 2 4-4')],
  shield: [p('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'), p('m9 12 2 2 4-4')],
  palette: [c(13.5, 6.5, 0.5), c(17.5, 10.5, 0.5), c(8.5, 7.5, 0.5), c(6.5, 12.5, 0.5),
    p('M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z')],
  image: [['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }], c(9, 9, 2), p('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21')],
  globe: [c(12, 12, 10), p('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'), p('M2 12h20')],
  home: [p('M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z')],
  building: [['rect', { width: 16, height: 20, x: 4, y: 2, rx: 2 }], p('M9 22v-4h6v4'), p('M8 6h.01'), p('M16 6h.01'), p('M12 6h.01'), p('M12 10h.01'), p('M12 14h.01'), p('M16 10h.01'), p('M16 14h.01'), p('M8 10h.01'), p('M8 14h.01')],
  ban: [c(12, 12, 10), p('m4.9 4.9 14.2 14.2')],
  pause: [['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }]],
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
};

/** <svg> d'une icône (décorative : le texte à côté, ou l'aria-label du bouton, dit ce qu'elle veut dire). */
export function icon(name, size = '') {
  const svg = document.createElementNS(NS, 'svg');
  const attrs = {
    class: `icon${size ? ` icon-${size}` : ''}`, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  for (const [tag, shape] of SHAPES[name]) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(shape)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
