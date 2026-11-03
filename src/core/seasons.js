// Saisons des classements : on suit les vraies saisons.
//   · compétition sportive (Ligue 1, NFL, F1…) : la saison officielle, d'après les dates données par la source ;
//   · catégorie (paris entre amis, météo, cryptos, actu…) : printemps, été, automne, hiver, des équinoxes aux solstices.
// Une saison = { label, startsAt, endsAt } ; le label est unique pour un classement (« 2026-27 », « Automne 2026 »).
import { dayKey, parisDayAt } from '../lib/time.js';

const DAY = 86_400_000;
const rad = (deg) => (deg * Math.PI) / 180;

// Équinoxes et solstices (J. Meeus, Astronomical Algorithms, chap. 27) : précis à la minute, années 2000 à 3000.
const MEAN = [
  [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057], // équinoxe de mars
  [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030], // solstice de juin
  [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078], // équinoxe de septembre
  [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032], // solstice de décembre
];
const PERIODIC = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
  [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
  [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
  [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];

/** Instant (UTC, ms) de l'équinoxe ou du solstice : k = 0 mars, 1 juin, 2 septembre, 3 décembre. */
export function equinox(year, k) {
  const y = (year - 2000) / 1000;
  const [a, b, c, d, e] = MEAN[k];
  const jde0 = a + b * y + c * y ** 2 + d * y ** 3 + e * y ** 4;
  const t = (jde0 - 2451545) / 36525;
  const w = rad(35999.373 * t - 2.47);
  const dl = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w);
  const s = PERIODIC.reduce((sum, [A, B, C]) => sum + A * Math.cos(rad(B + C * t)), 0);
  const jde = jde0 + (0.00001 * s) / dl;
  return Math.round((jde - 2440587.5) * DAY) - 69_000; // temps terrestre → temps universel (≈ 69 s)
}

const NAMES = ['Printemps', 'Été', 'Automne', 'Hiver'];

/** La saison de l'année (heure de Paris) qui contient ts : elle commence à minuit le jour de l'équinoxe ou du solstice. */
export function naturalSeason(ts) {
  const year = Number(dayKey(ts).slice(0, 4));
  const starts = [];
  for (const y of [year - 1, year, year + 1]) {
    for (let k = 0; k < 4; k++) starts.push({ y, k, at: parisDayAt(dayKey(equinox(y, k)), 0) });
  }
  const i = starts.findLastIndex((s) => s.at <= ts);
  const { y, k, at } = starts[i];
  return {
    label: k === 3 ? `${NAMES[k]} ${y}-${String(y + 1).slice(-2)}` : `${NAMES[k]} ${y}`,
    startsAt: at,
    endsAt: starts[i + 1].at,
  };
}

/** « 2026 » pour une saison sur une année, « 2026-27 » à cheval sur deux. */
export function seasonLabel(startsAt, endsAt) {
  const y1 = Number(dayKey(startsAt).slice(0, 4));
  const y2 = Number(dayKey(endsAt - DAY).slice(0, 4));
  return y1 === y2 ? String(y1) : `${y1}-${String(y2).slice(-2)}`;
}

/**
 * Saison à date fixe, quand la source ne dit rien d'utilisable : elle commence le 1er du mois `month` (heure de Paris).
 * month = 1 : l'année civile ; 8 : d'août à août (rugby européen)…
 */
export function fixedSeason(ts, month = 1) {
  const [y, m] = dayKey(ts).split('-').map(Number);
  const startYear = m >= month ? y : y - 1;
  const at = (year) => parisDayAt(`${year}-${String(month).padStart(2, '0')}-01`, 0);
  const startsAt = at(startYear);
  const endsAt = at(startYear + 1);
  return { label: seasonLabel(startsAt, endsAt), startsAt, endsAt };
}

/**
 * Saison officielle d'après une source (ESPN : leagues[0].season = { startDate, endDate }) pour un événement à l'instant at.
 * Des dates incohérentes (fin avant le début, événement hors saison) font retomber sur la saison à date fixe.
 */
export function officialSeason({ startDate, endDate } = {}, at, fallbackMonth = 1) {
  const startsAt = Date.parse(startDate);
  const endsAt = Date.parse(endDate);
  const sane = startsAt < endsAt && endsAt - startsAt <= 400 * DAY && at >= startsAt && at < endsAt;
  return sane ? { label: seasonLabel(startsAt, endsAt), startsAt, endsAt } : fixedSeason(at, fallbackMonth);
}

/** Saison d'un calendrier connu de bout en bout (F1, MotoGP) : du premier jour de course au lendemain de la dernière. */
export function scheduleSeason(label, firstAt, lastAt) {
  return { label: String(label), startsAt: parisDayAt(dayKey(firstAt), 0), endsAt: parisDayAt(dayKey(lastAt + 2 * DAY), 0) };
}
