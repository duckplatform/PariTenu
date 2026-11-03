// 💶 Crypto : cours en euros sur Coinbase ; on parie sur le cours à 20 h (heure de Paris), demain et dans une semaine.
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { addDays, dayKey, frDay, parisDayAt } from '../lib/time.js';
import { PENDING, YES_NO } from './http.js';

const BASE = 'https://api.exchange.coinbase.com/products';
const TARGET_HOUR = 20;

export const COINS = [
  { id: 'BTC', label: 'Bitcoin', the: 'Le Bitcoin', slug: 'bitcoin' },
  { id: 'ETH', label: 'Ethereum', the: 'L’Ethereum', slug: 'ethereum' },
  { id: 'SOL', label: 'Solana', the: 'Le Solana', slug: 'solana' },
  { id: 'XRP', label: 'XRP', the: 'Le XRP', slug: 'xrp' },
  { id: 'DOGE', label: 'Dogecoin', the: 'Le Dogecoin', slug: 'dogecoin' },
];

const eurBig = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eurSmall = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumSignificantDigits: 4 });
export const eur = (n) => (n >= 100 ? eurBig : eurSmall).format(n);

/** Seuil « rond » proche du cours : 69 265 → 69 000, 1 988 → 2 000, 0,1834 → 0,18. */
export const roundPrice = (n) => Number(n.toPrecision(2));

/** Premier 20 h (Paris) au moins 24 h 30 plus tard : les pronostics ferment 24 h avant le relevé. */
function firstTarget(now) {
  let day = dayKey(now);
  for (;;) {
    const t = parisDayAt(day, TARGET_HOUR);
    if (t - DAY >= now + 30 * MINUTE) return t;
    day = addDays(day, 1);
  }
}

export default {
  id: 'crypto',
  category: 'eco',
  emoji: '🪙',
  name: 'Cours des cryptos',
  provider: { name: 'Coinbase', url: 'https://www.coinbase.com/fr-fr/explore' },
  about: 'Le cours à 20 h, demain et dans une semaine ; le relevé arrive tout seul.',
  params: [{ key: 'coins', type: 'multi', label: 'Cryptos', choices: COINS.map(({ id, label }) => ({ id, label })), default: ['BTC', 'ETH'] }],

  async events({ coins }, { fetchJson, now }) {
    const first = firstTarget(now);
    const targets = [first, parisDayAt(addDays(dayKey(first), 6), TARGET_HOUR)];
    const events = [];
    for (const id of coins) {
      const coin = COINS.find((c) => c.id === id);
      if (!coin) continue;
      const ticker = await fetchJson(`${BASE}/${coin.id}-EUR/ticker`, { ttl: 5 * MINUTE });
      const price = Number(ticker.price);
      if (!(price > 0)) continue;
      const threshold = roundPrice(price);
      const url = `https://www.coinbase.com/fr-fr/price/${coin.slug}`;
      events.push({
        id: coin.id,
        title: coin.label,
        subtitle: `Cours actuel : ${eur(price)} (Coinbase)`,
        startsAt: first - DAY,
        url,
        markets: targets.map((target, i) => {
          const day = frDay(target);
          return {
            id: i === 0 ? 'd1' : 'd7',
            kind: 'yesno',
            question: `${coin.the} vaut plus de ${eur(threshold)} ${day} à 20 h ?`,
            options: YES_NO,
            closesAt: target - DAY,
            expectedAt: target + 15 * MINUTE,
            details: `Cours ${coin.id}-EUR sur Coinbase ${day} à 20 h (heure de Paris). Cours au lancement : ${eur(price)}.`,
            ref: { product: `${coin.id}-EUR`, at: target, threshold, label: `${coin.label} · ${day}, 20 h`, url, closesMax: target - DAY, market: 'above', key: `crypto:${coin.id}:${target}` },
          };
        }),
      });
    }
    return events;
  },

  async result(ref, { fetchJson, now }) {
    if (now < ref.at + 5 * MINUTE) return PENDING;
    const start = new Date(ref.at - HOUR).toISOString();
    const end = new Date(ref.at).toISOString();
    const candles = await fetchJson(`${BASE}/${ref.product}/candles?granularity=3600&start=${start}&end=${end}`);
    // Bougie d'une heure [début, bas, haut, ouverture, clôture, volume] : la clôture de 19 h–20 h est le cours de 20 h.
    const candle = Array.isArray(candles) ? candles.find((c) => c[0] * 1000 === ref.at - HOUR) : null;
    if (!candle) return PENDING;
    const close = Number(candle[4]);
    return { state: 'final', key: close > ref.threshold ? 'yes' : 'no', note: `Cours Coinbase à 20 h : ${eur(close)}` };
  },
};
