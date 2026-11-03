// Coupons de création de groupe : en créer (montrés une seule fois), suivre leur utilisation, annuler ceux qui attendent.
import { appUrl, brand } from '../brand.js';
import { h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { confirmSheet, field, openSheet, run, share } from '../ui.js';
import { aget, apost, button, COUPON_STATES, copy, filters, moreMenu, pageHead, soon, stateBadge, table, when } from './kit.js';

const DAYS = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [null, 'Sans limite']];
export const couponLink = (code) => appUrl(`/groups/new/${code}`);

/** Nouveau coupon : pour qui, combien de temps. Rend le coupon créé (après l'avoir montré), ou null. */
export async function newCoupon() {
  const input = await openSheet('Nouveau coupon', (close) => {
    const note = h('input', { name: 'note', maxlength: 60, placeholder: 'Julien, le foot du jeudi…', autocomplete: 'off' });
    let days = 30;
    const seg = h('div.segmented', { role: 'tablist', 'aria-label': 'Valable' }, DAYS.map(([d, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(d === days),
      onclick: (e) => {
        days = d;
        for (const b of seg.children) b.setAttribute('aria-selected', String(b === e.currentTarget));
      },
    }, label)));
    return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close({ note: note.value.trim(), days }); } },
      h('p.muted', 'Un coupon crée un seul groupe, et le compte de la personne qui le crée. Il expire dès qu’il a servi.'),
      field('Pour qui ? (facultatif)', note),
      h('div.field', h('span.label', 'Valable'), seg),
      h('div.row-end',
        h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'),
        h('button.btn.primary', { type: 'submit' }, 'Créer le coupon')));
  });
  if (!input) return null;
  const created = await run(null, () => apost('/coupons', input));
  if (!created) return null;
  await showCoupon(created, input.note);
  return created;
}

/** Le code en clair, une seule fois : le lien (qui remplit la création du groupe) ou le code, à copier ou partager. */
function showCoupon({ code, expiresAt }, note) {
  const link = couponLink(code);
  return openSheet('Coupon créé', (close) => h('div.stack',
    h('p', `Copie-le maintenant : il ne sera plus affiché (seule sa fin, …${code.slice(-4)}, reste visible).`),
    h('output.adm-coupon', { 'aria-label': 'Code du coupon' }, code),
    h('p.muted', note ? `Note : ${note}. ` : '', expiresAt ? `Valable jusqu’au ${when(expiresAt, { day: true })}.` : 'Sans date limite.'),
    h('div.row-wrap',
      button('Copier le lien', { icon: 'link', kind: 'primary', onclick: () => copy(link, 'Lien copié : il ouvre la création du groupe, coupon rempli.') }),
      button('Copier le code', { icon: 'copy', onclick: () => copy(code, 'Code copié.') }),
      navigator.share ? button('Partager', { icon: 'external', onclick: () => share({ title: brand.name, text: `Ton coupon pour créer ton groupe sur ${brand.name}`, url: link }) }) : null),
    h('small.hint.adm-break', link),
    h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(true) }, 'J’ai copié, fermer'))));
}

/** Qui l'a utilisé, pour quel groupe (liens vers le compte et le groupe s'ils existent encore). */
const usage = (c) => (c.usedAt ? h('span.adm-usage',
  c.usedBy ? h('a', { href: `/admin/users/${c.usedBy}` }, c.usedByPseudo) : `${c.usedByPseudo} (compte supprimé)`,
  ' → ',
  c.groupId ? h('a', { href: `/admin/groups/${c.groupId}` }, c.groupName) : `${c.groupName} (groupe supprimé)`) : null);

/** La ligne du dessous sur téléphone, la colonne « Suivi » sur PC : ce qui est arrivé au coupon. */
function story(c) {
  if (c.state === 'used') return h('span', usage(c), h('small.muted', ` · ${when(c.usedAt, { day: true })}`));
  if (c.state === 'available') return c.expiresAt ? `expire ${soon(c.expiresAt)} (${when(c.expiresAt, { day: true })})` : 'sans date limite';
  if (c.state === 'expired') return `expiré le ${when(c.expiresAt, { day: true })} sans servir`;
  return 'annulé';
}

export async function couponsView({ refresh }) {
  const { coupons } = await aget('/coupons');
  const revoke = async (c) => {
    if (!await confirmSheet('Annuler ce coupon ?', `Le coupon …${c.hint}${c.note ? ` (${c.note})` : ''} ne pourra plus créer de groupe.`, { confirm: 'Annuler le coupon', danger: true })) return;
    if (await run(null, () => apost(`/coupons/${c.id}/revoke`), { success: 'Coupon annulé.' })) refresh();
  };
  const columns = [
    ['Coupon', (c) => h('span.adm-who', h('span.adm-itile.sm', { class: `is-${COUPON_STATES[c.state]?.[1] ?? 'muted'}` }, icon('ticket', 'sm')),
      h('span', h('code.adm-code', `…${c.hint}`), c.note ? h('span.adm-note', ` · ${c.note}`) : null)), { sort: (c) => c.note || c.hint }],
    ['Suivi', story],
    ['Créé', (c) => when(c.createdAt, { day: true }), { sort: (c) => c.createdAt, desc: true, phone: 'hide' }],
    ['État', (c) => h('span.adm-row', stateBadge(COUPON_STATES, c.state),
      c.state === 'available' ? moreMenu([{ label: 'Annuler le coupon…', icon: 'ban', danger: true, onclick: () => revoke(c) }], { label: `Actions pour le coupon …${c.hint}` }) : null),
    { phone: 'side', align: 'right' }],
  ];
  const list = h('div');
  const show = ({ choice, text }) => fill(list, table(columns, coupons.filter((c) => (choice === 'all' || c.state === choice || (choice === 'off' && ['revoked', 'expired'].includes(c.state)))
    && (!text || `${c.hint} ${c.note} ${c.usedByPseudo ?? ''} ${c.groupName ?? ''}`.toLowerCase().includes(text))), { emptyText: 'Aucun coupon ici.', label: 'Coupons' }));
  const counts = Object.fromEntries(Object.keys(COUPON_STATES).map((s) => [s, coupons.filter((c) => c.state === s).length]));
  const bar = filters({
    choices: [['available', 'Disponibles', counts.available], ['used', 'Utilisés', counts.used], ['off', 'Annulés ou expirés', counts.revoked + counts.expired], ['all', 'Tous', coupons.length]],
    initial: counts.available ? 'available' : 'all',
    placeholder: 'Chercher (note, fin du code, pseudo, groupe)',
    onChange: show,
  });
  show({ choice: bar.choice(), text: '' });
  return {
    title: 'Coupons',
    node: h('div.adm-page',
      pageHead({
        title: 'Coupons', sub: 'Créer un groupe demande un coupon : un par groupe, il expire en servant. Son code n’est montré qu’une fois, à sa création.',
        actions: [button('Nouveau coupon', { icon: 'plus', kind: 'primary', compact: true, onclick: async () => { if (await newCoupon()) refresh(); } })],
      }),
      bar,
      h('section.card.adm-section', h('div.adm-card-b.is-flush', list))),
  };
}
