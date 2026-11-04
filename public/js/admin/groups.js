// Groupes : la liste ; un groupe (onglets Membres, Classements, Réglages ; à côté : lien du groupe, origine, suppression) ;
// la modification de tous ses réglages ; la création pour un compte.
import { faceText } from '../avatars.js';
import { appUrl } from '../brand.js';
import { h, fill } from '../dom.js';
import { odds, percent, pts } from '../format.js';
import { icon } from '../icons.js';
import { betSettingsEditor, pointsEditor } from '../settings-editor.js';
import { confirmSheet, emojiPicker, field, GROUP_EMOJIS, openSheet, run, toast } from '../ui.js';
import {
  adel, aget, ago, apatch, apost, avatar, badge, button, card, copy, facts, filters, go, moreMenu, pageHead, plural, table, tile, when,
} from './kit.js';

const groupLink = (address) => appUrl(`/${address}`);
const SEASON = { current: ['En cours', 'ok'], ending: ['Derniers résultats', 'warn'], closed: ['Close', 'muted'], upcoming: ['À venir', 'info'] };
const STATUS = { left: ['Parti', 'muted'], removed: ['Banni', 'warn'] };

/**
 * Les classements du groupe (un par compétition ou catégorie) : une puce par classement, la saison choisie (en cours par
 * défaut) et son classement complet. players : memberId → compte, pour ouvrir la fiche d'un joueur.
 */
async function rankingsCard(g, players) {
  const { rankings } = await aget(`/groups/${g.id}/rankings`);
  if (!rankings.length) return card('Classements', h('p.muted', 'Pas encore de classement : aucun pari dans ce groupe.'));
  const body = h('div.adm-stack');
  const show = async (key, seasonId = null) => {
    const data = await aget(`/groups/${g.id}/rankings/${encodeURIComponent(key)}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ''}`);
    const s = data.season;
    const season = h('select.adm-season', { 'aria-label': 'Saison', onchange: (e) => show(key, e.target.value) },
      data.seasons.map((x) => h('option', { value: x.id, selected: x.id === s.id }, `Saison ${x.label}${x.closedAt ? ' · close' : ''}`)));
    const champions = new Set(s.champions);
    fill(body,
      h('div.adm-row.adm-wrap', season, badge(...(SEASON[s.state] ?? [s.state])), h('small.muted', `${plural(s.bets, 'pari')}${s.pending ? ` · ${s.pending} en attente de résultat` : ''}`)),
      table([
        ['Rang', (r) => h('b.num', champions.has(r.memberId) ? '🏆 1' : String(r.rank)), { phone: 'hide' }],
        ['Membre', (r) => (players.get(r.memberId) ? h('a.adm-who', { href: `/admin/users/${players.get(r.memberId)}` }, avatar(r.member.avatar), h('b', h('span.adm-rank-m', `${r.rank}. `), r.member.pseudo))
          : h('span.adm-who', avatar(r.member.avatar), h('span.adm-rank-m', `${r.rank}. `), r.member.pseudo)), { phone: 'main' }],
        ['Points', (r) => h('b.num', pts(r.score)), { align: 'right', phone: 'side' }],
        ['Paris réglés', (r) => String(r.played), { align: 'right', unit: (r) => (r.played > 1 ? 'réglés' : 'réglé') }],
        ['Bien vus', (r) => (r.played ? `${r.correct} (${percent(r.rate)})` : '—'), { align: 'right', unit: 'bien vus' }],
      ], s.standings, { emptyText: 'Personne n’a encore joué dans cette saison.', label: 'Classement' }));
  };
  const chips = h('div.chips.wrap', { role: 'tablist', 'aria-label': 'Classements du groupe' }, rankings.map((r, i) => h('button.chip', {
    type: 'button', role: 'tab', 'aria-selected': String(i === 0),
    onclick: (e) => {
      for (const b of chips.children) b.setAttribute('aria-selected', String(b === e.currentTarget));
      show(r.key);
    },
  }, `${r.emoji} ${r.label}${r.leader ? ` · ${r.leader.member.pseudo} en tête` : ''}`)));
  await show(rankings[0].key);
  return card('Classements', chips, body);
}

/** Les réglages du groupe en un coup d'œil ; « Modifier » ouvre la page qui les change tous. */
function settingsCard(g) {
  const s = g.settings;
  const kinds = [s.kinds.yesno && 'Oui / Non', s.kinds.multi && 'choix multiples'].filter(Boolean);
  const cats = s.categories.filter((c) => !c.hidden);
  return card('Réglages', { extra: button('Modifier les réglages', { icon: 'pencil', small: true, href: `/admin/groups/${g.id}/edit` }) },
    facts([
      ['Points', `${s.basePoints} × la cote${s.oddsCap ? ` (cote plafonnée à ${odds(s.oddsCap)})` : ''}`],
      ['Prime d’arbitre', `${s.arbiterBonus} pts`],
      ['Délais des paris maison', `contester ${s.validationHours} h · voter ${s.voteHours} h`],
      ['Paris maison', kinds.length && cats.length ? `${kinds.join(' et ')} · ${cats.map((c) => c.emoji).join(' ')} (${plural(cats.length, 'catégorie')})` : 'aucun'],
      ['Compétitions', g.competitions.length ? g.competitions.map((c) => `${c.emoji} ${c.label}`).join(' · ') : 'aucune'],
    ]));
}

/** Nom et emoji d'un nouveau groupe ; players : choisir le compte qui en sera l'admin. */
function groupSheet(title, { name = '', emoji = '🏆', players = null, submit }) {
  return openSheet(title, (close) => {
    const input = h('input', { name: 'group-name', maxlength: 40, value: name, required: true, autocomplete: 'off', placeholder: 'Les Potes' });
    const picker = emojiPicker(GROUP_EMOJIS, emoji, { label: 'Emoji du groupe' });
    const owner = players ? h('select', { name: 'owner', required: true },
      h('option', { value: '' }, 'Choisis un compte…'),
      [...players].sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr')).map((p) => h('option', { value: p.id }, `${faceText(p.avatar)} ${p.pseudo}`))) : null;
    return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close({ name: input.value.trim(), emoji: picker.value, playerId: owner?.value }); } },
      field('Nom du groupe', input),
      h('div.field', h('span.label', 'Emoji du groupe'), picker.el),
      owner ? field('Admin du groupe', owner, 'Un compte existant (pour quelqu’un de nouveau : envoie-lui plutôt un coupon).') : null,
      h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, submit)));
  });
}

export async function newGroup() {
  const { players } = await aget('/players');
  if (!players.length) { toast('Aucun compte pour l’instant : envoie plutôt un coupon.', 'error'); return; }
  const input = await groupSheet('Nouveau groupe', { players, submit: 'Créer le groupe' });
  if (!input) return;
  const created = await run(null, () => apost('/groups', input), { success: 'Groupe créé.' });
  if (created) go(`/admin/groups/${created.id}`);
}

export async function groupsView() {
  const { groups } = await aget('/groups');
  const columns = [
    ['Groupe', (g) => h('a.adm-who', { href: `/admin/groups/${g.id}` }, tile(g.emoji), h('b', g.name)), { sort: (g) => g.name }],
    ['Membres', (g) => (g.members ? String(g.members) : badge('Vide', 'warn')), { align: 'right', sort: (g) => g.members, desc: true, unit: (g) => (g.members > 1 ? 'membres' : g.members ? 'membre' : '') }],
    ['Paris ouverts', (g) => String(g.openBets), { align: 'right', sort: (g) => g.openBets, desc: true, unit: (g) => (g.openBets > 1 ? 'paris ouverts' : 'pari ouvert') }],
    ['Paris en tout', (g) => String(g.bets), { align: 'right', sort: (g) => g.bets, desc: true, phone: 'hide' }],
    ['Activité', (g) => (g.lastActivityAt ? ago(g.lastActivityAt) : h('span.muted', 'jamais')), { sort: (g) => g.lastActivityAt, desc: true }],
    ['Créé', (g) => when(g.createdAt, { day: true }), { sort: (g) => g.createdAt, desc: true, phone: 'hide' }],
  ];
  const list = h('div');
  const show = ({ choice, text }) => fill(list, table(columns, groups.filter((g) => (choice === 'all' || (choice === 'empty' ? !g.members : g.members > 0))
    && (!text || g.name.toLowerCase().includes(text))), { emptyText: 'Aucun groupe ici.', href: (g) => `/admin/groups/${g.id}`, label: 'Groupes' }));
  show({ choice: 'all', text: '' });
  return {
    title: 'Groupes',
    node: h('div.adm-page',
      pageHead({
        title: 'Groupes', sub: 'Chaque groupe a son lien (son adresse) : c’est lui qui fait entrer de nouveaux comptes et s’y connecter.',
        actions: [button('Nouveau groupe', { icon: 'plus', kind: 'primary', compact: true, onclick: () => newGroup() })],
      }),
      filters({
        choices: [['all', 'Tous', groups.length], ['live', 'Avec des membres', groups.filter((g) => g.members).length], ['empty', 'Vides', groups.filter((g) => !g.members).length]],
        placeholder: 'Chercher un groupe',
        onChange: show,
      }),
      h('section.card.adm-section', h('div.adm-card-b.is-flush', list))),
  };
}

const TABS = [['members', 'Membres'], ['rankings', 'Classements'], ['settings', 'Réglages']];

export async function groupView({ id, refresh, tab = 'members' }) {
  const { group: g } = await aget(`/groups/${id}`);
  const act = (button, fn, success) => run(button, fn, { success }).then((ok) => { if (ok) refresh(); });
  const active = g.members.filter((m) => m.status === 'active');
  const link = groupLink(g.address);

  const newLink = async () => {
    if (await confirmSheet('Nouveau lien du groupe ?', 'Le groupe prend une nouvelle adresse : l’ancienne ne permettra plus ni d’entrer ni de se connecter. Les membres restent dans le groupe et ceux déjà connectés gardent l’accès.', { confirm: 'Changer le lien' })) {
      act(null, () => apost(`/groups/${g.id}/address`), 'Nouveau lien prêt : copie-le.');
    }
  };

  const addPlayer = async () => {
    const { players } = await aget('/players');
    const inside = new Set(active.map((m) => m.playerId));
    const candidates = players.filter((p) => !inside.has(p.id)).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
    if (!candidates.length) { toast('Tous les comptes sont déjà dans ce groupe.', 'info'); return; }
    const picked = await openSheet('Ajouter un compte', (close) => {
      const who = h('select', { name: 'player', required: true }, h('option', { value: '' }, 'Choisis un compte…'),
        candidates.map((p) => h('option', { value: p.id }, `${faceText(p.avatar)} ${p.pseudo}`)));
      const role = h('select', { name: 'role' }, h('option', { value: 'member' }, 'Membre'), h('option', { value: 'admin' }, 'Admin du groupe'));
      return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close({ playerId: who.value, role: role.value }); } },
        h('p.muted', 'Un compte existant. Pour quelqu’un de nouveau : envoie-lui le lien du groupe (ou crée son compte dans « Comptes »).'),
        h('div.pin-row', field('Compte', who), field('Rôle', role)),
        h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, 'Ajouter')));
    });
    if (picked) act(null, () => apost(`/groups/${g.id}/members`, picked), 'Ajouté au groupe.');
  };

  const remove = async () => {
    const typed = await openSheet('Supprimer le groupe', (close) => {
      const confirm = h('input', { name: 'confirm', autocomplete: 'off', placeholder: g.name });
      return h('form.stack', { onsubmit: (e) => { e.preventDefault(); close(confirm.value); } },
        h('p', `« ${g.name} » disparaît avec ses ${g.bets} paris, ses classements et son historique. Ses ${active.length} membre(s) gardent leur compte et leurs autres groupes. Irréversible.`),
        field(`Tape « ${g.name} » pour confirmer`, confirm),
        h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.danger', { type: 'submit' }, 'Supprimer le groupe')));
    });
    if (typed == null) return;
    if (await run(null, () => adel(`/groups/${g.id}`, { confirm: typed }), { success: 'Groupe supprimé.' })) go('/admin/groups');
  };

  const setRole = (m, role) => act(null, () => apatch(`/members/${m.id}`, { role }), role === 'admin' ? `${m.pseudo} est admin du groupe.` : `${m.pseudo} n’est plus admin.`);
  const expel = async (m) => {
    // Jamais le dernier membre (supprimer le groupe), ni le seul admin (en nommer un autre d'abord) : personne n'est promu
    // d'office (le serveur refuse aussi).
    if (active.length === 1) { toast('C’est le dernier membre du groupe : supprime plutôt le groupe.', 'error'); return; }
    if (m.role === 'admin' && active.filter((x) => x.role === 'admin').length === 1) {
      toast('C’est le seul admin du groupe : rends d’abord un autre membre admin du groupe.', 'error');
      return;
    }
    if (await confirmSheet(`Bannir ${m.pseudo} ?`, `Il apparaîtra comme « ${m.pseudo} (banni) » ; ses pronostics sur les paris encore ouverts sont retirés. Il ne pourra pas revenir de lui-même par le lien : seul un admin pourra le réintégrer.`, { confirm: 'Bannir', danger: true })) {
      act(null, () => adel(`/members/${m.id}`), `${m.pseudo} est banni du groupe.`);
    }
  };
  const reinstate = (m) => act(null, () => apost(`/members/${m.id}/reinstate`), 'Membre réintégré : il retrouve sa place.');

  const members = () => card(null, { flush: true }, table([
    ['Membre', (m) => (m.playerId ? h('a.adm-who', { href: `/admin/users/${m.playerId}` }, avatar(m.avatar), h('b', m.pseudo)) : h('span.adm-who', avatar(m.avatar), m.pseudo)), { sort: (m) => m.pseudo }],
    ['Rôle', (m) => (m.status !== 'active' ? badge(...STATUS[m.status]) : m.role === 'admin' ? badge('Admin du groupe', 'info') : h('span.muted', 'Membre'))],
    ['Pronostics', (m) => String(m.picks), { align: 'right', sort: (m) => m.picks, desc: true, unit: (m) => (m.picks > 1 ? 'pronos' : 'prono') }],
    ['Membre depuis', (m) => when(m.joinedAt, { day: true }), { sort: (m) => m.joinedAt, phone: 'hide' }],
    ['', (m) => (m.status === 'active' ? moreMenu([
      m.playerId ? { label: `Voir le compte de ${m.pseudo}`, icon: 'user', href: `/admin/users/${m.playerId}` } : null,
      m.role === 'admin' ? { label: 'Retirer le rôle d’admin', icon: 'shield', onclick: () => setRole(m, 'member') } : { label: 'Rendre admin du groupe', icon: 'shield', onclick: () => setRole(m, 'admin') },
      '-',
      { label: 'Bannir du groupe…', icon: 'userMinus', danger: true, onclick: () => expel(m) },
    ], { label: `Actions pour ${m.pseudo}` })
      : m.status === 'removed' && m.playerId ? button('Réintégrer', { icon: 'userPlus', kind: 'ghost', small: true, onclick: () => reinstate(m) }) : null)],
  ], g.members, { emptyText: 'Personne dans ce groupe.', rowClass: (m) => (m.status === 'active' ? '' : 'is-gone'), label: 'Membres' }));

  const playerOf = new Map(g.members.filter((m) => m.playerId).map((m) => [m.id, m.playerId]));
  const main = tab === 'rankings' ? await rankingsCard(g, playerOf) : tab === 'settings' ? settingsCard(g) : members();
  const lastActivity = g.lastActivityAt ? `actif ${ago(g.lastActivityAt)}` : 'jamais actif';
  return {
    title: g.name,
    node: h('div.adm-page',
      pageHead({
        crumbs: [['Groupes', '/admin/groups']],
        lead: tile(g.emoji, 'xl'),
        title: g.name,
        sub: `${plural(active.length, 'membre')} · ${g.openBets} paris ouverts, ${g.bets} en tout · ${lastActivity}`,
        actions: [
          button('Modifier les réglages', { icon: 'pencil', compact: true, href: `/admin/groups/${g.id}/edit` }),
          button('Copier le lien du groupe', { icon: 'link', kind: 'primary', compact: true, onclick: () => copy(link, 'Lien du groupe copié.') }),
          moreMenu([
            { label: 'Ajouter un compte', icon: 'userPlus', onclick: addPlayer },
            { label: 'Nouveau lien du groupe', icon: 'refresh', onclick: newLink },
            '-',
            { label: 'Supprimer le groupe…', icon: 'trash', danger: true, onclick: remove },
          ], { label: 'Plus d’actions sur le groupe', small: false }),
        ],
      }),
      h('nav.adm-tabs', { 'aria-label': 'Sections du groupe' }, TABS.map(([key, label]) => h('a', {
        href: key === 'members' ? `/admin/groups/${g.id}` : `/admin/groups/${g.id}/${key}`, 'aria-current': key === tab ? 'page' : null,
      }, label, key === 'members' ? h('span.n', String(active.length)) : null))),
      h('div.adm-aside-grid',
        h('div.adm-col', main),
        h('div.adm-col',
          card('Lien du groupe', h('div.adm-linkbox', h('code', link), h('button.btn.icon.small', { type: 'button', 'aria-label': 'Copier le lien', title: 'Copier', onclick: () => copy(link, 'Lien du groupe copié.') }, icon('copy', 'sm'))),
            h('p.small.muted', 'Ceux qui ont ce lien entrent dans le groupe avec un pseudo et un PIN, ou s’y connectent.'),
            button('Changer le lien', { icon: 'refresh', kind: 'ghost', small: true, onclick: newLink })),
          card('Infos', facts([
            ['Créé', when(g.createdAt)],
            ['Coupon', g.coupon ? `…${g.coupon.hint}${g.coupon.note ? ` (${g.coupon.note})` : ''}` : 'aucun (créé avant les coupons ou par l’admin)'],
            ['Paris', `${g.openBets} ouverts · ${g.bets} en tout`],
            ['Dernière activité', g.lastActivityAt ? `${ago(g.lastActivityAt)} (${when(g.lastActivityAt)})` : '—'],
          ])),
          card('Zone sensible', { tone: 'danger' },
            h('p.small.muted', `Supprime le groupe, ses ${plural(g.bets, 'pari')} et ses classements. Les membres gardent leur compte.`),
            button('Supprimer le groupe…', { icon: 'trash', kind: 'danger', small: true, onclick: remove }))))),
  };
}

/** Modifier le groupe : nom, emoji et tous ses réglages (ceux de son admin), enregistrés d'un coup. */
export async function groupEditView({ id }) {
  const [{ group: g }, { settings, sources, off }] = await Promise.all([aget(`/groups/${id}`), aget(`/groups/${id}/settings`)]);
  const back = `/admin/groups/${g.id}`;
  const name = h('input', { name: 'group-name', maxlength: 40, value: g.name, required: true, autocomplete: 'off' });
  const picker = emojiPicker(GROUP_EMOJIS.includes(g.emoji) ? GROUP_EMOJIS : [g.emoji, ...GROUP_EMOJIS], g.emoji, { label: 'Emoji du groupe' });
  const points = pointsEditor(settings);
  const bets = betSettingsEditor({ settings, sources, searchPlaces: async (q) => (await aget(`/places?q=${encodeURIComponent(q)}`)).places });

  const save = async (e) => {
    const body = { name: name.value.trim(), emoji: picker.value, settings: { ...points.value(), ...bets.value() } };
    const result = await run(e.currentTarget, () => apatch(`/groups/${g.id}`, body));
    if (!result) return;
    const n = result.removed;
    toast(n ? `Groupe enregistré. ${n} pari${n > 1 ? 's' : ''} sans pronostic retiré${n > 1 ? 's' : ''} (compétitions coupées).` : 'Groupe enregistré.', 'ok');
    go(back);
  };

  return {
    title: `Modifier ${g.name}`,
    node: h('div.adm-page.adm-edit',
      pageHead({
        crumbs: [['Groupes', '/admin/groups'], [g.name, back]],
        lead: tile(g.emoji, 'xl'),
        title: 'Modifier le groupe',
        sub: 'Les réglages de son admin, tous sur une page, enregistrés d’un coup. Une compétition activée est proposée aux membres : chacun choisit d’y participer.',
      }),
      h('div.adm-form-col',
        card('Le groupe', field('Nom du groupe', name), h('div.field', h('span.label', 'Emoji du groupe'), picker.el)),
        card('Points et délais', points.node),
        card('Types des paris maison', ...bets.kinds),
        card('Catégories et paris automatiques', ...bets.categories,
          off.length ? h('small.hint', `Coupées pour tout le site (page Sources), donc absentes ici : ${off.map((x) => `${x.emoji} ${x.name}`).join(', ')}. Ce que le groupe avait choisi pour elles est gardé.`) : null),
        h('div.adm-savebar', h('span.adm-grow.muted', 'Rien n’est enregistré avant « Enregistrer ».'),
          h('a.btn.ghost', { href: back }, 'Annuler'), h('button.btn.primary', { type: 'button', onclick: save }, 'Enregistrer')))),
  };
}
