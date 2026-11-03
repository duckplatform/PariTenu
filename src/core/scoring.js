// Barème de « Pari tenu ! » (cahier des charges § 7.4) — fonctions pures, sans base ni horloge.
//
// Parier est gratuit et on ne perd jamais de points. Un bon pronostic rapporte basePoints × cote (arrondi) :
//   · pari entre amis : cote du groupe = participants ÷ pronostics sur l'option ;
//   · pari sportif : cote fixe de l'option, connue avant de parier — celle des bookmakers, sinon
//     FIXED_ODDS (barème fixe). Elle ne dépend pas des autres joueurs : jamais de cote à 1, pas d'annulation.

export const MIN_PARTICIPANTS = 2;
export const FIXED_ODDS = 2; // pari sportif sans cote de bookmaker : 2 × basePoints le bon pronostic

/** Nombre de pronostics et cote de chaque option ; cote null si personne ne l'a choisie. */
export function oddsByOption(optionIds, picks) {
  const counts = new Map(optionIds.map((id) => [id, 0]));
  for (const p of picks) counts.set(p.optionId, (counts.get(p.optionId) ?? 0) + 1);
  return optionIds.map((id) => {
    const count = counts.get(id);
    return { optionId: id, count, odds: count ? picks.length / count : null };
  });
}

export function isUnanimous(picks) {
  return picks.length > 0 && new Set(picks.map((p) => p.optionId)).size === 1;
}

/** Points d'un bon pronostic à une cote donnée, plafond de cote compris. */
export function pointsFor(odds, { basePoints, oddsCap }) {
  const capped = oddsCap ? Math.min(odds, oddsCap) : odds;
  return Math.round(basePoints * capped);
}

/** « 1,4 » → cote décimale d'une cote américaine de bookmaker (+150 → 2,5 ; −250 → 1,4), arrondie au centième. */
export function decimalOdds(american) {
  const n = Number(String(american ?? '').replace('+', ''));
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return Math.round((n > 0 ? 1 + n / 100 : 1 + 100 / -n) * 100) / 100;
}

/**
 * Règlement d'un pari tranché.
 * Pari entre amis (cote du groupe) :
 * - moins de 2 participants ou pari unanime : aucun point ;
 * - chaque bon pronostic : pointsFor(N ÷ n_gagnante) ;
 * - prime de l'arbitre (celui qui a tranché) si personne n'a contesté et qu'il y avait au moins 3 participants.
 * Pari sportif (fixedOdds : Map option → cote) : chaque bon pronostic rapporte pointsFor(cote de l'option gagnante),
 * même seul ou si tout le monde a fait le même choix ; pas de prime.
 * Renvoie { outcome: 'too_few' | 'unanimous' | 'scored' | 'nobody', odds, each, awards: [{ memberId, kind, amount }] }.
 */
export function settle({ picks, winningOptionId, settings, resolverId = null, contested = false, fixedOdds = null }) {
  if (fixedOdds) {
    const winners = picks.filter((p) => p.optionId === winningOptionId);
    const odds = fixedOdds.get(winningOptionId) ?? null;
    const each = odds ? pointsFor(odds, settings) : 0;
    return { outcome: winners.length ? 'scored' : 'nobody', odds, each, awards: winners.map((w) => ({ memberId: w.memberId, kind: 'gain', amount: each })) };
  }
  if (picks.length < MIN_PARTICIPANTS) return { outcome: 'too_few', odds: null, each: 0, awards: [] };
  if (isUnanimous(picks)) return { outcome: 'unanimous', odds: null, each: 0, awards: [] };

  const winners = picks.filter((p) => p.optionId === winningOptionId);
  const odds = winners.length ? picks.length / winners.length : null;
  const each = odds ? pointsFor(odds, settings) : 0;
  const awards = winners.map((w) => ({ memberId: w.memberId, kind: 'gain', amount: each }));
  if (resolverId && !contested && picks.length >= 3 && settings.arbiterBonus > 0) {
    awards.push({ memberId: resolverId, kind: 'prime', amount: settings.arbiterBonus });
  }
  return { outcome: winners.length ? 'scored' : 'nobody', odds, each, awards };
}

/**
 * Dépouillement d'un vote après contestation.
 * Moins de 3 votants : la décision de l'arbitre est maintenue. Sinon le choix le plus voté l'emporte ;
 * égalité en tête : annulation. Renvoie { result: optionId | 'cancel', reason, counts }.
 */
export function tallyVotes(votes, arbiterChoice) {
  const counts = {};
  for (const v of votes) counts[v.choice] = (counts[v.choice] ?? 0) + 1;
  if (votes.length < 3) return { result: arbiterChoice, reason: 'too_few_votes', counts };
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return { result: 'cancel', reason: 'tie', counts };
  return { result: sorted[0][0], reason: 'majority', counts };
}
