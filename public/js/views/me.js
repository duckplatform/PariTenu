import { avatarPicker, face } from '../avatars.js';
import { patch, post } from '../api.js';
import { credits } from '../brand.js';
import { h } from '../dom.js';
import { activeMembers, ctx, groupUrl, invalidate, navigate } from '../state.js';
import { forgetGroup, setGroups } from '../store.js';
import { confirmSheet, field, openSheet, pinInput, run, toast } from '../ui.js';
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
        navigate(`/g/${ctx.gid}/me`);
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

  // Quitter : le dernier membre emporte le groupe ; le seul admin nomme d'abord son successeur (personne n'est promu
  // d'office, demande du 2026-11-04) ou supprime le groupe depuis ses réglages.
  const leave = async (e) => {
    const button = e.currentTarget;
    const others = activeMembers().filter((m) => m.id !== ctx.me.id);
    const back = 'Tu pourras revenir quand tu veux par le lien du groupe : tu retrouveras ta place, tes points et ton historique.';
    let body = {};
    if (!others.length) {
      const gone = [...ctx.members.values()].some((m) => m.status !== 'active');
      const ok = await confirmSheet('Quitter et supprimer le groupe ?', `Tu es le dernier membre : le groupe sera supprimé, avec ses paris, ses classements et son historique.${gone ? ' Ceux qui en sont partis ou en ont été bannis ne pourront plus y revenir.' : ''}`, { confirm: 'Quitter et supprimer', danger: true });
      if (!ok) return;
    } else if (ctx.me.role === 'admin' && !others.some((m) => m.role === 'admin')) {
      const successor = await openSheet('Passer le relais', (close) => {
        const who = h('select', { name: 'successor', required: true }, h('option', { value: '' }, 'Choisis un membre…'),
          others.map((m) => h('option', { value: m.id }, m.pseudo)));
        return h('form.stack', { onsubmit: (ev) => { ev.preventDefault(); close(who.value || null); } },
          h('p', 'Tu es le seul admin du groupe : avant de partir, choisis parmi les membres qui prend le relais.'),
          field('Nouvel admin', who),
          h('p.muted', `Après ton départ, ton nom s’affichera « ${ctx.me.pseudo} (parti) » dans le groupe. ${back}`),
          h('button.btn.ghost.small', { type: 'button', onclick: () => { close(null); navigate(`/g/${ctx.gid}/admin`); } }, 'Supprimer plutôt le groupe pour tout le monde…'),
          h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.danger', { type: 'submit' }, 'Nommer et partir')));
      });
      if (!successor) return;
      body = { successor };
    } else {
      const ok = await confirmSheet('Quitter le groupe ?', `Tu y apparaîtras comme « ${ctx.me.pseudo} (parti) » et tes pronostics sur les paris encore ouverts seront retirés. ${back}`, { confirm: 'Quitter', danger: true });
      if (!ok) return;
    }
    const result = await run(button, () => post(`/groups/${ctx.gid}/me/leave`, body));
    if (!result) return;
    forgetGroup(ctx.gid);
    toast(result.deleted ? 'Tu as quitté le groupe : il est supprimé.' : 'Tu as quitté le groupe.', 'ok');
    navigate('/g');
  };
  const logout = async (e) => {
    if (await run(e.currentTarget, () => post('/account/logout'))) {
      setGroups([]);
      toast('Déconnecté de tous tes groupes sur cet appareil. Ton pseudo et ton PIN te reconnectent.', 'ok');
      navigate('/g');
    }
  };

  const node = h('main.me',
    h('header.topbar', h('h1', '👤 Moi')),
    h('section.profile-head',
      h('div.profile-avatar', face(me.avatar)),
      h('h1', me.pseudo),
      h('p.muted', `${me.role === 'admin' ? 'Admin de' : 'Membre de'} ${ctx.group.emoji} ${ctx.group.name}`),
      h('a.btn', { href: `/g/${ctx.gid}/members/${me.id}` }, 'Mon profil et mes stats')),
    inviteCard(),
    h('p.invite-link', h('code', groupUrl())),
    installCard(),
    h('a.card.list-item', { href: `/g/${ctx.gid}/follow` }, h('span.big-emoji', '🏟️'), h('span.grow', h('b', 'Mes compétitions'),
      h('br'), h('small.muted', 'Choisis les compétitions du groupe dont tu veux voir les paris')), h('span.chev', '›')),
    h('a.card.list-item', { href: '/help' }, h('span.big-emoji', '❓'), h('span.grow', h('b', 'Aide et règles'),
      h('br'), h('small.muted', 'Comment se calculent les points, les saisons, les compétitions…')), h('span.chev', '›')),
    h('section.card.stack', h('h2', 'Mon compte'),
      h('p.muted', 'Ton pseudo, ton avatar et ton PIN sont les mêmes dans tous tes groupes : les changer ici les change partout. Pour te connecter ailleurs : ton pseudo et ton PIN, depuis le lien d’un de tes groupes.'),
      field('Mon pseudo', pseudo), picker.el, saveIdentity),
    h('section.card.stack', h('h2', 'Mon PIN'), pinForm),
    h('section.card.stack',
      h('a.btn', { href: '/g' }, 'Mes groupes'),
      h('button.btn', { type: 'button', onclick: logout }, 'Me déconnecter de cet appareil (tous mes groupes)'),
      h('button.btn.danger', { type: 'button', onclick: leave }, 'Quitter le groupe')),
    h('div.me-credits.muted.center', credits()));
  return { node, tab: 'me' };
}
