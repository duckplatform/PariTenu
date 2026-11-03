import { createApp } from '../src/app.js';
import { buildConfig } from '../src/config.js';
import { createClock } from '../src/lib/clock.js';
import { fakeUpstream } from './fake-upstream.js';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const MINUTE = 60_000;

export function makeConfig(env = {}) {
  return buildConfig({ NODE_ENV: 'test', PT_DB_PATH: ':memory:', PT_PADEL_TOKEN: 'jeton-padel-de-test', ...env });
}

/** Lance l'app sur un port libre, avec une horloge pilotable et de faux fournisseurs de données (srv.upstream). */
export async function startServer(env = {}) {
  const config = makeConfig(env);
  const clock = createClock();
  const upstream = fakeUpstream(clock);
  const instance = createApp(config, { clock, fetch: upstream.fetch });
  const server = await new Promise((resolve) => {
    const s = instance.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...instance,
    clock,
    upstream,
    base,
    client: () => new Client(base),
    async stop() {
      await new Promise((r) => server.close(r));
      instance.close();
    },
  };
}

/** Petit client HTTP qui garde ses cookies, comme un téléphone. */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.setCookies = [];
  }

  async req(method, path, { body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && !('content-type' in h)) h['content-type'] = 'application/json';
    const res = await fetch(this.base + path, {
      method, headers: h, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    });
    this.setCookies = res.headers.getSetCookie();
    for (const c of this.setCookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, headers: res.headers };
  }

  get(path, opts) { return this.req('GET', path, opts); }
  post(path, body, opts) { return this.req('POST', path, { ...opts, body }); }
  patch(path, body, opts) { return this.req('PATCH', path, { ...opts, body }); }
  delete(path, opts) { return this.req('DELETE', path, opts); }

  /** Appel qui doit réussir : renvoie le corps, sinon lève une erreur lisible. */
  async ok(method, path, body) {
    const r = await this.req(method, path, { body });
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export const PIN = '4321';

/** Un coupon de création de groupe (comme ceux que génère l'admin de l'instance). */
export const coupon = (srv) => srv.deps.coupons.create({ note: 'test' }).code;
const PSEUDOS = { ines: 'Inès', jo: 'Jo' };

/** Ce qu'un admin active d'abord pour lancer des paris maison : les deux types et toutes les catégories. */
export async function enableHouseBets(client, gid) {
  const { settings } = await client.ok('GET', `/api/groups/${gid}`);
  await client.ok('PATCH', `/api/groups/${gid}/settings`, {
    kinds: { yesno: true, multi: true }, categories: settings.categories.map((c) => ({ ...c, hidden: false })),
  });
}

/** « Léa », « Max »… : le pseudo affiché d'un membre de test, sans le numéro qui le rend unique sur le serveur. */
export const plain = (pseudo) => pseudo.replace(/ \d+$/, '');

/**
 * Un groupe prêt à jouer : Léa (admin, créatrice) puis les pseudos demandés, chacun avec son compte ; paris maison activés
 * (un groupe neuf n'a rien d'activé), sauf avec { house: false }.
 * Un pseudo est unique sur toute l'instance : du deuxième groupe d'un même serveur, ce sont « Léa 2 », « Max 2 »…
 * Renvoie { gid, token, c: { lea, max, … }, id: { lea, max, … }, pseudo: { lea: 'Léa 2', … } }.
 */
export async function setupGroup(srv, names = ['max', 'tom', 'ines'], { house = true } = {}) {
  srv.groupCount = (srv.groupCount ?? 0) + 1;
  const suffix = srv.groupCount > 1 ? ` ${srv.groupCount}` : '';
  const lea = srv.client();
  const { groupId: gid } = await lea.ok('POST', '/api/groups', { name: 'Les Potes', emoji: '🍻', pseudo: `Léa${suffix}`, avatar: '🦊', pin: PIN, coupon: coupon(srv) });
  if (house) await enableHouseBets(lea, gid);
  const group = await lea.ok('GET', `/api/groups/${gid}`);
  const token = group.group.inviteToken;
  const c = { lea };
  const id = { lea: group.me.id };
  const pseudos = { lea: `Léa${suffix}` };
  for (const name of names) {
    const client = srv.client();
    const pseudo = (PSEUDOS[name] ?? name[0].toUpperCase() + name.slice(1)) + suffix;
    await client.ok('POST', `/api/invite/${token}/join`, { pseudo, avatar: '🐻', pin: PIN });
    c[name] = client;
    id[name] = (await client.ok('GET', `/api/groups/${gid}`)).me.id;
    pseudos[name] = pseudo;
  }
  return { gid, token, c, id, pseudo: pseudos };
}

/** Crée un pari (Léa arbitre par défaut) et renvoie { betId, opt: { Oui: id, … } }. */
export async function createBet(srv, g, { by = 'lea', question = 'Julien arrive après 20 h 15 ?', kind = 'yesno', options, closesIn = HOUR, arbiter, category = 'groupe', expectedIn } = {}) {
  const now = srv.clock.now();
  const { id: betId } = await g.c[by].ok('POST', `/api/groups/${g.gid}/bets`, {
    question, category, kind, options, closesAt: now + closesIn,
    expectedAt: expectedIn ? now + expectedIn : undefined,
    arbiterId: arbiter ? g.id[arbiter] : undefined,
  });
  const { bet } = await g.c[by].ok('GET', `/api/groups/${g.gid}/bets/${betId}`);
  return { betId, opt: Object.fromEntries(bet.options.map((o) => [o.label, o.id])) };
}

export const betUrl = (g, betId, action = '') => `/api/groups/${g.gid}/bets/${betId}${action ? `/${action}` : ''}`;
