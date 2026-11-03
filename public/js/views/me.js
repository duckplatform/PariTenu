import { avatarPicker, face } from '../avatars.js';
import { patch, post } from '../api.js';
import { h } from '../dom.js';
import { ctx, inviteUrl, invalidate, navigate } from '../state.js';
import { forgetGroup, setGroups } from '../store.js';
import { confirmSheet, field, pinInput, run, toast } from '../ui.js';
import { inviteCard } from './home.js';

/** Invitation d'installation (Chrome/Android) mise de côté par main.js. */
export const install = { prompt: null };

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return h('section.card.stack',
    h('h2', '📲 Installer l’app'),
    install.prompt
      ? h('button.btn.primary.wide', {
        type: 'button',
        onclick: async () => {
          install.prompt.prompt();
          await install.prompt.userChoice.catch(() => null);
          install.prompt = null;
        },
      }, 'Ajouter à l’écran d’accueil')
      : h('p.muted', ios
        ? 'Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ».'
        : 'Dans le menu du navigateur : « Installer l’application » ou « Ajouter à l’écran d’accueil ».'));
}

export async function meView() {
  const me = ctx.me;
  // Mon compte : pseudo, avatar et PIN, les mêmes dans tous mes groupes (changés partout d'un coup).
  const picker = avatarPicker(me.avatar);
  const pseudo = h('input', { name: 'pseudo', maxlength: 20, value: me.pseudo, autocomplete: 'nickname', required: true });
  const saveIdentity = h('button.btn', {
    type: 'button',
    onclick: async (e) => {
      const body = { pseudo: pseudo.value.trim(), avatar: picker.value };
      if (await run(e.currentTarget, () => patch('/account', body), { success: 'C’est changé dans tous tes groupes.' })) {
        invalidate();
        navigate(`/${ctx.gid}/me`);
      }
    },
  }, 'Enregistrer');

  const current = pinInput({ 'aria-label': 'PIN actuel' });
  const next = pinInput({ 'aria-label': 'Nouveau PIN' });
  const next2 = pinInput({ 'aria-label': 'Nouveau PIN (confirmation)' });
  const pinErr = h('p.form-error', { role: 'alert' });
  const pinForm = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      pinErr.textContent = '';
      if (!/^\d{4}$/.test(next.value)) { pinErr.textContent = 'Le PIN fait 4 chiffres.'; return; }
      if (next.value !== next2.value) { pinErr.textContent = 'Les deux nouveaux PIN ne sont pas identiques.'; return; }
      const button = e.target.querySelector('button[type=submit]');
      if (await run(button, () => post('/account/pin', { current: current.value, next: next.value }), { success: 'PIN changé, pour tous tes groupes.' })) {
        for (const i of [current, next, next2]) i.value = '';
      }
    },
  }, h('div.pin-row', field('PIN actuel', current), field('Nouveau', next), field('Encore', next2)), pinErr,
  h('button.btn', { type: 'submit' }, 'Changer mon PIN'));

  const leave = async (e) => {
    const ok = await confirmSheet('Quitter le groupe ?', 'Ton pseudo sera anonymisé et tes pronostics sur les paris encore ouverts seront retirés. Tes points restent dans l’historique.', { confirm: 'Quitter', danger: true });
    if (ok && await run(e.currentTarget, () => post(`/groups/${ctx.gid}/me/leave`))) {
      forgetGroup(ctx.gid);
      toast('Tu as quitté le groupe.', 'ok');
      navigate('/groups');
    }
  };
  const logout = async (e) => {
    if (await run(e.currentTarget, () => post('/account/logout'))) {
      setGroups([]);
      toast('Déconnecté de tous tes groupes sur cet appareil. Ton pseudo et ton PIN te reconnectent.', 'ok');
      navigate('/groups');
    }
  };

  const node = h('main.me',
    h('header.topbar', h('h1', '👤 Moi')),
    h('section.profile-head',
      h('div.profile-avatar', face(me.avatar)),
      h('h1', me.pseudo),
      h('p.muted', `${me.role === 'admin' ? 'Admin de' : 'Membre de'} ${ctx.group.emoji} ${ctx.group.name}`),
      h('a.btn', { href: `/${ctx.gid}/members/${me.id}` }, 'Mon profil et mes stats')),
    inviteCard(),
    h('p.invite-link', h('code', inviteUrl())),
    installCard(),
    h('a.card.list-item', { href: `/${ctx.gid}/follow` }, h('span.big-emoji', '🏟️'), h('span.grow', h('b', 'Mes compétitions'),
      h('br'), h('small.muted', 'Choisis les compétitions du groupe dont tu veux voir les paris')), h('span.chev', '›')),
    h('a.card.list-item', { href: '/help' }, h('span.big-emoji', '❓'), h('span.grow', h('b', 'Aide et règles'),
      h('br'), h('small.muted', 'Comment se calculent les points, les saisons, les compétitions…')), h('span.chev', '›')),
    h('section.card.stack', h('h2', 'Mon compte'),
      h('p.muted', 'Ton pseudo, ton avatar et ton PIN sont les mêmes dans tous tes groupes : les changer ici les change partout. Pour te connecter ailleurs : ton pseudo et ton PIN, depuis le lien d’un de tes groupes.'),
      field('Mon pseudo', pseudo), picker.el, saveIdentity),
    h('section.card.stack', h('h2', 'Mon PIN'), pinForm),
    h('section.card.stack',
      h('a.btn', { href: '/groups' }, 'Mes groupes'),
      h('button.btn', { type: 'button', onclick: logout }, 'Me déconnecter de cet appareil (tous mes groupes)'),
      h('button.btn.danger', { type: 'button', onclick: leave }, 'Quitter le groupe')));
  return { node, tab: 'me' };
}
