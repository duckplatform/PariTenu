import { identityFields, SPORTS } from '../avatars.js';
import { ApiError, get, post } from '../api.js';
import { h } from '../dom.js';
import { loadGroup, navigate, rerender } from '../state.js';
import { rememberGroup } from '../store.js';
import { field, pinInput, toast } from '../ui.js';
import { accountRow, afterLogin, loginForm, switchAccount } from './login.js';

/**
 * Arrivée par le lien d'invitation /invite/<jeton>. Connecté : on entre d'un geste avec son compte. Sinon : créer son compte
 * (nouveau) ou se connecter (pseudo + PIN, en touchant son avatar si on est déjà dans le groupe).
 */
export async function inviteView(route) {
  let info;
  try {
    info = await get(`/invite/${route.token}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return {
        node: h('main.welcome', h('div.card.center.stack',
          h('div.empty-emoji', '🔗'), h('h1', 'Lien expiré'), h('p', err.message),
          h('a.btn.wide', { href: '/' }, 'Accueil'))),
      };
    }
    throw err;
  }
  const { group } = info;
  const target = route.betId ? `/${group.id}/bet/${route.betId}` : `/${group.id}`;

  // Déjà dans le groupe, connecté sur cet appareil : on entre directement.
  if (info.signedIn) {
    await loadGroup(group.id, { force: true });
    navigate(target, { replace: true });
    return null;
  }

  const enter = (message) => {
    rememberGroup({ ...group, inviteToken: route.token });
    if (message) toast(message, 'ok');
    navigate(target, { replace: true });
  };
  /** Rejoindre avec le compte connecté (rien à retaper). */
  const joinAsMe = async () => {
    const { already } = await post(`/invite/${route.token}/join`, {});
    return already;
  };

  const panel = h('div.stack');
  if (info.account) {
    const err = h('p.form-error', { role: 'alert' });
    const submit = h('button.btn.primary.wide', {
      type: 'button',
      onclick: async () => {
        submit.disabled = true;
        try {
          await joinAsMe();
          enter(`Bienvenue dans ${group.name} !`);
        } catch (error) {
          err.textContent = error.message;
          submit.disabled = false;
        }
      },
    }, `Entrer dans ${group.name}`);
    panel.append(
      accountRow(info.account, {
        note: 'Tu entres avec ton compte',
        onSwitch: () => switchAccount(rerender),
      }),
      err, submit);
  } else {
    const tabs = h('div.segmented', { role: 'tablist' });
    const body = h('div');
    const showTab = (name) => {
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
      body.replaceChildren(name === 'new' ? joinForm() : loginForm({
        inviteToken: route.token,
        members: info.members,
        onDone: async (result) => {
          await afterLogin(result);
          // Connecté : on entre (en rejoignant le groupe si ce compte n'y était pas encore).
          const already = await joinAsMe();
          enter(already ? null : `Bienvenue dans ${group.name} !`);
        },
      }));
      body.querySelector('input')?.focus();
    };
    tabs.append(
      h('button', { type: 'button', role: 'tab', dataset: { tab: 'new' }, onclick: () => showTab('new') }, 'Je suis nouveau'),
      h('button', { type: 'button', role: 'tab', dataset: { tab: 'back' }, onclick: () => showTab('back') }, 'J’ai déjà un compte'));
    panel.append(tabs, body);
    showTab('new');
  }

  function joinForm() {
    const me = identityFields({ defaultAvatar: SPORTS[Math.floor(Math.random() * 10)] });
    const pin = pinInput({ name: 'pin', 'aria-label': 'PIN' });
    const pin2 = pinInput({ name: 'pin2', 'aria-label': 'PIN (confirmation)' });
    const err = h('p.form-error', { role: 'alert' });
    const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Entrer dans le groupe');
    return h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (!/^\d{4}$/.test(pin.value)) { err.textContent = 'Le PIN fait 4 chiffres.'; return; }
        if (pin.value !== pin2.value) { err.textContent = 'Les deux PIN ne sont pas identiques.'; return; }
        submit.disabled = true;
        try {
          await post(`/invite/${route.token}/join`, { pseudo: me.pseudo, avatar: me.avatar, pin: pin.value });
          enter(`Bienvenue dans ${group.name} !`);
        } catch (error) {
          err.textContent = error.message;
          submit.disabled = false;
        }
      },
    },
    me.el,
    h('div.pin-row', field('Choisis un PIN (4 chiffres)', pin), field('Encore une fois', pin2)),
    h('small.hint', 'Ton pseudo et ton PIN forment ton compte : ils te connectent à tous tes groupes, sur un autre téléphone ou sur ton PC.'),
    err, submit);
  }

  const node = h('main.welcome',
    h('header.hero.small', h('div.hero-emoji', group.emoji), h('p.muted', 'Tu es invité à rejoindre'), h('h1', group.name),
      h('p.tagline', 'Des paris gratuits entre amis : bon pronostic = des points, et un classement pour savoir qui a le plus de flair.')),
    h('section.card.stack', panel));
  return { node, title: `Rejoindre ${group.name}` };
}
