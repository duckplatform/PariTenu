import { cls, h } from '../dom.js';
import { odds, plural, relative, signedPts } from '../format.js';
import { icon } from '../icons.js';
import { ctx } from '../state.js';
import { competitorOf, crest, isLive, kickoff, matchVisual, pickBadge } from './match.js';

/** L'état d'un pari ; compact (sur les cartes) : « dans 2 j » plutôt que « clôture dans 2 j », la catégorie garde sa place. */
export function statusChip(bet, { compact = false } = {}) {
  switch (bet.status) {
    case 'open': return h('span.status.s-open', { title: compact ? `Clôture ${relative(bet.closesAt)}` : null },
      icon('clock', 'xs'), compact ? ` ${relative(bet.closesAt)}` : ` clôture ${relative(bet.closesAt)}`);
    case 'closed':
      if (isLive(bet)) return h('span.status.s-live', h('span.live-dot', { 'aria-hidden': 'true' }), ' En direct');
      if (bet.event?.live?.state === 'post') return h('span.status.s-closed', icon('radio', 'xs'), ' Résultat imminent');
      if (bet.source) return h('span.status.s-closed', icon('radio', 'xs'), ' Résultat attendu');
      return h('span.status.s-closed', icon('lock', 'xs'), bet.overdue ? ' Verdict en retard' : ' Clos, verdict attendu');
    case 'validating': return h('span.status.s-validating', icon('scale', 'xs'), ' Résultat en validation');
    case 'voting': return h('span.status.s-voting', icon('scale', 'xs'), ' Vote en cours');
    case 'settled': return h('span.status.s-settled', icon('check', 'xs'), ' Réglé');
    default: return h('span.status.s-cancelled', icon('x', 'xs'), ' Annulé');
  }
}

/** Libellé court d'une option sur une carte de match : le nom de l'équipe ou du pilote, « Nul ». */
export function shortLabel(bet, option) {
  const c = competitorOf(bet, option);
  if (c) return c.name;
  return option.key === 'draw' ? 'Nul' : option.label;
}

/** La cote d'une option sous son nom, « 2,50 » ; le barème fixe (pas de cote connue) en grisé. */
const quote = (bet, o) => (bet.scoring === 'fixed'
  ? h('b.fixed', { title: 'Barème fixe : pas de cote connue pour ce match' }, odds(o.odds))
  : h('b', odds(o.odds)));

/**
 * La carte d'un pari dans une liste : toute la carte mène à la fiche. onPick(bet, option, button) : parier d'un geste en
 * touchant une option (sans fenêtre de confirmation), ou changer d'avis jusqu'à la clôture.
 */
export function betCard(bet, { isNew = false, onPick = null } = {}) {
  const myOption = bet.options.find((o) => o.id === bet.myPick);
  const decided = ['validating', 'settled'].includes(bet.status);
  const visual = matchVisual(bet);
  const field = visual && bet.event.layout === 'field';
  const quick = onPick && bet.can.pick;
  const chip = (o) => {
    const state = cls(o.id === bet.myPick && 'mine', decided && o.id === bet.winningOptionId && 'won');
    // Une course : une tuile par pilote (photo, numéro, nom), « Un autre pilote » en point d'interrogation.
    const c = field ? competitorOf(bet, o) : null;
    const content = field
      ? [crest(c ?? { key: o.key, name: o.label, abbr: '?' }, { round: true }), h('span', c ? c.name.split(' ').slice(1).join(' ') || c.name : 'Autre'), quote(bet, o)]
      : [h('span', visual ? shortLabel(bet, o) : o.label), quote(bet, o)];
    const tag = field ? '.opt-chip.face-tile' : '.opt-chip';
    if (!quick) return h(`span${tag}`, { class: state, title: field ? o.label : null }, content);
    return h(`button${tag}.pickable`, {
      type: 'button', class: state, title: o.label, 'aria-label': `Parier « ${o.label} »`, 'aria-pressed': String(o.id === bet.myPick),
      onclick: (e) => onPick(bet, o, e.currentTarget),
    }, content);
  };
  return h('article.bet-card', { class: cls(`st-${bet.status}`, visual && 'is-match', isLive(bet) && 'is-live'), dataset: { betId: bet.id } },
    h('a.card-link', { href: `/g/${ctx.gid}/bet/${bet.id}`, 'aria-label': bet.question }),
    // « À toi de jouer » en tête de carte (plutôt qu'un rappel en bas de chaque carte).
    h('div.bet-card-top', h('span.cat', `${bet.ranking.emoji} ${bet.ranking.label}`),
      bet.can.pick && !bet.myPick ? h('span.tag.t-todo', 'À toi de jouer') : null, statusChip(bet, { compact: true })),
    // Un match : les deux équipes et le score plutôt que « Football · Ligue 1 · Lille – Lens ».
    // (la question reste lue par les lecteurs d'écran)
    visual && !field ? [h('span.sr-only', bet.question), visual] : h('p.bet-q', bet.question),
    field ? visual : null,
    h('div.opt-chips', { class: cls(field && 'faces') }, bet.options.map(chip)),
    h('div.bet-card-foot',
      h('span.muted.bettors', icon('users', 'xs'), bet.participants ? ` ${plural(bet.participants, 'prono')}` : ' Aucun prono'),
      isNew ? h('span.tag.t-new', 'Nouveau') : null,
      bet.can.resolve ? h('span.tag.t-todo', 'À toi de trancher') : null,
      bet.can.vote ? h('span.tag.t-todo', 'Vote attendu') : null,
      myOption && ['open', 'closed', 'voting'].includes(bet.status) ? h('span.tag.t-mine', `Ton pari : ${visual ? shortLabel(bet, myOption) : myOption.label}`) : null,
      myOption && bet.can.pick ? h('span.muted.until', `modifiable jusqu’à ${kickoff(bet.closesAt)}`) : null,
      bet.status !== 'settled' ? pickBadge(bet) : null,
      bet.status === 'settled' && bet.myPoints ? h('span.tag.t-ok', signedPts(bet.myPoints)) : null));
}
