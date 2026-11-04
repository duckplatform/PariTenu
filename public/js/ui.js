import { face } from './avatars.js';
import { h } from './dom.js';
import { ctx, memberOf } from './state.js';

export const GROUP_EMOJIS = ['🏆', '⚽', '🏀', '🏈', '🏉', '🎾', '🏒', '🏎️', '🏍️', '🥊', '🍻', '🔥', '⚡', '🎯', '🏟️', '🥇'];
export const REACTIONS = ['😂', '🔥', '😱', '👏', '🤡', '🙈'];

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  const el = h('div.toast', { class: `toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3500);
  setTimeout(() => el.remove(), 3900);
}

/** Lance une action sur clic : bouton désactivé pendant l'appel, erreur affichée. Renvoie undefined en cas d'échec. */
export async function run(button, fn, { success } = {}) {
  if (button) button.disabled = true;
  try {
    const result = await fn();
    if (success) toast(success, 'ok');
    return result ?? true;
  } catch (err) {
    toast(err.message || 'Erreur inattendue.', 'error');
    return undefined;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

/** Panneau modal en bas d'écran. build(close) construit le contenu ; la promesse rend la valeur passée à close. */
export function openSheet(title, build) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const backdrop = h('div.sheet-backdrop');
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    function close(value = null) {
      document.removeEventListener('keydown', onKey);
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 160);
      previous?.focus?.();
      resolve(value);
    }
    const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer', onclick: () => close(null) }, '✕')),
      build(close));
    backdrop.append(panel);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    (panel.querySelector('textarea, input:not([type=radio]), select') ?? panel.querySelector('.btn.primary'))?.focus();
  });
}

export function confirmSheet(title, message, { confirm = 'Confirmer', danger = false } = {}) {
  return openSheet(title, (close) => h('div.stack',
    h('p', message),
    h('div.row-end',
      h('button.btn', { type: 'button', onclick: () => close(false) }, 'Retour'),
      h('button.btn', { type: 'button', class: danger ? 'danger' : 'primary', onclick: () => close(true) }, confirm)),
  )).then((v) => v === true);
}

/** Demande un texte (motif, précision…) ; rend la chaîne saisie ou null. */
export function promptSheet(title, { label, placeholder = '', confirm = 'Valider', max = 280, required = true, intro, danger = false } = {}) {
  return openSheet(title, (close) => {
    const input = h('textarea', { rows: 3, maxlength: max, placeholder, 'aria-label': label ?? title });
    const err = h('p.form-error', { role: 'alert' });
    return h('form.stack', {
      onsubmit: (e) => {
        e.preventDefault();
        if (required && !input.value.trim()) { err.textContent = 'Écris quelques mots.'; return; }
        close(input.value.trim());
      },
    }, intro ? h('p', intro) : null, label ? h('label.field', h('span.label', label), input) : input, err,
    h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn', { type: 'submit', class: danger ? 'danger' : 'primary' }, confirm)));
  });
}

export function avatar(id, { size = '', withName = false } = {}) {
  const m = memberOf(id);
  return h('span.avatar', { class: size, title: m.pseudo, 'aria-label': m.pseudo }, face(m.avatar), withName ? h('span.avatar-name', m.pseudo) : null);
}

/** Mon avatar et mon pseudo, en haut des pages principales (Paris, Direct, Classements, Activité) : mène à « Moi ». */
export const meLink = () => h('a.me-link', { href: `/g/${ctx.gid}/me`, title: 'Moi', 'aria-label': `Moi : ${ctx.me.pseudo}` },
  h('span.avatar', { 'aria-hidden': 'true' }, face(ctx.me.avatar)), h('span.me-name', { 'aria-hidden': 'true' }, ctx.me.pseudo));

export const who = (id) => {
  const m = memberOf(id);
  return h('span.who', h('span.avatar.xs', { 'aria-hidden': 'true' }, face(m.avatar)), ` ${m.pseudo}`);
};

/** Grille d'emojis à choix unique ; .value donne l'emoji choisi. */
export function emojiPicker(list, initial, { label = 'Choisis un emoji' } = {}) {
  let value = initial;
  const buttons = list.map((e) => h('button.emoji-choice', {
    type: 'button', role: 'radio', 'aria-checked': String(e === initial), 'aria-label': e,
    onclick: () => {
      value = e;
      for (const b of buttons) b.setAttribute('aria-checked', String(b.textContent === e));
    },
  }, e));
  const el = h('div.emoji-grid', { role: 'radiogroup', 'aria-label': label }, buttons);
  return { el, get value() { return value; } };
}

export const pinInput = (props = {}) => h('input.pin', {
  type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', placeholder: '••••', ...props,
});

export const field = (label, input, hint) => h('label.field', h('span.label', label), input, hint ? h('small.hint', hint) : null);

/** Partage natif du téléphone (WhatsApp…), sinon copie dans le presse-papiers. */
export async function share({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Copié ! Colle-le dans le groupe WhatsApp.', 'ok');
  } catch {
    openSheet('Partager', () => h('div.stack', h('p', 'Copie ce texte et colle-le dans le groupe :'),
      h('textarea.copy', { readonly: true, rows: 4, value: `${text}\n${url}` })));
  }
}

export const empty = (emoji, title, text, ...actions) => h('div.empty', h('div.empty-emoji', emoji), h('h2', title), text ? h('p.muted', text) : null, actions);
