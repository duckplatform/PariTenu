// 🔮 Questions d'actualité : marchés prédictifs de Manifold (monnaie fictive, questions en anglais).
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { frDate } from '../lib/time.js';
import { clip, httpsUrl, PENDING, YES_NO } from './http.js';

const BASE = 'https://api.manifold.markets/v0';
const MAX_HORIZON = 120 * DAY; // au-delà, le pari traînerait trop longtemps

export default {
  id: 'manifold',
  category: 'actu',
  emoji: '🔮',
  name: 'Questions d’actualité',
  provider: { name: 'Manifold', url: 'https://manifold.markets/' },
  about: 'Les questions oui/non les plus suivies sur Manifold (en anglais : reformule-les à ta façon). Le résultat officiel arrive tout seul.',
  params: [{ key: 'term', type: 'text', label: 'Thème (en anglais, facultatif)', placeholder: 'France, football, AI…', default: '', max: 40 }],

  async events({ term }, { fetchJson, now }) {
    const url = `${BASE}/search-markets?term=${encodeURIComponent(term)}&filter=open&contractType=BINARY&sort=most-popular&limit=100`;
    const list = await fetchJson(url, { ttl: 30 * MINUTE });
    return (Array.isArray(list) ? list : [])
      .filter((m) => m.outcomeType === 'BINARY' && !m.isResolved && m.closeTime > now + HOUR && m.closeTime < now + MAX_HORIZON)
      .slice(0, 30)
      .map((m) => {
        const link = httpsUrl(m.url);
        const chance = `${Math.round((m.probability ?? 0) * 100)} %`;
        return {
          id: m.id,
          title: clip(m.question, 140),
          subtitle: `Manifold · ${chance} de oui · clôture le ${frDate(m.closeTime)}`,
          startsAt: m.closeTime,
          url: link,
          markets: [{
            id: 'yes',
            kind: 'yesno',
            question: clip(m.question, 140),
            options: YES_NO,
            closesAt: m.closeTime,
            expectedAt: m.closeTime,
            details: `Question du marché Manifold (en anglais : reformule-la à ta façon). Le résultat officiel de Manifold fait foi ; s’il est annulé là-bas, le pari aussi. Probabilité au lancement : ${chance}.`,
            ref: { id: m.id, label: `Manifold · ${clip(m.question, 60)}`, url: link, closesMax: m.closeTime, market: 'yes', key: `manifold:${m.id}` },
          }],
        };
      });
  },

  async result(ref, { fetchJson }) {
    const m = await fetchJson(`${BASE}/market/${encodeURIComponent(ref.id)}`);
    if (!m.isResolved) return PENDING;
    if (m.resolution === 'YES') return { state: 'final', key: 'yes', note: 'Résolu « oui » sur Manifold' };
    if (m.resolution === 'NO') return { state: 'final', key: 'no', note: 'Résolu « non » sur Manifold' };
    return { state: 'void', note: 'Question annulée sur Manifold' };
  },
};
