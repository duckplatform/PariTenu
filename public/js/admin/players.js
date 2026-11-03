// Comptes : la liste, et la fiche d'un compte ouverte à droite (PC) ou à sa place (téléphone) : groupes, appareils,
// état du PIN, actions. Création dans un groupe, modification, déblocage, PIN, déconnexion, suppression.
import { avatarPicker, face } from '../avatars.js';
import { cls, h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { confirmSheet, field, openSheet, run, toast } from '../ui.js';
import {
  adel, aget, ago, alertBox, apatch, apost, avatar, badge, button, clock, filters, go, moreMenu, pageHead, plural, PLAYER_STATES,
  stateBadge, table, tile, when,
} from './kit.js';

const ROLE = { admin: 'Admin du groupe', member: 'Membre' };
const STATUS = { left: ['A quitté', 'muted'], removed: ['Retiré', 'muted'] };

/** Choisir un groupe (et un rôle) : pour un nouveau compte ou pour en ajouter un existant. */
function groupPicker(groups, { exclude = [] } = {}) {
  const select = h('select', { name: 'group', required: true },
    h('option', { value: '' }, 'Choisis un groupe…'),
    groups.filter((g) => !exclude.includes(g.id)).map((g) => h('option', { value: g.id }, `${g.emoji} ${g.name}`)));
  const role = h('select', { name: 'role' }, h('option', { value: 'member' }, 'Membre'), h('option', { value: 'admin' }, 'Admin du groupe'));
  return { select, role, el: h('div.pin-row', field('Groupe', select), field('Rôle', role)) };
}

export async function newPlayer() {
  const { groups } = await aget('/groups');
  if (!groups.length) { toast('Crée d’abord un groupe : un compte entre toujours dans un groupe.', 'error'); return; }
  const created = await openSheet('Nouveau compte', (close) => {
    const name = h('input', { name: 'pseudo', maxlength: 20, required: true, autocomplete: 'off', placeholder: 'Julien' });
    const picker = avatarPicker('⚽', { label: 'Avatar' });
    const where = groupPicker(groups);
    const err = h('p.form-error', { role: 'alert' });
    const submit = h('button.btn.primary', { type: 'submit' }, 'Créer le compte');
    return h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          const { id } = await apost('/players', { pseudo: name.value.trim(), avatar: picker.value, groupId: where.select.value, role: where.role.value });
          close({ id, group: groups.find((g) => g.id === where.select.value) });
        } catch (error) {
          err.textContent = error.message;
        } finally {
          submit.disabled = false;
        }
      },
    }, h('p.muted', 'Le compte n’a pas de PIN : la personne ouvre le lien du groupe, touche son avatar et choisit son PIN.'),
    field('Pseudo', name), h('div.field', h('span.label', 'Avatar'), picker.el), where.el, err,
    h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), submit));
  });
  if (!created) return;
  toast(`Compte créé dans « ${created.group.name} ». Envoie-lui le lien du groupe pour qu’il choisisse son PIN.`, 'ok');
  go(`/admin/users/${created.id}`);
}

/** La liste des comptes ; avec un id, la fiche de ce compte à côté (sur téléphone : à la place de la liste). */
export async function playersView({ refresh, id = null }) {
  const [{ players }, detail] = await Promise.all([aget('/players'), id ? aget(`/players/${id}`) : null]);
  const p = detail?.player ?? null;
  const columns = [
    ['Compte', (x) => h('a.adm-who', { href: `/admin/users/${x.id}` }, avatar(x.avatar), h('b', x.pseudo)), { sort: (x) => x.pseudo }],
    ['Groupes', (x) => (x.groups ? plural(x.groups, 'groupe') : badge('Sans groupe', 'warn')), { sort: (x) => x.groups, desc: true }],
    ['État', (x) => stateBadge(PLAYER_STATES, x.state), { phone: 'side', sort: (x) => ['locked', 'new_pin', 'ok'].indexOf(x.state) }],
    ['Vu', (x) => (x.lastSeenAt ? ago(x.lastSeenAt) : h('span.muted', 'jamais')), { sort: (x) => x.lastSeenAt, desc: true }],
    ['Créé', (x) => when(x.createdAt, { day: true }), { phone: 'hide', sort: (x) => x.createdAt, desc: true }],
  ];
  const list = h('div');
  const show = ({ choice, text }) => fill(list, table(columns, players.filter((x) => (choice === 'all'
    || (choice === 'alone' ? x.groups === 0 : x.state === choice)) && (!text || x.pseudo.toLowerCase().includes(text))), {
    emptyText: 'Aucun compte ici.', href: (x) => `/admin/users/${x.id}`, rowClass: (x) => (x.id === id ? 'is-on' : ''), label: 'Comptes',
  }));
  const n = (fn) => players.filter(fn).length;
  const bar = filters({
    choices: [['all', 'Tous', players.length], ['locked', 'Bloqués', n((x) => x.state === 'locked')],
      ['new_pin', 'PIN à choisir', n((x) => x.state === 'new_pin')], ['alone', 'Sans groupe', n((x) => !x.groups)]],
    initial: new URLSearchParams(location.search).get('state'),
    placeholder: 'Chercher un pseudo',
    onChange: show,
  });
  show({ choice: bar.choice(), text: '' });
  const active = n((x) => x.lastSeenAt && Date.now() - x.lastSeenAt < 86_400_000);
  return {
    title: p ? p.pseudo : 'Comptes',
    node: h('div.adm-page', { class: p ? 'has-panel' : '' },
      pageHead({
        title: 'Comptes', sub: `${plural(players.length, 'compte')} · ${active} actif${active > 1 ? 's' : ''} ces dernières 24 h`,
        actions: [button('Nouveau compte', { icon: 'plus', kind: 'primary', compact: true, onclick: () => newPlayer() })],
      }),
      h('div.adm-split', { class: p ? 'has-panel' : '' },
        h('div.adm-split-main', bar, h('section.card.adm-section', h('div.adm-card-b.is-flush', list))),
        p ? playerPanel(p, { refresh }) : null)),
  };
}

/** La fiche d'un compte : son état et ce qu'il demande d'abord, ses groupes, puis les actions, la suppression à part. */
function playerPanel(p, { refresh }) {
  const act = (button, fn, success) => run(button, fn, { success }).then((ok) => { if (ok) refresh(); });

  const edit = async () => {
    const done = await openSheet('Modifier le compte', (close) => {
      const name = h('input', { name: 'pseudo', maxlength: 20, value: p.pseudo, required: true, autocomplete: 'off' });
      const picker = avatarPicker(p.avatar, { label: 'Avatar' });
      const err = h('p.form-error', { role: 'alert' });
      return h('form.stack', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await apatch(`/players/${p.id}`, { pseudo: name.value.trim(), avatar: picker.value });
            close(true);
          } catch (error) {
            err.textContent = error.message;
          }
        },
      }, h('p.muted', 'Le pseudo et l’avatar changent dans tous ses groupes.'), field('Pseudo', name), h('div.field', h('span.label', 'Avatar'), picker.el), err,
      h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, 'Enregistrer')));
    });
    if (done) { toast('Compte modifié.', 'ok'); refresh(); }
  };

  const addToGroup = async () => {
    const { groups } = await aget('/groups');
    const mine = p.groups.filter((g) => g.status === 'active').map((g) => g.id);
    const picked = await openSheet('Ajouter à un groupe', (close) => {
      const where = groupPicker(groups, { exclude: mine });
      return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close({ groupId: where.select.value, role: where.role.value }); } },
        h('p.muted', `${p.pseudo} entre dans le groupe avec son compte (s’il en avait été retiré, il retrouve son historique).`), where.el,
        h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, 'Ajouter')));
    });
    if (picked) act(null, () => apost(`/groups/${picked.groupId}/members`, { playerId: p.id, role: picked.role }), 'Ajouté au groupe.');
  };

  const remove = async () => {
    const typed = await openSheet('Supprimer le compte', (close) => {
      const confirm = h('input', { name: 'confirm', autocomplete: 'off', placeholder: p.pseudo });
      return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close(confirm.value); } },
        h('p', `${p.pseudo} quitte ses ${p.groups.filter((g) => g.status === 'active').length} groupe(s) : son pseudo y devient « Ancien membre », ses points et l’historique restent. Le compte disparaît, ses appareils sont déconnectés. Irréversible.`),
        field(`Tape « ${p.pseudo} » pour confirmer`, confirm),
        h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.danger', { type: 'submit' }, 'Supprimer le compte')));
    });
    if (typed == null) return;
    if (await run(null, () => adel(`/players/${p.id}`, { confirm: typed }), { success: 'Compte supprimé.' })) go('/admin/users');
  };

  const confirmThen = async (title, text, label, path, success, danger = false) => {
    if (await confirmSheet(title, text, { confirm: label, danger })) act(null, () => apost(path), success);
  };
  const resetPin = () => confirmThen('Réinitialiser le PIN ?', `${p.pseudo} est déconnecté partout et choisira un nouveau PIN en ouvrant le lien d’un de ses groupes.`,
    'Réinitialiser', `/players/${p.id}/reset-pin`, 'PIN réinitialisé : envoie-lui le lien d’un de ses groupes.');
  const logoutAll = () => confirmThen('Déconnecter partout ?', `${p.pseudo} devra retaper son pseudo et son PIN sur ses ${p.devices} appareil(s).`,
    'Déconnecter', `/players/${p.id}/logout`, 'Déconnecté de tous ses appareils.');

  const setRole = (g, role) => act(null, () => apatch(`/members/${g.memberId}`, { role }), role === 'admin' ? `Admin de « ${g.name} ».` : `N’est plus admin de « ${g.name} ».`);
  const expel = async (g) => {
    if (await confirmSheet(`Retirer de « ${g.name} » ?`, `${p.pseudo} sort du groupe ; ses pronostics sur les paris encore ouverts sont retirés. Il pourra revenir par le lien.`, { confirm: 'Retirer', danger: true })) {
      act(null, () => adel(`/members/${g.memberId}`), 'Retiré du groupe.');
    }
  };

  const picks = p.groups.reduce((sum, g) => sum + g.picks, 0);
  const actRow = (name, label, onclick, { disabled = false, danger = false } = {}) => h('button.adm-act', { type: 'button', onclick, disabled, class: cls(danger && 'is-danger') },
    icon(name, 'sm'), h('span.adm-grow', label), danger ? null : icon('right', 'xs'));
  return h('aside.card.adm-panel', { 'aria-label': `Compte de ${p.pseudo}` },
    h('a.adm-panel-back', { href: '/admin/users' }, icon('left', 'sm'), 'Comptes'),
    h('div.adm-panel-h',
      h('span.avatar.lg', { 'aria-hidden': 'true' }, face(p.avatar)),
      h('div.adm-grow', h('h2', p.pseudo), h('div.adm-row', stateBadge(PLAYER_STATES, p.state), h('small.muted', `créé le ${when(p.createdAt, { day: true })}`))),
      h('a.btn.icon.ghost.small.adm-panel-close', { href: '/admin/users', 'aria-label': 'Fermer la fiche', title: 'Fermer' }, icon('x', 'sm'))),
    p.state === 'locked' ? alertBox('bad', 'lock', `Bloqué jusqu’à ${clock(p.lockedUntil)}`, 'Trop de PIN faux d’affilée. Si c’est bien lui qui se trompe :',
      button('Débloquer', { kind: 'primary', small: true, icon: 'unlock', onclick: (e) => act(e.currentTarget, () => apost(`/players/${p.id}/unlock`), 'Compte débloqué.') })) : null,
    p.state === 'new_pin' ? alertBox('warn', 'key', 'PIN pas encore choisi', 'Il le choisit en ouvrant le lien d’un de ses groupes : envoie-le-lui.') : null,
    h('dl.adm-mini',
      h('div', h('dt', 'Vu'), h('dd', p.lastSeenAt ? ago(p.lastSeenAt) : 'jamais')),
      h('div', h('dt', 'Appareils'), h('dd.num', String(p.devices))),
      h('div', h('dt', 'Pronostics'), h('dd.num', String(picks)))),
    h('div.adm-panel-s', h('h3', 'Groupes'),
      p.groups.length ? h('ul.adm-rows', p.groups.map((g) => h('li', { class: g.status === 'active' ? '' : 'is-gone' },
        tile(g.emoji, 'sm'),
        h('a.adm-grow', { href: `/admin/groups/${g.id}` }, g.name),
        g.status === 'active' ? h('small.muted', `${g.role === 'admin' ? 'Admin' : 'Membre'} · ${plural(g.picks, 'prono')}`) : badge(...STATUS[g.status]),
        g.status === 'active' ? moreMenu([
          { label: 'Ouvrir le groupe', icon: 'users', href: `/admin/groups/${g.id}` },
          g.role === 'admin' ? { label: 'Retirer le rôle d’admin', icon: 'shield', onclick: () => setRole(g, 'member') } : { label: 'Rendre admin du groupe', icon: 'shield', onclick: () => setRole(g, 'admin') },
          '-',
          { label: 'Retirer du groupe…', icon: 'userMinus', danger: true, onclick: () => expel(g) },
        ], { label: `Actions dans ${g.name}` }) : null)))
        : h('p.muted.small', 'Dans aucun groupe : ajoute-le à un groupe, ou supprime le compte.'),
      button('Ajouter à un groupe', { icon: 'plus', kind: 'ghost', small: true, onclick: addToGroup })),
    p.coupons.length ? h('div.adm-panel-s', h('h3', 'Coupons utilisés'),
      h('ul.adm-rows', p.coupons.map((c) => h('li', icon('ticket', 'sm'), h('code.adm-code', `…${c.hint}`), h('span.adm-grow', c.groupName), h('small.muted', when(c.usedAt, { day: true })))))) : null,
    h('div.adm-panel-s', h('h3', 'Compte'),
      actRow('pencil', 'Modifier le pseudo et l’avatar', edit),
      actRow('key', 'Réinitialiser le PIN', resetPin),
      actRow('phone', p.devices > 1 ? `Déconnecter ses ${p.devices} appareils` : p.devices ? 'Déconnecter son appareil' : 'Aucun appareil connecté', logoutAll, { disabled: !p.devices })),
    h('div.adm-panel-s.adm-danger', actRow('trash', 'Supprimer le compte…', remove, { danger: true })));
}

/** Ancienne fiche seule : la liste avec la fiche ouverte. */
export const playerView = ({ id, refresh }) => playersView({ id, refresh });
