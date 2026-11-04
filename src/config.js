import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIN_PARAMS } from './lib/pin.js';

// Le dossier de l'app : .env et data/ s'y trouvent, quel que soit le dossier courant (service, cron, terminal).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Charge le .env de l'app s'il existe, en secours : les variables déjà définies (service système, hébergeur,
 * terminal…) restent prioritaires. Modèle commenté : .env.example.
 */
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

/** La base : un chemin relatif part du dossier de l'app (« :memory: » : en mémoire, pour les tests). */
const dbPathOf = (value) => (value === ':memory:' ? value : path.resolve(ROOT, value || 'data/paritenu.db'));

function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'false' || value === '0') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // 'loopback', une IP, une liste…
}

/**
 * Variables d'environnement (le .env n'étant qu'un secours ; voir .env.example) :
 *   PORT (5190), HOST (0.0.0.0) : ignorés sous Phusion Passenger, qui choisit lui-même
 *   PT_DB_PATH (data/paritenu.db) : à côté de la base, data/branding (icône) et data/media (images des sources)
 *   PT_COOKIE_SECURE : auto (défaut : Secure en HTTPS) | always | never
 *   PT_TRUST_PROXY   : loopback (défaut, un reverse proxy sur la même machine) | nombre de proxys | false
 *   PT_TEST_HOOKS=1  : expose /api/_test/clock pour déplacer l'horloge (tests et démo uniquement)
 *   PT_PADEL_TOKEN   : clé personnelle gratuite de Padel API (padelapi.org) ; sans elle, pas de paris de padel
 */
export function buildConfig(env = process.env) {
  const isTest = env.NODE_ENV === 'test';
  return {
    port: Number(env.PORT) || 5190,
    host: env.HOST || '0.0.0.0',
    dbPath: dbPathOf(env.PT_DB_PATH),
    cookieSecure: ['auto', 'always', 'never'].includes(env.PT_COOKIE_SECURE) ? env.PT_COOKIE_SECURE : 'auto',
    trustProxy: parseTrustProxy(env.PT_TRUST_PROXY),
    testHooks: env.PT_TEST_HOOKS === '1',
    sweepEveryMs: isTest ? 0 : 60_000,
    sourceCheckEveryMs: isTest ? 0 : 5 * 60_000, // résultats des paris reliés à une source de données
    liveEveryMs: isTest ? 0 : 60_000, // scores en direct des rencontres en cours
    sourceKeys: { padel: env.PT_PADEL_TOKEN || null }, // sources qui demandent une clé personnelle
    autoOpenEveryMs: isTest ? 0 : 30 * 60_000, // ouverture des paris des compétitions activées (et juste après un réglage)
    // En test, un hachage léger garde la suite rapide ; en vrai, scrypt au niveau OWASP.
    pinParams: isTest ? { cost: 2 ** 10, blockSize: 8, parallelization: 1 } : PIN_PARAMS,
    authRateLimit: isTest ? 10_000 : 30,
  };
}
