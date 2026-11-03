const TZ = 'Europe/Paris';

// L'heure du serveur fait foi : on mesure l'écart à chaque réponse qui porte « now ».
let skew = 0;
export const syncClock = (serverNow) => { if (Number.isFinite(serverNow)) skew = serverNow - Date.now(); };
export const now = () => Date.now() + skew;

const nf = new Intl.NumberFormat('fr-FR');
export const num = (n) => nf.format(n);
export const pts = (n) => `${nf.format(n)} pts`;
export const signedPts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))} pts`;
/** Une cote comme chez les bookmakers : « 2,50 », deux décimales (pas encore de cote : « — »). */
export const odds = (x) => (x == null ? '—' : x.toFixed(2).replace('.', ','));
export const percent = (r) => (r == null ? '—' : `${Math.round(r * 100)} %`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Points d'un bon pronostic, comme le serveur (src/core/scoring.js). */
export function pointsFor(oddsValue, { basePoints, oddsCap }) {
  const capped = oddsCap ? Math.min(oddsValue, oddsCap) : oddsValue;
  return Math.round(basePoints * capped);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relative(ts) {
  const d = ts - now();
  const abs = Math.abs(d);
  if (abs < MIN) return d < 0 ? 'à l’instant' : 'dans moins d’une minute';
  const s = abs < HOUR ? `${Math.round(abs / MIN)} min` : abs < DAY ? `${Math.round(abs / HOUR)} h` : `${Math.round(abs / DAY)} j`;
  return d < 0 ? `il y a ${s}` : `dans ${s}`;
}

const dtf = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const dateTime = (ts) => dtf.format(new Date(ts));
const df = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
/** « 1er juin 2027 » */
export const dateLong = (ts) => df.format(new Date(ts)).replace(/^1 /, '1er ');

/** Valeur pour un <input type="datetime-local"> (heure de l'appareil). */
export function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? new Date(value).getTime() : null);

export const CANCEL_REASONS = {
  too_few: 'Moins de 2 participants à la clôture : aucun point.',
  unanimous: 'Pari unanime : tout le monde a choisi la même option, personne n’a pris de risque. Aucun point.',
  arbiter: 'Annulé par l’arbitre : aucun point.',
  vote: 'Le groupe a voté l’annulation : aucun point.',
  vote_tie: 'Égalité au vote : le pari est annulé, aucun point.',
  abandoned: 'Jamais tranché : annulé au bout de 30 jours, aucun point.',
  correction: 'Annulé après correction par un admin : les points ont été retirés.',
  source: 'L’événement a été annulé ou reporté : aucun point.',
};
