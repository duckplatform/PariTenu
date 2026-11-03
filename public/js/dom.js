// Aide DOM. Tout texte dynamique passe par textContent ou des attributs, jamais innerHTML :
// une question de pari, un pseudo ou un commentaire ne peut pas injecter de balises.

// Seuls des chemins du site, des ancres, des liens https et des téléchargements blob: peuvent devenir href/src.
const SAFE_URL = /^(\/(?!\/)|#|https:\/\/|blob:)/;

/** h('div.card#id', { attributs, propriétés, onclick… }, ...enfants) */
export function h(tag, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props !== undefined && props !== null) children.unshift(props);
    props = {};
  }
  const [, name, rest] = /^([a-z0-9-]+)(.*)$/i.exec(tag);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]);
    else el.id = m[2];
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') throw new Error('h() : les styles en ligne sont bloqués par la CSP, utilise une classe ou el.style');
    if ((k === 'href' || k === 'src') && !SAFE_URL.test(String(v))) throw new Error(`h() : ${k} non sûr « ${v} »`);
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Remplace le contenu d'un élément (tableaux aplatis, null et false ignorés). */
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Joint des classes en ignorant les valeurs vides. */
export const cls = (...names) => names.filter(Boolean).join(' ');
