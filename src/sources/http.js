// Appels aux services de données : délai maximum, petit cache, erreurs lisibles.

export class SourceError extends Error {}

const USER_AGENT = 'PariTenu/1.0 (paris gratuits entre amis)';
const MAX_CACHED = 500;

/**
 * fetchJson(url, { ttl, headers }) : réponse JSON, gardée ttl ms (horloge de l'app) pour ménager les services gratuits.
 * headers : en-têtes en plus (clé d'une source qui en demande une).
 */
export function createFetchJson({ fetch = globalThis.fetch, clock, timeoutMs = 10_000 }) {
  const cache = new Map();
  return async function fetchJson(url, { ttl = 0, headers = {} } = {}) {
    const now = clock.now();
    const hit = cache.get(url);
    if (hit && now - hit.at < ttl) return hit.data;
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new SourceError(err?.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable');
    }
    if (!res.ok) throw new SourceError(`réponse ${res.status}`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new SourceError('réponse illisible');
    }
    if (ttl) {
      if (cache.size >= MAX_CACHED) cache.clear();
      cache.set(url, { at: now, data });
    }
    return data;
  };
}

/** Exécute les tâches au plus `limit` à la fois ; les échecs sont rendus (pas levés) pour garder le reste. */
export async function gather(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Coupe un texte trop long venu d'une source (question, option). */
export const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** Seuls les liens https d'une source sont gardés (affichés comme « Voir sur … »). */
export const httpsUrl = (url) => (typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) ? url : null);

// Le site qu'ouvre vraiment un lien : pas forcément la source des données (un Grand Prix de F1 chez ESPN, un match de
// padel chez Fantasy Padel Tour, le site de Padel API).
const SITES = [
  [/(^|\.)wikipedia\.org$/, 'Wikipédia'], [/(^|\.)espn\.com$/, 'ESPN'], [/(^|\.)motogp\.com$/, 'MotoGP.com'],
  [/(^|\.)formula1\.com$/, 'Formula 1'], [/(^|\.)fantasypadeltour\.com$/, 'Fantasy Padel Tour'], [/(^|\.)manifold\.markets$/, 'Manifold'],
  [/(^|\.)open-meteo\.com$/, 'Open-Meteo'], [/(^|\.)coinbase\.com$/, 'Coinbase'],
];
/** « Voir sur … » : le nom du site du lien (« Wikipédia »), sinon son adresse sans « www. ». */
export function siteName(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, '');
}

export const YES_NO = Object.freeze([{ key: 'yes', label: 'Oui' }, { key: 'no', label: 'Non' }]);

/**
 * Le titre d'un pari de sport : le sport, la compétition, la rencontre, et c'est tout (demande du 2026-11-03 : plus de
 * « qui gagne ? ») : « Tennis · Rolex Paris Masters, 1er tour · Quentin Halys – Arthur Fery ».
 */
export const sportTitle = (...parts) => parts.filter(Boolean).join(' · ');
export const PENDING = Object.freeze({ state: 'pending' });

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
/** 15,4 */
export const frNumber = (n) => nf.format(n);
