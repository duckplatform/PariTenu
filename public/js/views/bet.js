import { face } from '../avatars.js';
import { del, get, post } from '../api.js';
import { brand } from '../brand.js';
import { cls, fill, h } from '../dom.js';
import {
  CANCEL_REASONS, dateTime, fromLocalInput, odds, plural, pointsFor, relative, signedPts, syncClock, toLocalInput,
} from '../format.js';
import { activeMembers, categoryOf, ctx, inviteUrl, memberOf, navigate } from '../state.js';
import { eventLine } from '../texts.js';
import {
  avatar, confirmSheet, field, openSheet, promptSheet, REACTIONS, run, share, toast, who,
} from '../ui.js';
import { statusChip } from './cards.js';
import { matchFacts } from './facts.js';
import { competitorOf, crest, isLive, matchVisual, pickBadge } from './match.js';

const JUST_CREATED = 'pt:justCreated';

export async function betView(route) {
  const betId = route.arg;
  const base = `/groups/${ctx.gid}/bets/${betId}`;
  const body = h('div.bet-body');
  let bet = null;
  let last = '';

  async function refresh({ force = false } = {}) {
    // Pas de rafraîchissement pendant qu'on écrit dans la fiche (note de verdict…).
    if (!force && body.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const data = await get(base);
    syncClock(data.now);
    const json = JSON.stringify(data.bet);
    if (!force && json === last) return;
    last = json;
    bet = data.bet;
    fill(body, renderBet(bet, { base, refresh: () => refresh({ force: true }) }));
  }
  await refresh({ force: true });

  const composer = ctx.settings.comments === false ? null : commentComposer(base, () => refresh({ force: true }));
  const node = h('main.bet-page',
    h('header.topbar',
      h('a.icon-btn', { href: `/${ctx.gid}`, 'aria-label': 'Retour aux paris' }, '←'),
      h('span.grow'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Partager ce pari', onclick: () => shareBet(bet) }, '📤')),
    body, composer);
  const timer = setInterval(() => refresh().catch(() => {}), 20_000);
  return { node, tab: 'home', refreshable: true, cleanup: () => clearInterval(timer), title: betTitle(bet) };
}

/** Titre de la page d'un pari : « Ligue 1 · Troyes – Le Mans » pour un match, la question sinon. */
function betTitle(bet) {
  const short = (text) => (text.length > 70 ? `${text.slice(0, 69).trimEnd()}…` : text);
  const teams = bet.event?.layout === 'versus' ? bet.event.competitors.map((c) => c.name).join(' – ') : null;
  return bet.source ? `${bet.ranking.label} · ${teams ?? short(bet.question)}` : short(bet.question);
}

export function shareBet(bet) {
  const text = bet.status === 'open'
    ? `🎲 Nouveau pari : ${bet.question} Pronostics jusqu’à ${dateTime(bet.closesAt)}.`
    : `🎲 Pari : ${bet.question}`;
  return share({ title: brand.name, text, url: `${inviteUrl()}?bet=${bet.id}` });
}

function renderBet(bet, ctxBet) {
  const cat = categoryOf(bet.categoryId);
  const justCreated = sessionStorage.getItem(JUST_CREATED) === bet.id;
  if (justCreated) sessionStorage.removeItem(JUST_CREATED);
  const precisions = bet.events.filter((e) => e.type === 'detail_added');
  return [
    justCreated ? h('section.card.highlight.stack',
      h('h2', '🎉 Pari lancé !'), h('p', 'Partage-le dans le groupe pour que tout le monde parie avant la clôture.'),
      h('button.btn.primary.wide', { type: 'button', onclick: () => shareBet(bet) }, '📤 Partager dans le groupe')) : null,
    // Pari de source : sa compétition (Ligue 1…) plutôt que sa catégorie (Sport).
    h('div.bet-head', h('span.cat', bet.source ? `${bet.ranking.emoji} ${bet.ranking.label}` : `${cat.emoji} ${cat.label}`), statusChip(bet)),
    // Un pari de sport : les équipes (ou les pilotes) et le score en grand, en direct puis final.
    matchVisual(bet, { big: true }),
    h('h1.bet-title', { class: bet.event ? 'small' : null }, bet.question),
    pickBadge(bet),
    // Buts, cartons, scores par période, statistiques… ou le classement d'une course.
    matchFacts(bet),
    bet.details ? h('p.bet-details', bet.details) : null,
    bet.source ? sourceLine(bet.source) : null,
    precisions.length ? h('div.precisions', precisions.map((e) => h('p.precision', h('b', `Précision du ${dateTime(e.createdAt)} : `), e.data.text))) : null,
    metaLine(bet),
    banner(bet),
    scoringLine(bet),
    optionsList(bet, ctxBet),
    bet.can.resolve ? resolvePanel(bet, ctxBet) : null,
    bet.status === 'voting' ? votePanel(bet, ctxBet) : null,
    actionsBar(bet, ctxBet),
    ctx.settings.comments === false ? null : commentsList(bet, ctxBet),
    h('details.history', h('summary', `Historique (${bet.events.length})`),
      h('ul.timeline', bet.events.map((e) => h('li', eventLine(e, { withBet: false }), h('time.muted', ` · ${dateTime(e.createdAt)}`))))),
  ];
}

/** Pari tout prêt : d'où vient le résultat, avec le lien vers l'événement chez la source. */
function sourceLine(source) {
  return h('p.source-line',
    h('span', { 'aria-hidden': 'true' }, `${source.emoji} `), source.label,
    // Le site que le lien ouvre vraiment (la page Wikipédia d'un Grand Prix, pas Jolpica qui donne le résultat).
    source.url ? [' · ', h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, `Voir sur ${source.site ?? source.name} ↗`)] : null);
}

/** Qui a proposé le résultat : un membre, ou la source de données. */
const resolver = (bet) => (bet.resolvedBy ? who(bet.resolvedBy) : h('span.who', `📡 ${bet.source?.name ?? 'la source'} (résultat officiel)`));

function metaLine(bet) {
  const judge = bet.source ? h('span', `🤖 Résultat automatique (${bet.source.name})`)
    : ['⚖️ Arbitre : ', bet.arbiterId ? who(bet.arbiterId) : h('em', 'à désigner')];
  return h('div.meta',
    h('p', bet.creatorId ? ['Lancé par ', who(bet.creatorId)] : '📡 Ouvert automatiquement', ' · ', judge),
    h('p', 'Compte pour le classement ', h('a', { href: `/${ctx.gid}/rank/${encodeURIComponent(bet.ranking.key)}/${encodeURIComponent(bet.seasonId ?? '')}` },
      `${bet.ranking.emoji} ${bet.ranking.label}`)),
    h('p', bet.status === 'open' ? `Pronostics jusqu’au ${dateTime(bet.closesAt)} (${relative(bet.closesAt)})` : `Pronostics clos le ${dateTime(bet.closedAt ?? bet.closesAt)}`),
    bet.expectedAt ? h('p', `Résultat attendu le ${dateTime(bet.expectedAt)}`) : null);
}

const optionLabel = (bet, id) => (id === 'cancel' ? 'Annuler le pari' : bet.options.find((o) => o.id === id)?.label ?? '?');

function banner(bet) {
  const me = ctx.me.id;
  switch (bet.status) {
    case 'open':
      if (bet.arbiterId === me) return h('p.banner.b-info', '⚖️ Tu es l’arbitre : tu ne paries pas sur ce pari, c’est toi qui trancheras.');
      if (bet.myPick) return h('p.banner.b-ok', `✔️ Ton pari : « ${optionLabel(bet, bet.myPick)} ». Tu peux changer d’avis jusqu’à la clôture.`);
      return h('p.banner.b-info', '👇 Touche une option pour parier. C’est gratuit, et tu peux changer d’avis jusqu’à la clôture.');
    case 'closed':
      if (bet.source) {
        if (bet.can.resolve || bet.overdue) {
          return h('p.banner.b-warn', `⏰ ${bet.source.name} n’a pas encore donné le résultat. Au bout de 24 h, un admin sans pronostic peut trancher à la main.`);
        }
        const text = isLive(bet) ? `⏱️ C’est parti ! Le score se met à jour tout seul ; le résultat officiel arrive après la fin (${bet.source.name}).`
          : bet.event?.live?.state === 'post' ? `🏁 Terminé ! Le résultat officiel et les points arrivent dans quelques minutes (${bet.source.name}).`
            : `📡 Pronostics clos. Le résultat officiel arrive tout seul (${bet.source.name}) peu après l’événement.`;
        return h('div.banner.b-info',
          h('p', text),
          bet.source.checkedAt ? h('p.muted', `Dernière vérification ${relative(bet.source.checkedAt)}.`) : null);
      }
      if (!bet.arbiterId) return h('p.banner.b-warn', 'L’arbitre s’est désisté : un admin sans pronostic peut trancher.');
      return h('p.banner', { class: bet.overdue ? 'b-warn' : 'b-info' },
        bet.overdue ? `⏰ L’arbitre a du retard : on attend son verdict.` : '🔒 Pronostics clos. On attend le verdict de l’arbitre.');
    case 'validating':
      return h('div.banner.b-info',
        h('p', h('b', `Résultat proposé : « ${optionLabel(bet, bet.winningOptionId)} »`), ' par ', resolver(bet)),
        bet.resolutionNote ? h('p.quote', `« ${bet.resolutionNote} »`) : null,
        h('p', `Les points seront attribués ${relative(bet.validationEndsAt)}, sauf contestation d’un participant.`));
    case 'voting':
      return h('div.banner.b-warn',
        h('p', h('b', '🗳️ Résultat contesté'), ' par ', who(bet.dispute?.memberId), ` : « ${bet.dispute?.reason ?? ''} »`),
        h('p', `${bet.resolvedBy ? 'L’arbitre avait choisi' : `${bet.source?.name ?? 'La source'} avait donné`} « ${optionLabel(bet, bet.winningOptionId)} ». Le groupe vote jusqu’au ${dateTime(bet.voteEndsAt)}.`));
    case 'settled': {
      const gains = bet.awards.filter((a) => a.kind === 'gain');
      const prime = bet.awards.find((a) => a.kind === 'prime');
      return h('div.banner.b-ok',
        h('p', h('b', `✅ Résultat : « ${optionLabel(bet, bet.winningOptionId)} »`)),
        bet.resolutionNote ? h('p.quote', `« ${bet.resolutionNote} »`) : null,
        bet.source ? h('p.muted', `📡 Résultat officiel (${bet.source.name}) : il ne se conteste pas. Une erreur ? Un admin du groupe peut le corriger.`) : null,
        gains.length
          ? h('p.awards', gains.map((a) => h('span.award', avatar(a.memberId), ` ${memberOf(a.memberId).pseudo} ${signedPts(a.amount)}`)))
          : h('p', 'Personne n’avait vu juste : aucun point cette fois.'),
        prime ? h('p.muted', `⚖️ Prime d’arbitre : ${memberOf(prime.memberId).pseudo} ${signedPts(prime.amount)}`) : null);
    }
    default:
      return h('div.banner.b-muted', h('p', h('b', '🚫 Pari annulé. '), CANCEL_REASONS[bet.cancelReason] ?? ''),
        bet.cancelNote ? h('p.quote', `« ${bet.cancelNote} »`) : null);
  }
}

/** Comment se calculent les points de ce pari (affiché au-dessus des options). */
function scoringLine(bet) {
  if (bet.scoring === 'bookmaker') return h('p.scoring', '📈 Cotes des bookmakers : un bon pronostic rapporte 100 × la cote, même si tout le monde a fait le même choix.');
  if (bet.scoring === 'fixed') return h('p.scoring', '🎯 Barème fixe (pas de cote connue pour ce match) : un bon pronostic rapporte 200 pts.');
  return h('p.scoring', '👥 Cote du groupe : plus tu as raison seul contre le groupe, plus ça rapporte.');
}

function optionsList(bet, { base, refresh }) {
  // Pendant un vote, le choix de l'arbitre est contesté : on ne le montre pas comme gagnant.
  const decided = ['validating', 'settled'].includes(bet.status);
  return h('div.options', { role: bet.can.pick ? 'list' : null }, bet.options.map((o) => {
    const share = bet.participants ? o.count / bet.participants : 0;
    const won = decided && o.id === bet.winningOptionId;
    const fill = h('span.bar-fill');
    fill.style.width = `${Math.round(share * 100)}%`;
    const face = competitorOf(bet, o);
    const content = [
      h('div.option-main',
        face ? crest(face, { size: 'sm', round: bet.event.layout === 'field' }) : null,
        h('span.option-label', o.label, won ? ' ✅' : ''),
        h('span.odds', { title: bet.scoring === 'group' ? 'Cote : participants ÷ pronostics sur cette option' : 'Cote fixe de cette option' }, odds(o.odds))),
      h('div.bar', fill),
      h('div.option-foot',
        h('span.pickers', o.pickers.map((id) => avatar(id, { size: 'xs' }))),
        h('span.muted', `${plural(o.count, 'pronostic')}${bet.status === 'open' && o.points ? ` · ${bet.scoring === 'group' ? '≈ ' : ''}${o.points} pts si ça gagne` : ''}`)),
      bet.myPick === o.id ? h('span.mine-tag', 'Ton pari') : null,
    ];
    const className = cls('option', bet.myPick === o.id && 'mine', won && 'won');
    // Mon option du moment n'est pas à retoucher ; les autres, si : on change d'avis jusqu'à la clôture.
    if (!bet.can.pick || bet.myPick === o.id) return h('div', { class: className, dataset: { optionId: o.id } }, content);
    return h('button', {
      type: 'button', class: cls(className, 'pickable'), dataset: { optionId: o.id },
      'aria-label': `Parier « ${o.label} »`,
      onclick: () => pickSheet(bet, o, base, refresh),
    }, content);
  }));
}

/**
 * Points si je rejoins cette option maintenant : ma voix compte dans la cote du groupe (cote fixe : elle ne bouge pas).
 * Un changement d'avis ne compte pas un participant de plus.
 */
function potential(bet, option) {
  if (bet.scoring !== 'group') return { odds: option.odds, points: option.points };
  const n = bet.participants + (bet.myPick ? 0 : 1);
  const k = option.count + 1;
  return { odds: n / k, points: pointsFor(n / k, ctx.settings) };
}

async function pickSheet(stale, staleOption, base, refresh) {
  // Les autres ont pu parier depuis l'ouverture de la fiche : on recalcule sur les chiffres du moment.
  const data = await run(null, () => get(base));
  if (!data) return;
  const bet = data.bet;
  const option = bet.options.find((o) => o.id === staleOption.id);
  if (!bet.can.pick || !option) {
    await refresh();
    return;
  }
  const p = potential(bet, option);
  const previous = bet.options.find((o) => o.id === bet.myPick);
  const ok = await openSheet(previous ? 'Changer ton pari' : 'Confirmer ton pari', (close) => h('div.stack',
    h('p.big', `Tu paries « ${option.label} »`),
    previous ? h('p.muted', `Au lieu de « ${previous.label} ».`) : null,
    bet.scoring === 'group'
      ? h('p.potential', 'Si tu as raison : ', h('b', `≈ ${p.points} pts`), ` (cote ${odds(p.odds)} avec ton pari, à l’heure actuelle).`)
      : h('p.potential', 'Si tu as raison : ', h('b', `${p.points} pts`), ` (cote ${odds(p.odds)}, fixée à l’avance).`),
    h('p.muted', bet.scoring === 'group'
      ? 'La cote bouge avec les pronostics des autres jusqu’à la clôture. Tu peux changer d’avis jusque-là.'
      : 'Ton pronostic vaut aussi dans tes autres groupes où ce match est ouvert. Tu peux changer d’avis jusqu’à la clôture.'),
    h('div.row-end',
      h('button.btn', { type: 'button', onclick: () => close(false) }, 'Retour'),
      h('button.btn.primary', { type: 'button', onclick: () => close(true) }, 'Je parie !'))));
  if (!ok) return;
  if (await run(null, () => post(`${base}/pick`, { optionId: option.id }), { success: previous ? 'Pari changé.' : 'Pari enregistré.' })) await refresh();
}

function resolvePanel(bet, { base, refresh }) {
  const standIn = bet.arbiterId !== ctx.me.id;
  const standInText = bet.source
    ? `${bet.source.name} n’a rien donné : en tant qu’admin sans pronostic, tu peux trancher à la main.`
    : 'L’arbitre est absent : en tant qu’admin sans pronostic, tu peux trancher à sa place.';
  const choices = bet.options.map((o) => h('label.choice',
    h('input', { type: 'radio', name: 'winner', value: o.id }), h('span', o.label), h('span.muted', ` · ${plural(o.count, 'pronostic')}`)));
  const note = h('input', { type: 'text', maxlength: 280, placeholder: 'Ex. : arrivé à 20 h 10, photo dans le groupe' });
  const err = h('p.form-error', { role: 'alert' });
  const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Valider le résultat');
  return h('section.panel.verdict',
    h('h2', '⚖️ À toi de trancher'),
    standIn ? h('p.muted', standInText) : null,
    h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        const chosen = choices.map((c) => c.querySelector('input')).find((i) => i.checked);
        if (!chosen) { err.textContent = 'Choisis l’option gagnante.'; return; }
        if (await run(submit, () => post(`${base}/resolve`, { optionId: chosen.value, note: note.value }), { success: 'Résultat proposé au groupe.' })) await refresh();
      },
    }, h('div.choice-list', { role: 'radiogroup', 'aria-label': 'Option gagnante' }, choices),
    field('Comment tu as tranché (facultatif)', note), err, submit,
    h('p.muted', `Les participants auront ${ctx.settings.validationHours} h pour contester. Sans contestation, les points tombent.`)));
}

function votePanel(bet, { base, refresh }) {
  const choices = [...bet.options.map((o) => ({ id: o.id, label: o.label })), { id: 'cancel', label: 'Annuler le pari' }];
  const myVote = bet.votes.find((v) => v.memberId === ctx.me.id);
  return h('section.panel.vote',
    h('h2', '🗳️ Vote du groupe'),
    h('p.muted', `${bet.votes.length} vote${bet.votes.length > 1 ? 's' : ''} sur ${bet.eligibleVoters.length} · fin ${relative(bet.voteEndsAt)}`),
    h('ul.vote-list', choices.map((c) => {
      const voters = bet.votes.filter((v) => v.choice === c.id).map((v) => v.memberId);
      return h('li.vote-row', { dataset: { choice: c.id } },
        h('span.grow', h('b', c.label), c.id === bet.winningOptionId ? h('span.muted', bet.resolvedBy ? ' (choix de l’arbitre)' : ' (résultat de la source)') : null),
        h('span.pickers', voters.map((id) => avatar(id, { size: 'xs' }))),
        h('span.count', String(voters.length)),
        bet.can.vote ? h('button.btn.small', {
          type: 'button',
          onclick: async (e) => {
            if (await run(e.currentTarget, () => post(`${base}/vote`, { choice: c.id }), { success: 'Vote enregistré.' })) await refresh();
          },
        }, 'Voter') : null);
    })),
    myVote ? h('p.muted', `Tu as voté « ${optionLabel(bet, myVote.choice)} ».`) : null,
    bet.resolvedBy === ctx.me.id ? h('p.muted', 'Tu as tranché ce pari : tu ne votes pas.') : null,
    h('p.hint', 'Le choix le plus voté l’emporte. Égalité : pari annulé. Moins de 3 votants : la décision de l’arbitre est maintenue.'));
}

function actionsBar(bet, { base, refresh }) {
  const c = bet.can;
  const btn = (label, onclick, kind = '') => h('button.btn', { type: 'button', class: kind, onclick }, label);
  const after = async (promise) => { if (await promise) await refresh(); };
  const actions = [
    c.check ? btn('🔄 Vérifier le résultat', async (e) => {
      const r = await run(e.target, () => post(`${base}/check`));
      if (!r) return;
      const message = {
        final: ['Résultat reçu : il est proposé au groupe.', 'ok'],
        void: ['L’événement a été annulé : le pari aussi.', 'info'],
        pending: ['Pas encore de résultat officiel. Réessaie un peu plus tard.', 'info'],
        error: [`${bet.source.name} ne répond pas. Réessaie un peu plus tard.`, 'error'],
      }[r.state];
      if (message) toast(...message);
      await refresh();
    }) : null,
    c.contest ? btn('Contester le résultat', async (e) => {
      const reason = await promptSheet('Contester le résultat', {
        intro: 'Ta contestation ouvre un vote de tout le groupe.', label: 'Pourquoi n’es-tu pas d’accord ?', confirm: 'Contester',
      });
      if (reason) await after(run(e.target, () => post(`${base}/contest`, { reason }), { success: 'Contestation envoyée : le groupe vote.' }));
    }, 'danger') : null,
    c.close ? btn('Clôturer maintenant', async (e) => {
      if (await confirmSheet('Clôturer les pronostics ?', 'Plus personne ne pourra parier.', { confirm: 'Clôturer' })) {
        await after(run(e.target, () => post(`${base}/close`), { success: 'Pronostics clos.' }));
      }
    }) : null,
    c.cancel ? btn('Annuler le pari', async (e) => {
      const note = await promptSheet('Annuler le pari', {
        intro: 'Personne ne gagnera de points sur ce pari.', label: 'Pourquoi ? (facultatif)', confirm: 'Annuler le pari', required: false,
      });
      if (note !== null) await after(run(e.target, () => post(`${base}/cancel`, { note }), { success: 'Pari annulé.' }));
    }, 'danger') : null,
    c.correct ? btn('Corriger le résultat', () => correctSheet(bet, base, refresh)) : null,
    c.edit ? h('a.btn', { href: `/${ctx.gid}/bet/${bet.id}/edit` }, 'Modifier') : null,
    c.delete ? btn('Supprimer', async (e) => {
      if (await confirmSheet('Supprimer ce pari ?', 'Personne n’a encore parié : il disparaît complètement.', { confirm: 'Supprimer', danger: true })) {
        if (await run(e.target, () => del(base), { success: 'Pari supprimé.' })) navigate(`/${ctx.gid}`);
      }
    }, 'danger') : null,
    c.addDetail ? btn('Ajouter une précision', async (e) => {
      const text = await promptSheet('Ajouter une précision', { label: 'Elle sera datée et visible de tous.', max: 500, confirm: 'Ajouter' });
      if (text) await after(run(e.target, () => post(`${base}/details`, { text }), { success: 'Précision ajoutée.' }));
    }) : null,
    c.postpone ? btn('Repousser la clôture', () => postponeSheet(bet, base, refresh)) : null,
    c.setArbiter ? btn('Changer d’arbitre', () => arbiterSheet(bet, base, refresh)) : null,
    c.withdrawArbiter ? btn('Je ne veux plus arbitrer', async (e) => {
      if (await confirmSheet('Te désister ?', 'Le créateur du pari devra choisir un autre arbitre.', { confirm: 'Me désister' })) {
        await after(run(e.target, () => post(`${base}/withdraw`), { success: 'Tu n’es plus l’arbitre de ce pari.' }));
      }
    }) : null,
  ].filter(Boolean);
  return actions.length ? h('div.actions', actions) : null;
}

async function correctSheet(bet, base, refresh) {
  const result = await openSheet('Corriger le résultat', (close) => {
    const choices = [...bet.options, { id: 'cancel', label: 'Annuler le pari (aucun point)' }].map((o) => h('label.choice',
      h('input', { type: 'radio', name: 'fix', value: o.id }), h('span', o.label)));
    const reason = h('textarea', { rows: 2, maxlength: 280, placeholder: 'Ex. : l’arbitre s’est trompé de prénom' });
    const err = h('p.form-error', { role: 'alert' });
    return h('form.stack', {
      onsubmit: (e) => {
        e.preventDefault();
        const chosen = choices.map((c) => c.querySelector('input')).find((i) => i.checked);
        if (!chosen) { err.textContent = 'Choisis le bon résultat.'; return; }
        if (!reason.value.trim()) { err.textContent = 'Explique la correction.'; return; }
        close({ optionId: chosen.value, reason: reason.value.trim() });
      },
    }, h('p.muted', 'Les points déjà donnés sont retirés (écritures inverses), puis les nouveaux sont attribués, sans prime d’arbitre.'),
    h('div.choice-list', choices), field('Raison (visible de tous)', reason), err,
    h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, 'Corriger')));
  });
  if (result && await run(null, () => post(`${base}/correct`, result), { success: 'Résultat corrigé.' })) await refresh();
}

async function postponeSheet(bet, base, refresh) {
  const closesAt = await openSheet('Repousser la clôture', (close) => {
    const input = h('input', { type: 'datetime-local', value: toLocalInput(bet.closesAt + 3_600_000) });
    return h('form.stack', {
      onsubmit: (e) => { e.preventDefault(); close(fromLocalInput(input.value)); },
    }, field('Nouvelle clôture des pronostics', input),
    h('div.row-end', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Retour'), h('button.btn.primary', { type: 'submit' }, 'Repousser')));
  });
  if (closesAt && await run(null, () => post(`${base}/postpone`, { closesAt }), { success: 'Clôture repoussée.' })) await refresh();
}

async function arbiterSheet(bet, base, refresh) {
  const pickers = new Set(bet.options.flatMap((o) => o.pickers));
  const candidates = activeMembers().filter((m) => !pickers.has(m.id));
  const arbiterId = await openSheet('Changer d’arbitre', (close) => h('div.stack',
    h('p.muted', 'L’arbitre ne peut pas avoir parié sur ce pari.'),
    candidates.length ? h('div.member-grid', candidates.map((m) => h('button.member-choice', {
      type: 'button', 'aria-pressed': String(m.id === bet.arbiterId), onclick: () => close(m.id),
    }, h('span.avatar.lg', face(m.avatar)), h('span', m.pseudo)))) : h('p', 'Tout le monde a déjà parié.')));
  if (arbiterId && arbiterId !== bet.arbiterId) {
    if (await run(null, () => post(`${base}/arbiter`, { arbiterId }), { success: `${memberOf(arbiterId).pseudo} arbitre ce pari.` })) await refresh();
  }
}

function commentsList(bet, { base, refresh }) {
  return h('section.comments',
    h('h2.section-title', '💬 Commentaires', h('span.count', String(bet.comments.length))),
    bet.comments.length ? h('ul.comment-list', bet.comments.map((c) => h('li.comment',
      avatar(c.memberId),
      h('div.comment-body',
        h('p.comment-head', h('b', memberOf(c.memberId).pseudo), h('span.muted', ` · ${relative(c.createdAt)}`)),
        h('p', { class: cls(REACTIONS.includes(c.body) && 'reaction') }, c.body)),
      c.memberId === ctx.me.id || ctx.me.role === 'admin' ? h('button.icon-btn.small', {
        type: 'button', 'aria-label': 'Supprimer ce commentaire',
        onclick: async (e) => { if (await run(e.currentTarget, () => del(`${base}/comments/${c.id}`))) await refresh(); },
      }, '🗑') : null))) : h('p.muted', 'Pas encore de commentaire. À toi de chambrer !'));
}

function commentComposer(base, refresh) {
  const input = h('input', { type: 'text', maxlength: 280, placeholder: 'Un commentaire, une vanne…', 'aria-label': 'Écrire un commentaire' });
  const send = async (body, button) => {
    if (!body.trim()) return;
    if (await run(button, () => post(`${base}/comments`, { body }))) {
      if (body === input.value) input.value = '';
      await refresh();
    }
  };
  const submit = h('button.btn.primary', { type: 'submit' }, 'Envoyer');
  return h('form.composer', { onsubmit: (e) => { e.preventDefault(); send(input.value, submit); } },
    h('div.reactions', REACTIONS.map((r) => h('button.reaction-btn', { type: 'button', 'aria-label': `Réagir ${r}`, onclick: (e) => send(r, e.currentTarget) }, r))),
    h('div.composer-row', input, submit));
}

export const markJustCreated = (id) => {
  try { sessionStorage.setItem(JUST_CREATED, id); } catch { /* indisponible */ }
};
