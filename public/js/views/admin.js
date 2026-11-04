import { face } from '../avatars.js';
import { api, get, patch, post } from '../api.js';
import { brand } from '../brand.js';
import { h } from '../dom.js';
import { activeMembers, ctx, groupUrl, invalidate, navigate, rerender } from '../state.js';
import { pointsEditor } from '../settings-editor.js';
import { forgetGroup, rememberGroup } from '../store.js';
import { confirmSheet, emojiPicker, field, GROUP_EMOJIS, promptSheet, run, share, toast } from '../ui.js';

export async function adminView() {
  if (ctx.me.role !== 'admin') {
    navigate(`/${ctx.gid}/me`, { replace: true });
    return null;
  }
  const base = `/groups/${ctx.gid}`;
  const s = ctx.settings;
  const reload = async () => { invalidate(); rerender(); };

  // Le lien du groupe : son adresse, pour entrer et se connecter. Le changer en donne une nouvelle (fuite du lien).
  const inviteSection = h('section.card.stack',
    h('h2', '🔗 Lien du groupe'),
    h('p.invite-link', h('code', groupUrl())),
    h('p.muted', 'C’est l’adresse du groupe : elle sert à y entrer et à s’y connecter.'),
    h('div.row-wrap',
      h('button.btn.primary', { type: 'button', onclick: () => share({ title: ctx.group.name, text: `🎲 Rejoins « ${ctx.group.name} » sur ${brand.name}`, url: groupUrl() }) }, 'Partager'),
      h('button.btn.danger', {
        type: 'button',
        onclick: async (e) => {
          const ok = await confirmSheet('Changer le lien ?', 'Le groupe prend une nouvelle adresse : l’ancienne ne permettra plus ni d’entrer ni de se connecter. Les membres déjà connectés gardent l’accès. Tu devras partager le nouveau lien.', { confirm: 'Changer le lien', danger: true });
          if (!ok) return;
          const r = await run(e.currentTarget, () => post(`${base}/address`), { success: 'Nouveau lien créé.' });
          if (r) {
            forgetGroup(ctx.gid);
            rememberGroup({ ...ctx.group, id: r.id, role: ctx.me.role });
            navigate(`/${r.id}/admin`, { replace: true });
          }
        },
      }, 'Changer le lien')));

  // Nom et emoji du groupe
  const name = h('input', { type: 'text', maxlength: 40, value: ctx.group.name });
  const emoji = emojiPicker(GROUP_EMOJIS.includes(ctx.group.emoji) ? GROUP_EMOJIS : [ctx.group.emoji, ...GROUP_EMOJIS], ctx.group.emoji, { label: 'Emoji du groupe' });
  const groupSection = h('section.card.stack', h('h2', '✏️ Le groupe'), field('Nom', name), emoji.el,
    h('button.btn', {
      type: 'button',
      onclick: async (e) => { if (await run(e.currentTarget, () => patch(base, { name: name.value, emoji: emoji.value }), { success: 'Groupe mis à jour.' })) await reload(); },
    }, 'Enregistrer'));

  // Points et délais
  const points = pointsEditor(s);
  const pointsSection = h('section.card.stack', h('h2', '🎯 Points, délais et commentaires'), points.node,
    h('button.btn', {
      type: 'button',
      onclick: async (e) => {
        if (await run(e.currentTarget, () => patch(`${base}/settings`, points.value()), { success: 'Réglages enregistrés.' })) await reload();
      },
    }, 'Enregistrer les réglages'));

  // Types, catégories et sources de données : page à part (/<g>/config)
  const activeCats = s.categories.filter((c) => !c.hidden).length;
  const kindsOn = [s.kinds.yesno && 'Oui / Non', s.kinds.multi && 'choix multiples'].filter(Boolean).join(' et ') || 'aucun type de pari maison';
  const catSection = h('a.card.list-item.config-link', { href: `/${ctx.gid}/config` },
    h('span.big-emoji', '🎛️'),
    h('span.grow', h('b', 'Réglages des paris'), h('br'),
      h('small.muted', `${kindsOn} · ${activeCats ? `paris maison dans ${activeCats} catégorie${activeCats > 1 ? 's' : ''}` : 'pas de paris maison'} · matchs, météo, cryptos… avec résultat automatique`)),
    h('span.chev', '›'));

  // Membres
  const memberSection = h('section.card.stack', h('h2', `👥 Membres (${activeMembers().length})`),
    h('ul.list', activeMembers().map((m) => h('li.member-row', { dataset: { memberId: m.id } },
      h('span.avatar', face(m.avatar)),
      h('span.grow', h('b', m.pseudo), m.role === 'admin' ? h('small.tag', 'admin') : null),
      m.id === ctx.me.id ? h('small.muted', 'toi') : h('div.row-wrap.small-actions',
        h('button.btn.small', {
          type: 'button',
          onclick: async (e) => {
            const role = m.role === 'admin' ? 'member' : 'admin';
            if (await run(e.currentTarget, () => post(`${base}/members/${m.id}/role`, { role }), { success: role === 'admin' ? `${m.pseudo} est admin.` : `${m.pseudo} n’est plus admin.` })) await reload();
          },
        }, m.role === 'admin' ? 'Retirer admin' : 'Nommer admin'),
        h('button.btn.small', {
          type: 'button',
          onclick: async (e) => {
            const message = `${m.pseudo} sera déconnecté partout et choisira un nouveau PIN en rouvrant le lien du groupe. S’il est aussi dans d’autres groupes, un admin de chacun doit faire de même (sinon un seul admin pourrait prendre son compte).`;
            if (await confirmSheet(`Réinitialiser le PIN de ${m.pseudo} ?`, message, { confirm: 'Réinitialiser' })) {
              const result = await run(e.currentTarget, () => post(`${base}/members/${m.id}/reset-pin`));
              if (result?.done) toast(`PIN de ${m.pseudo} réinitialisé : envoie-lui le lien du groupe pour qu’il en choisisse un nouveau.`, 'ok');
              else if (result) toast(`C’est noté. ${m.pseudo} est aussi dans ${result.waiting} autre${result.waiting > 1 ? 's' : ''} groupe${result.waiting > 1 ? 's' : ''} : un admin de chacun doit aussi réinitialiser son PIN (d’ici 7 jours).`, 'ok');
            }
          },
        }, 'Réinit. PIN'),
        h('button.btn.small.danger', {
          type: 'button',
          onclick: async (e) => {
            if (await confirmSheet(`Bannir ${m.pseudo} ?`, `Il apparaîtra comme « ${m.pseudo} (banni) » et ses pronostics sur les paris ouverts sont retirés. Il ne pourra pas revenir de lui-même, même avec le lien du groupe : seul un admin pourra le réintégrer, et il retrouvera alors sa place, ses points et son historique.`, { confirm: 'Bannir', danger: true })) {
              if (await run(e.currentTarget, () => post(`${base}/members/${m.id}/remove`), { success: `${m.pseudo} est banni du groupe.` })) await reload();
            }
          },
        }, 'Bannir'))))));

  // Bannis : seul un admin les fait revenir (ceux qui sont partis d'eux-mêmes reviennent par le lien).
  const banned = [...ctx.members.values()].filter((m) => m.status === 'removed');
  const bannedSection = banned.length ? h('section.card.stack', h('h2', `🚫 Bannis (${banned.length})`),
    h('p.muted', 'Ils ne peuvent pas revenir d’eux-mêmes. Réintégré, un membre retrouve sa place, ses points et son historique.'),
    h('ul.list', banned.map((m) => h('li.member-row', { dataset: { memberId: m.id } },
      h('span.avatar', face(m.avatar)),
      h('span.grow', h('b', m.pseudo)),
      h('button.btn.small', {
        type: 'button',
        onclick: async (e) => {
          if (await run(e.currentTarget, () => post(`${base}/members/${m.id}/reinstate`), { success: 'Membre réintégré.' })) await reload();
        },
      }, 'Réintégrer'))))) : null;

  // Export
  const exportSection = h('section.card.stack', h('h2', '💾 Export'),
    h('p.muted', 'Tout le groupe en JSON (paris, pronostics, points, historique), sans PIN ni lien secret.'),
    h('button.btn', {
      type: 'button',
      onclick: async (e) => {
        const data = await run(e.currentTarget, () => get(`${base}/export`));
        if (!data) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = h('a', { href: url, download: `pari-tenu-${ctx.group.name}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Export téléchargé.', 'ok');
      },
    }, 'Télécharger l’export'));

  // Supprimer le groupe : un admin, en retapant son nom ; tout disparaît pour tout le monde (les comptes restent).
  const deleteSection = h('section.card.stack.danger-zone', h('h2', '🗑️ Supprimer le groupe'),
    h('p.muted', 'Les paris, pronostics, points, classements et l’historique du groupe disparaissent pour tous ses membres. Leurs comptes et leurs autres groupes restent. On ne peut pas revenir en arrière : pense à l’export avant.'),
    h('button.btn.danger', {
      type: 'button',
      onclick: async (e) => {
        const name = await promptSheet(`Supprimer « ${ctx.group.name} » ?`, {
          label: 'Retape le nom du groupe pour confirmer', placeholder: ctx.group.name, confirm: 'Supprimer définitivement', max: 80, danger: true,
        });
        if (name == null) return;
        if (await run(e.currentTarget, () => api('DELETE', base, { confirm: name }))) {
          forgetGroup(ctx.gid);
          toast(`Groupe « ${ctx.group.name} » supprimé.`, 'ok');
          navigate('/groups', { replace: true });
        }
      },
    }, 'Supprimer le groupe'));

  const node = h('main.admin',
    h('header.topbar', h('a.icon-btn', { href: `/${ctx.gid}`, 'aria-label': 'Retour' }, '←'), h('h1', '⚙️ Réglages du groupe')),
    inviteSection, catSection, groupSection, pointsSection, memberSection, bannedSection, exportSection, deleteSection);
  return { node, tab: 'settings' };
}
