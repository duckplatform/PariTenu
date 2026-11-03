// Le groupe vit à l'heure de Paris : les mois du classement commencent le 1er à minuit, heure de Paris.
export const TZ = 'Europe/Paris';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(ts) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

/** Instant UTC correspondant à une date et heure de Paris. */
function parisToUtc(year, month, day, hour = 0, minute = 0) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = parts(guess);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (seen === wanted) break;
    guess += wanted - seen;
  }
  return guess;
}

/** « 2026-10 » : le mois (heure de Paris) d'un instant. */
export function monthKey(ts) {
  const p = parts(ts);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Début du mois (heure de Paris) contenant ts. */
export function monthStart(ts) {
  const p = parts(ts);
  return parisToUtc(p.year, p.month, 1);
}

/** « 2026-10-31 » : le jour (heure de Paris) d'un instant. */
export function dayKey(ts) {
  const p = parts(ts);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Le jour « AAAA-MM-JJ » décalé de n jours. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Instant du jour « AAAA-MM-JJ » à une heure donnée, heure de Paris. */
export function parisDayAt(day, hour = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return parisToUtc(y, m, d, hour);
}

// Libellés en français pour les questions générées par les sources de données.
const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });

// « 1 novembre » s'écrit « 1er novembre ».
const first = (text) => text.replace(/(^|\s)1(?=\s)/, (m, before) => `${before}1er`);

/** « samedi 31 octobre », « dimanche 1er novembre » */
export const frDay = (ts) => first(dayFmt.format(new Date(ts)));
/** « sam. 31 oct., 21:00 » */
export const frDateTime = (ts) => dateTimeFmt.format(new Date(ts));
/** « 31 déc. 2026 », « 1er janv. 2027 » */
export const frDate = (ts) => first(dateFmt.format(new Date(ts)));
