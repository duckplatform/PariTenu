import { face } from './avatars.js';
import { h } from './dom.js';
import { CANCEL_REASONS, odds, pts } from './format.js';
import { memberOf } from './state.js';

const q = (e) => (e.question ? `« ${e.question} »` : 'un pari');
const names = (ids) => ids.map((id) => memberOf(id).pseudo).join(', ').replace(/, ([^,]*)$/, ' et $1');
const list = (labels) => labels.join(', ').replace(/, ([^,]*)$/, ' et $1');

/** Phrase d'une ligne d'historique ; withBet ajoute la question (fil du groupe). */
export function eventText(e, { withBet = true } = {}) {
  const d = e.data ?? {};
  const on = withBet ? ` ${q(e)}` : '';
  switch (e.type) {
    case 'group_created': return 'a créé le groupe';
    // d.admin : fait par l'admin du site (/admin), pas par un membre du groupe.
    case 'member_joined': return d.admin ? 'a été ajouté au groupe par l’admin du site 👋' : 'a rejoint le groupe 👋';
    case 'member_left': return d.admin ? 'a quitté le groupe (compte supprimé)' : 'a quitté le groupe';
    case 'member_removed': return `a été retiré du groupe par ${d.admin ? 'l’admin du site' : memberOf(d.by).pseudo}`;
    case 'pin_reset': return `: PIN réinitialisé par ${memberOf(d.by).pseudo}`;
    case 'invite_regenerated': return 'a changé le lien d’invitation';
    case 'address_changed': return 'a changé le lien du groupe';
    case 'competitions_added': return `${d.admin ? 'L’admin du site a' : 'a'} ajouté ${list(d.labels ?? [])} aux compétitions du groupe : chacun choisit d’y participer`;
    case 'created': return d.auto ? 'Pari ouvert automatiquement' : withBet ? `a lancé un pari :${on}` : 'a lancé le pari';
    case 'auto_opened': return `${d.count > 1 ? `${d.count} nouveaux paris ouverts` : 'Un nouveau pari ouvert'} automatiquement${d.labels ? ` : ${d.labels}` : ''}`;
    case 'season_closed': {
      const head = `Fin de la saison ${d.label} · ${d.emoji} ${d.name}`;
      return d.champions.length ? `${head} : ${names(d.champions)} ${d.champions.length > 1 ? 'sont sacrés champions' : 'est sacré champion'} avec ${pts(d.score)} 🏆` : `${head}`;
    }
    case 'edited': return `a modifié${withBet ? on : ' le pari'}`;
    case 'picked': return `a parié « ${d.label} »${withBet ? ` sur${on}` : ''}${d.shared ? ` (pronostic repris de « ${d.shared} »)` : ''}`;
    case 'pick_changed': return `a changé d’avis${withBet ? ` sur${on}` : ''} : « ${d.label} » au lieu de « ${d.from} »${d.shared ? ` (repris de « ${d.shared} »)` : ''}`;
    case 'detail_added': return `a ajouté une précision${withBet ? ` à${on}` : ''} : ${d.text}`;
    case 'postponed': return `a repoussé la clôture${withBet ? ` de${on}` : ''}`;
    case 'arbiter_changed': return `a confié l’arbitrage${withBet ? ` de${on}` : ''} à ${memberOf(d.arbiterId).pseudo}`;
    case 'arbiter_withdrew': return `ne veut plus arbitrer${withBet ? on : ' ce pari'}`;
    case 'closed': return d.auto ? `Pronostics clos${withBet ? ` pour${on}` : ''}` : `a clôturé les pronostics${withBet ? ` de${on}` : ''}`;
    case 'resolved':
      if (d.auto) return `Résultat officiel${d.source ? ` (${d.source})` : ''}${withBet ? ` pour${on}` : ''} : « ${d.label} »${d.note ? ` (${d.note})` : ''}`;
      return `a tranché${withBet ? on : ''} : « ${d.label} »${d.note ? ` (${d.note})` : ''}`;
    case 'contested': return `conteste le résultat${withBet ? ` de${on}` : ''} : ${d.reason}`;
    case 'voted': return `a voté${withBet ? ` sur${on}` : ''}`;
    case 'vote_ended': return `Vote terminé${withBet ? ` pour${on}` : ''}${d.reason === 'too_few_votes' ? ' : moins de 3 votants, la décision de l’arbitre est maintenue' : ''}`;
    case 'settled': {
      const head = withBet ? `${q(e)} est réglé : ` : 'Réglé : ';
      if (d.outcome !== 'scored') return `${head}personne n’avait vu juste`;
      return `${head}${names(d.winners)} ${d.winners.length > 1 ? 'gagnent' : 'gagne'} ${pts(d.each)} (cote ${odds(d.odds)})`;
    }
    case 'cancelled': return `${withBet ? `${q(e)} est annulé` : 'Annulé'} : ${CANCEL_REASONS[d.reason] ?? ''}${d.note ? ` « ${d.note} »` : ''}`;
    case 'corrected': return `a corrigé le résultat${withBet ? ` de${on}` : ''} : ${d.reason}`;
    case 'commented': return `a commenté${withBet ? on : ''} : ${d.excerpt}`;
    default: return e.type;
  }
}

/** Les événements sans auteur (clôture automatique, règlement…) s'affichent avec une icône. */
export function eventLine(e, opts) {
  const m = e.memberId ? memberOf(e.memberId) : null;
  const icon = e.type === 'season_closed' ? '🏆 ' : e.type === 'competitions_added' ? '🆕 ' : e.data?.auto || e.type === 'auto_opened' ? '📡 ' : '🎲 ';
  return h('span.event-text', m ? h('b', h('span.avatar.xs', { 'aria-hidden': 'true' }, face(m.avatar)), ` ${m.pseudo} `) : h('b', icon), eventText(e, opts));
}
