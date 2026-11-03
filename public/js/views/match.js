// La rencontre d'un pari de sport, en images : écussons ou photos, score en direct puis final, podium.
// bet.event = { layout: 'versus' | 'field', competitors: [{ key, name, abbr, img, flag, color, number, team }], live }
// (voir src/services/live.js) ; une option porte la clé de son compétiteur (o.key : 'home', 'away', id d'un pilote…).
import { cls, h } from '../dom.js';
import { now } from '../format.js';

const TZ = 'Europe/Paris';
const hm = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });

/** « 2026-10-31 », jour de Paris d'un instant. */
export const dayKey = (ts) => dayKeyFmt.format(new Date(ts));
/** « Aujourd’hui », « Demain », « sam. 1 nov. » */
export function dayLabel(ts) {
  const day = dayKey(ts);
  if (day === dayKey(now())) return 'Aujourd’hui';
  return day === dayKey(now() + 24 * 3_600_000) ? 'Demain' : dayFmt.format(new Date(ts));
}

/** « 20h45 » aujourd'hui, « sam. 1 nov. · 20h45 » un autre jour. */
export function kickoff(ts) {
  const time = hm.format(new Date(ts)).replace(':', 'h');
  return dayKey(ts) === dayKey(now()) ? time : `${dayFmt.format(new Date(ts))} · ${time}`;
}

const initials = (c) => (c.abbr || c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)).toUpperCase();

/**
 * Écusson d'une équipe ou photo d'un pilote : l'image servie par /media, sinon le drapeau, sinon les initiales sur la
 * couleur de l'équipe. size : sm (24 px), md (40 px), lg (64 px).
 */
export function crest(c, { size = 'md', round = false } = {}) {
  const el = h(`span.crest.${size}`, { class: cls(round && 'round'), title: c.team ? `${c.name} · ${c.team}` : c.name },
    h('span.crest-initials', { 'aria-hidden': 'true' }, initials(c)));
  if (c.color) el.style.setProperty('--team', c.color);
  const sources = [c.img, c.flag].filter(Boolean);
  const show = () => {
    const src = sources.shift();
    if (!src) return;
    el.classList.toggle('is-flag', src === c.flag);
    el.append(h('img', { src, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { e.target.remove(); show(); } }));
  };
  show();
  if (c.number != null) el.append(h('span.crest-number', { 'aria-hidden': 'true' }, String(c.number)));
  return el;
}

/** Le compétiteur d'une option (même clé), ou null (« Match nul », « Un autre pilote »). */
export const competitorOf = (bet, option) => bet.event?.competitors.find((c) => c.key === option.key) ?? null;

/** La rencontre est-elle en cours ? (direct de la source, ou entre le départ et la fin prévue quand la source ne dit rien) */
export function isLive(bet) {
  const live = bet.event?.live;
  if (live) return live.state === 'in';
  return !!bet.event && bet.status === 'closed' && now() >= bet.closesAt && now() < (bet.expectedAt ?? bet.closesAt);
}
export const isOver = (bet) => bet.event?.live?.state === 'post' || ['validating', 'settled'].includes(bet.status);

/**
 * Où en est mon pronostic : 'won' | 'lost' (réglé, ou course arrivée), 'winning' | 'losing' (au score du moment),
 * ou null (pas de pronostic, pas encore commencé, égalité sans match nul possible).
 */
export function pickState(bet) {
  const mine = bet.options.find((o) => o.id === bet.myPick);
  if (!mine) return null;
  if (['validating', 'settled'].includes(bet.status) && bet.winningOptionId) return mine.id === bet.winningOptionId ? 'won' : 'lost';
  const live = bet.event?.live;
  if (!live || live.state === 'pre') return null;
  if (live.podium?.length) {
    const first = live.podium[0].key;
    const listed = bet.options.some((o) => o.key === first);
    return mine.key === first || (mine.key === 'other' && !listed) ? 'won' : 'lost';
  }
  const [a, b] = bet.event.competitors;
  const sa = live.scores?.[a?.key];
  const sb = live.scores?.[b?.key];
  if (sa == null || sb == null) return null;
  const leading = sa > sb ? a.key : sb > sa ? b.key : 'draw';
  if (leading === 'draw' && !bet.options.some((o) => o.key === 'draw')) return null;
  const ok = mine.key === leading;
  if (live.state === 'post') return ok ? 'won' : 'lost';
  return ok ? 'winning' : 'losing';
}

const PICK_TEXT = { winning: '👍 Ton prono passe', losing: '👎 Ton prono ne passe pas', won: '✅ Bien vu', lost: '❌ Raté' };
export const pickBadge = (bet) => {
  const state = pickState(bet);
  return state ? h('span.pick-state', { class: `ps-${state}` }, PICK_TEXT[state]) : null;
};

/** Le chrono : 62', Mi-temps, Terminé, ou le jour du coup d'envoi (l'heure est déjà au centre). */
function clock(bet) {
  const live = bet.event.live;
  if (isLive(bet)) return h('span.match-clock.is-live', h('span.live-dot', { 'aria-hidden': 'true' }), live?.clock ?? 'En cours');
  if (live?.state === 'post') return h('span.match-clock', live.clock ?? 'Terminé');
  return h('span.match-clock', dayLabel(bet.closesAt));
}

/** Score au centre : « 2 – 1 » pendant et après le match, l'heure avant ; sets en petit au tennis. */
function centre(bet) {
  const { live, competitors: [a, b] } = bet.event;
  const scores = live?.scores && a && b && live.scores[a.key] != null && live.scores[b.key] != null ? live.scores : null;
  const sets = live?.sets && a && b ? (live.sets[a.key] ?? []).map((n, i) => `${n}-${live.sets[b.key]?.[i] ?? '?'}`).join(' ') : '';
  return h('div.match-centre',
    scores
      ? h('div.match-score', { 'aria-label': `Score ${scores[a.key]} à ${scores[b.key]}` },
        h('b', { class: cls(live.winner === a.key && 'lead') }, String(scores[a.key])), h('span', '–'), h('b', { class: cls(live.winner === b.key && 'lead') }, String(scores[b.key])))
      : h('div.match-score.vs', isLive(bet) ? '–' : hm.format(new Date(bet.closesAt)).replace(':', 'h')),
    sets ? h('small.match-sets', sets) : null,
    clock(bet));
}

/**
 * Deux équipes (ou deux joueurs) face à face, avec le score : la carte et la fiche d'un pari de sport. mine : la clé de
 * mon choix (page Direct), marqué sur l'équipe ou au centre pour le match nul (« Ton choix »).
 */
export function scoreboard(bet, { big = false, mine = null } = {}) {
  const [a, b] = bet.event.competitors;
  const badge = h('span.mine-badge', 'Ton choix');
  const team = (c, side) => h('div.match-team', { class: cls(side, mine === c.key && 'mine'), dataset: { key: c.key } },
    // Un joueur (tennis, MMA) : photo ronde, ou son drapeau ; une équipe : son écusson.
    crest(c, { size: big ? 'lg' : 'md', round: !!c.flag }), h('span.match-name', c.name), mine === c.key ? badge : null);
  const middle = centre(bet);
  if (mine === 'draw') middle.append(h('span.mine-badge', 'Nul · ton choix'));
  return h('div.match', { class: cls(big && 'big', isLive(bet) && 'live', bet.event.live?.state === 'post' && 'over') },
    a ? team(a, 'home') : h('span'), middle, b ? team(b, 'away') : h('span'));
}

/** Les pilotes d'une course (photos), avec le podium une fois la course finie. */
export function racers(bet) {
  const { live, competitors } = bet.event;
  const byKey = new Map(competitors.map((c) => [c.key, c]));
  if (live?.podium?.length) {
    return h('div.podium', live.podium.map((p, i) => h('div.podium-step', { class: `p${i + 1}` },
      crest(byKey.get(p.key) ?? { key: p.key, name: p.name, number: p.number }, { size: i ? 'md' : 'lg', round: true }),
      h('span.podium-pos', ['🥇', '🥈', '🥉'][i]), h('span.podium-name', p.name.split(' ').at(-1)))));
  }
  return h('div.racers', { class: cls(isLive(bet) && 'live') },
    isLive(bet) ? h('span.match-clock.is-live', h('span.live-dot', { 'aria-hidden': 'true' }), 'En course') : h('span.match-clock', kickoff(bet.closesAt)));
}

/** Le visuel d'un pari de sport (carte et fiche), ou null pour un pari sans rencontre (paris maison, météo…). */
export function matchVisual(bet, options) {
  if (!bet.event?.competitors?.length) return null;
  return bet.event.layout === 'field' ? racers(bet) : scoreboard(bet, options);
}
