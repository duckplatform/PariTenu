import { face } from '../avatars.js';
import { get, post } from '../api.js';
import { brand } from '../brand.js';
import { cls, fill, h } from '../dom.js';
import { now, plural, pts, relative, syncClock } from '../format.js';
import { icon } from '../icons.js';
import { activeMembers, ctx, inviteUrl, rerender } from '../state.js';
import { pref, setPref, visitBaseline } from '../store.js';
import { eventLine } from '../texts.js';
import { empty, meLink, run, share } from '../ui.js';
import { betCard, shortLabel } from './cards.js';
import { feedChoice } from './follow.js';
import { crest, isLive, pickBadge } from './match.js';

export function inviteCard() {
  return h('section.card.invite-card',
    h('h2', '📨 Invite tes amis'),
    h('p', 'Partage le lien du groupe dans WhatsApp : ils entrent avec un pseudo et un PIN (déjà inscrits : d’un geste), sans e-mail.'),
    h('button.btn.primary.wide', {
      type: 'button',
      onclick: () => share({ title: ctx.group.name, text: `🎲 Rejoins « ${ctx.group.name} » sur ${brand.name}\nDes paris gratuits entre nous :`, url: inviteUrl() }),
    }, 'Partager le lien d’invitation'));
}

/** Les compétitions que le groupe propose et auxquelles je n'ai pas encore répondu : un bandeau compact. */
function proposals(feeds, redraw) {
  const pending = feeds.filter((f) => f.choice == null);
  if (!pending.length) return null;
  return h('section.card.proposals',
    h('h2', icon('compass'), ` ${plural(pending.length, 'compétition', 'compétitions')} à découvrir`),
    h('p.muted', 'Choisis celles qui t’intéressent : leurs paris s’afficheront ici, les autres ne t’encombreront pas.'),
    pending.map((f) => feedChoice(f, redraw)),
    h('a.btn.ghost.small', { href: `/${ctx.gid}/follow` }, 'Gérer mes compétitions ›'));
}

// Les 4 sections de la liste (demande du 2026-11-03 : voir d'un coup d'œil s'il y a quelque chose à faire) : titre,
// icône, ce qu'on y trouve. Une section vide ne s'affiche pas.
const SECTIONS = [
  ['À parier', 'target', 'Tu n’as pas encore parié : la clôture la plus proche d’abord.'],
  ['Pariés', 'check', 'Ton choix est fait : tu peux encore changer d’avis jusqu’à la clôture.'],
  ['Clos', 'lock', 'Plus rien ne change : en direct, résultat attendu, validation ou vote.'],
  ['Terminés', 'flag', 'Les résultats des 30 derniers jours.'],
];
/** Dans « Clos » : d'abord ce qui m'attend (trancher, voter), puis les matchs en direct, puis les plus anciens. */
const closedOrder = (b) => (b.can.resolve || b.can.vote ? 0 : isLive(b) ? 1 : 2);

/**
 * PC large : à droite de la liste, ce qui se passe dans le groupe sans changer de page : les matchs en direct, le
 * classement (celui du filtre choisi) et les dernières nouvelles.
 */
async function sideRail(bets, filter) {
  const [{ rankings }, feed] = await Promise.all([get(`/groups/${ctx.gid}/rankings`), get(`/groups/${ctx.gid}/feed`)]);
  const ranking = rankings.find((r) => r.key === filter) ?? rankings.find((r) => r.key === pref(`ranking:${ctx.gid}`, null)) ?? rankings[0];
  const board = ranking ? await get(`/groups/${ctx.gid}/rankings/${encodeURIComponent(ranking.key)}`) : null;
  const live = bets.filter(isLive);
  const card = (title, link, ...body) => h('section.rail-card',
    h('div.rail-head', h('h2', title), link ? h('a.rail-more', { href: link }, 'Tout voir') : null), body);
  return h('aside.home-rail', { 'aria-label': 'En ce moment dans le groupe' },
    live.length ? card([h('span.live-dot', { 'aria-hidden': 'true' }), ' En direct'], `/${ctx.gid}/live`, live.slice(0, 3).map((b) => {
      const [a, z] = b.event.competitors;
      const score = b.event.live?.scores;
      const mine = b.options.find((o) => o.id === b.myPick);
      return h('a.rail-live', { href: `/${ctx.gid}/bet/${b.id}` },
        h('span.rail-match', crest(a, { size: 'sm' }), h('span', a.name),
          h('b.num', score && score[a.key] != null ? `${score[a.key]} – ${score[z.key]}` : '–'), h('span', z.name), crest(z, { size: 'sm' })),
        h('small.muted', b.event.live?.clock ?? 'En cours', mine ? [` · Ton prono : ${shortLabel(b, mine)} `, pickBadge(b)] : ''));
    })) : null,
    board ? card(`Classement · ${board.label}`, `/${ctx.gid}/rank/${encodeURIComponent(board.key)}`,
      board.season.standings.length ? h('ol.rail-rank', board.season.standings.slice(0, 5).map((r) => h('li', { class: cls(r.member.id === ctx.me.id && 'me') },
        h('span.num.rail-pos', String(r.rank)), h('span.avatar.xs', { 'aria-hidden': 'true' }, face(r.member.avatar)),
        h('span.grow', r.member.pseudo, r.member.id === ctx.me.id ? h('small.muted', ' toi') : null), h('b.num', pts(r.score)))))
        : h('p.muted', 'Personne n’a encore de points cette saison.')) : null,
    feed.events.length ? card('Activité', `/${ctx.gid}/activity`, h('ul.rail-feed', feed.events
      .filter((e) => !['voted', 'edited', 'pin_reset', 'invite_regenerated'].includes(e.type)).slice(0, 4)
      .map((e) => h('li', eventLine(e), h('small.muted', relative(e.createdAt)))))) : null);
}
const WIDE = '(min-width: 1280px)';

export async function homeView() {
  const [data, { feeds }] = await Promise.all([get(`/groups/${ctx.gid}/bets`), get(`/groups/${ctx.gid}/feeds`)]);
  syncClock(data.now);
  const baseline = visitBaseline(ctx.gid, now());
  const node = h('main.home');
  let filter = pref(`filter:${ctx.gid}`, 'all');
  let rail = null;

  // Un filtre par classement : compétition (Ligue 1, NFL…) ou catégorie.
  const rankings = [...new Map(data.bets.map((b) => [b.ranking.key, b.ranking])).values()];
  if (filter !== 'all' && !rankings.some((r) => r.key === filter)) filter = 'all';

  // PC large seulement (pas de requêtes de plus sur téléphone) ; redessinée avec le filtre et les scores.
  const loadRail = () => {
    if (!matchMedia(WIDE).matches) return;
    sideRail(data.bets, filter).then((r) => {
      rail?.remove();
      rail = r;
      node.append(r);
    }).catch(() => {});
  };

  // Parier d'un geste depuis la liste : toucher une option parie (ou change d'avis), sans fenêtre de confirmation.
  async function quickPick(bet, option, button) {
    if (option.id === bet.myPick) return;
    const changed = bet.myPick != null;
    await run(button, () => post(`/groups/${ctx.gid}/bets/${bet.id}/pick`, { optionId: option.id }),
      { success: changed ? `Pari changé : « ${option.label} »` : `Pari enregistré : « ${option.label} »` });
    const fresh = await get(`/groups/${ctx.gid}/bets`).catch(() => null);
    if (fresh) {
      syncClock(fresh.now);
      data.bets = fresh.bets;
    }
    draw();
    // La liste est redessinée : on rend la main sur l'option choisie (clavier, lecteur d'écran).
    node.querySelector(`.bet-card[data-bet-id="${bet.id}"] .opt-chip[aria-pressed="true"]`)?.focus({ preventScroll: true });
  }

  function draw() {
    const visible = data.bets.filter((b) => filter === 'all' || b.ranking.key === filter);
    const isNew = (b) => b.createdAt > baseline && b.creatorId !== ctx.me.id;
    const open = visible.filter((b) => b.status === 'open').sort((a, b) => a.closesAt - b.closesAt);
    const lists = [
      open.filter((b) => b.can.pick && !b.myPick),
      // Pariés : mon choix est fait ; un pari que j'arbitre (je n'y parie pas) n'attend rien de moi non plus.
      open.filter((b) => b.myPick || !b.can.pick),
      visible.filter((b) => ['closed', 'validating', 'voting'].includes(b.status))
        .sort((a, b) => closedOrder(a) - closedOrder(b) || a.closesAt - b.closesAt),
      visible.filter((b) => b.status === 'settled' || b.status === 'cancelled').sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0)),
    ];
    const chip = (id, label) => h('button.chip', {
      type: 'button', 'aria-pressed': String(filter === id),
      onclick: () => { filter = id; setPref(`filter:${ctx.gid}`, id); draw(); loadRail(); },
    }, label);
    const sections = SECTIONS.map(([title, glyph, hint], i) => (lists[i].length ? h('section.section', { dataset: { section: title } },
      h('h2.section-title', icon(glyph), ` ${title}`, h('span.count', String(lists[i].length))),
      h('p.section-hint', hint),
      h('div.cards', lists[i].map((b) => betCard(b, { isNew: isNew(b), onPick: quickPick })))) : null)).filter(Boolean);
    // Accepter une compétition fait apparaître ses paris : on recharge la vue.
    const offer = proposals(feeds, (f) => { if (f.choice === 'in') rerender(); else draw(); });
    // Les paris d'abord : les compétitions à découvrir passent sous les paris à jouer quand il y en a.
    const openAt = sections.findIndex((s) => s.dataset.section === 'À parier');
    if (offer) sections.splice(openAt >= 0 ? openAt + 1 : 0, 0, offer);

    fill(node,
      h('header.topbar',
        h('h1.group-title', h('a.group-switch', { href: '/groups', title: 'Mes groupes', 'aria-label': `${ctx.group.name} : changer de groupe` },
          h('span.group-emoji', { 'aria-hidden': 'true' }, ctx.group.emoji), h('span.group-name', ctx.group.name), icon('down', 'sm'))),
        // Sur téléphone (pas de menu de gauche) : les réglages du groupe à côté de son nom.
        ctx.me.role === 'admin' ? h('a.icon-btn.group-settings', { href: `/${ctx.gid}/admin`, 'aria-label': 'Réglages du groupe', title: 'Réglages du groupe' }, icon('settings')) : null,
        meLink()),
      activeMembers().length < 2 ? inviteCard() : null,
      rankings.length > 1 ? h('div.chips.scroll', { role: 'toolbar', 'aria-label': 'Filtrer par compétition ou catégorie' },
        chip('all', 'Tout'), rankings.map((r) => chip(r.key, `${r.emoji} ${r.label}`))) : null,
      data.bets.length === 0
        ? [offer, Object.values(ctx.settings.kinds).some(Boolean) && ctx.settings.categories.some((c) => !c.hidden)
          ? empty('🎲', 'Aucun pari pour l’instant', 'Lance le premier : une question, des options, une heure de clôture.',
            h('a.btn.primary', { href: `/${ctx.gid}/new` }, '＋ Lancer le premier pari'))
          // Pas de paris maison dans ce groupe : tout vient des compétitions activées.
          : empty('📡', 'Aucun pari pour l’instant', 'Ici, les paris s’ouvrent tout seuls avec les compétitions choisies par le groupe.',
            ctx.me.role === 'admin' ? h('a.btn.primary', { href: `/${ctx.gid}/config` }, '🎛️ Choisir des compétitions') : null)]
        : sections,
      visible.length === 0 && data.bets.length ? h('p.muted.center', 'Aucun pari ici pour le moment.') : null,
      rail,
    );
  }
  draw();
  loadRail();
  // Un match en cours : les scores se mettent à jour tout seuls (toutes les 30 secondes, quand l'app est affichée).
  const timer = data.bets.some(isLive) ? setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const fresh = await get(`/groups/${ctx.gid}/bets`).catch(() => null);
    if (!fresh) return;
    syncClock(fresh.now);
    data.bets = fresh.bets;
    draw();
    loadRail();
  }, 30_000) : null;
  return { node, tab: 'home', refreshable: true, cleanup: () => clearInterval(timer) };
}
