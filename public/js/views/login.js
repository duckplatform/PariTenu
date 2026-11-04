import { face } from '../avatars.js';
import { ApiError, get, post } from '../api.js';
import { h } from '../dom.js';
import { setGroups } from '../store.js';
import { field, pinInput, toast } from '../ui.js';

/** Mon compte, en une ligne : avatar, pseudo et de quoi changer de compte (appareil partagé). */
export function accountRow(account, { note = 'Ton compte, le même dans tous tes groupes', onSwitch } = {}) {
  return h('div.identity-row', h('span.avatar.lg', face(account.avatar)),
    h('span.grow', h('b', account.pseudo), h('br'), h('small.muted', note)),
    onSwitch ? h('button.btn.small', { type: 'button', onclick: onSwitch }, 'Ce n’est pas moi') : null);
}

/** Se déconnecter de cet appareil (tous ses groupes d'un coup), puis fn. */
export async function switchAccount(fn) {
  await post('/account/logout').catch(() => null);
  setGroups([]);
  fn();
}

/** Après une connexion : le bon message et mes groupes, retrouvés d'un coup. */
export async function afterLogin({ account, newPin, unified }) {
  const { groups } = await get('/account');
  setGroups(groups);
  if (newPin) toast('Nouveau PIN enregistré : il vaut dans tous tes groupes.', 'ok');
  else if (unified) toast(`Re-bonjour ${account.pseudo} ! Ce PIN vaut désormais dans tous tes groupes.`, 'ok');
  else toast(`Re-bonjour ${account.pseudo} !`, 'ok');
  return groups;
}

/**
 * Se connecter à son compte : pseudo + PIN, seulement depuis l'adresse d'un groupe (group : le serveur refuse sans).
 * Rien n'y montre les membres du groupe (ni pseudos ni avatars) ; un PIN réinitialisé s'y choisit (le serveur le dit).
 */
export function loginForm({ group, onDone }) {
  const pseudo = h('input', { name: 'login-pseudo', maxlength: 20, placeholder: 'Ton pseudo', autocomplete: 'username', required: true });
  const pin = pinInput({ name: 'login-pin', 'aria-label': 'PIN' });
  const pin2 = pinInput({ name: 'login-pin2', 'aria-label': 'PIN (confirmation)' });
  const confirmRow = h('div', { hidden: true }, field('Encore une fois', pin2));
  const notice = h('p.notice', { hidden: true });
  const err = h('p.form-error', { role: 'alert' });
  const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Me connecter');
  let choosing = false; // PIN réinitialisé : celui qu'on tape devient le nouveau (tapé deux fois)
  const choose = (on, message = '') => {
    choosing = on;
    confirmRow.hidden = !on;
    notice.hidden = !on;
    notice.textContent = message;
  };

  return h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!/^\d{4}$/.test(pin.value)) { err.textContent = 'Le PIN fait 4 chiffres.'; return; }
      if (choosing && pin.value !== pin2.value) { err.textContent = 'Les deux PIN ne sont pas identiques.'; return; }
      submit.disabled = true;
      try {
        const result = await post('/account/login', {
          pseudo: pseudo.value.trim(), pin: pin.value, group, ...(choosing ? { newPin: true } : {}),
        });
        await onDone(result);
      } catch (error) {
        submit.disabled = false;
        if (error instanceof ApiError && error.code === 'choose_pin') {
          choose(true, error.message);
          pin2.focus();
          return;
        }
        err.textContent = error.message;
        pin.value = '';
        pin2.value = '';
        pin.focus();
      }
    },
  },
  field('Ton pseudo', pseudo),
  field('Ton PIN', pin),
  notice, confirmRow, err, submit);
}
