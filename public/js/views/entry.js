import { identityFields, SPORTS } from '../avatars.js';
import { ApiError, get, post } from '../api.js';
import { h } from '../dom.js';
import { invalidate, rerender } from '../state.js';
import { field, pinInput, toast } from '../ui.js';
import { accountRow, afterLogin, loginForm, switchAccount } from './login.js';

const whereIsTheLink = () => h('p.muted', 'Un membre du groupe le trouve dans l’app, page « Moi », « Invite tes amis ».');

/** Un lien qui ne mène plus nulle part : ce qu'il faut demander, et « Mes groupes » (un membre y retrouve les siens). */
function deadLinkView(title, text) {
  const node = h('main.welcome', h('div.card.center.stack',
    h('div.empty-emoji', '🔗'), h('h1', title), h('p', text), whereIsTheLink(),
    h('a.btn.wide', { href: '/groups' }, 'Mes groupes')));
  return { node, title };
}

/** /invite/<jeton> : les liens d'invitation n'existent plus (2026-11-04), un groupe se partage par son adresse. */
export const expiredInviteView = () => deadLinkView('Lien expiré',
  'Les liens d’invitation n’existent plus : un groupe se partage maintenant par son lien, son adresse. Demande-le à un membre du groupe.');

/** L'adresse d'un groupe inconnue, ou changée par un admin (fuite du lien). */
export const deadGroupView = (message) => deadLinkView('Lien périmé', message);

/**
 * L'adresse d'un groupe (/<groupe>, ou l'une de ses pages) sans en être membre : elle sert à y entrer et à s'y connecter.
 * Connecté : on entre d'un geste avec son compte. Sinon : créer son compte (nouveau) ou se connecter (pseudo + PIN, sans
 * rien qui montre les membres). Une fois dedans, la même adresse s'affiche (le groupe, ou le pari partagé).
 */
export async function entryView(route) {
  let info;
  try {
    info = await get(`/groups/${route.gid}/entry`);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'group_not_found') return deadGroupView(err.message);
    throw err;
  }
  const { group } = info;
  const enter = (message) => {
    if (message) toast(message, 'ok');
    invalidate();
    rerender();
  };
  // Déjà dans le groupe (connecté entre-temps, dans un autre onglet) : l'adresse s'affiche.
  if (info.signedIn) {
    enter(null);
    return null;
  }
  /** Rejoindre avec le compte connecté (rien à retaper). */
  const joinAsMe = async () => {
    const { already } = await post(`/groups/${route.gid}/join`, {});
    return already;
  };

  const panel = h('div.stack');
  if (info.account && info.banned) {
    // Banni par un admin : il ne revient pas de lui-même (demande du 2026-11-04).
    panel.append(
      accountRow(info.account, { note: 'Ton compte', onSwitch: () => switchAccount(rerender) }),
      h('p.notice#banni', 'Un admin t’a banni de ce groupe : seul un admin peut te réintégrer.'));
  } else if (info.account) {
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
        group: route.gid,
        onDone: async (result) => {
          await afterLogin(result);
          // Connecté : on entre (en rejoignant le groupe si ce compte n'y était pas encore). Banni : la page le dit.
          let already;
          try {
            already = await joinAsMe();
          } catch (error) {
            if (error instanceof ApiError && error.code === 'banned') { rerender(); return; }
            throw error;
          }
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
          await post(`/groups/${route.gid}/join`, { pseudo: me.pseudo, avatar: me.avatar, pin: pin.value });
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
    h('header.hero.small', h('div.hero-emoji', group.emoji), h('h1', group.name),
      h('p.tagline', 'Des paris gratuits entre amis : bon pronostic = des points, et un classement pour savoir qui a le plus de flair.')),
    h('section.card.stack#entree', panel));
  return { node, title: group.name };
}
