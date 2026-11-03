// Images des sources (logos d'équipes, drapeaux, photos de pilotes), servies par l'app sous /media/… : les navigateurs
// des joueurs n'appellent jamais ESPN ou MotoGP.com, la CSP reste « img-src 'self' », et les photos trop lourdes sont
// réduites une fois pour toutes (gardées en mémoire et sur disque, à côté de la base).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng, isPng, pngSize, resize } from '../lib/png.js';
import { DAY } from '../lib/util.js';

// Seules ces adresses passent : pas de relais ouvert. face : photo en pied recadrée sur le visage (haut, 40 % de large).
const ALLOWED = [
  { host: 'a.espncdn.com', path: /^\/(combiner\/i$|i\/[\w./-]+\.png$)/ },
  { host: 'photos.motogp.com', path: /^\/riders\/[\w./-]+\.png$/, face: 0.4 },
  { host: 'media.formula1.com', path: /^\/[\w./-]+\.(png|jpg)$/ },
];
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 8 * 1024 * 1024;
const SMALL = 120 * 1024; // en dessous, l'image est servie telle quelle
const SIDE = 160; // côté des images réduites
const MEMORY_BYTES = 24 * 1024 * 1024;

function ruleFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return ALLOWED.find((r) => r.host === u.hostname && r.path.test(u.pathname)) ?? null;
}

/** Adresse locale (/media/…) d'une image de source, ou null si elle ne vient pas d'un fournisseur connu. */
export const mediaUrl = (url) => (typeof url === 'string' && ruleFor(url) ? `/media/${Buffer.from(url).toString('base64url')}` : null);

/** Une photo trop lourde : recadrée (visage) et réduite à SIDE pixels au plus ; null si on ne sait pas la lire. */
function shrink(body, rule) {
  let img;
  try { img = decodePng(body); } catch { return null; }
  if (rule.face) {
    const side = Math.round(img.width * rule.face);
    return encodePng(resize(img, SIDE, SIDE, { x: Math.round((img.width - side) / 2), y: 0, width: side, height: Math.min(side, img.height) }));
  }
  const scale = Math.min(1, SIDE / Math.max(img.width, img.height));
  return encodePng(resize(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale))));
}

export class MediaService {
  /** dir : dossier du cache sur disque (null : mémoire seulement, pour les tests). */
  constructor({ fetch = globalThis.fetch, clock, dir = null, logger }) {
    this.fetch = fetch;
    this.clock = clock;
    this.dir = dir;
    this.logger = logger ?? { warn() {} };
    this.memory = new Map(); // url → { type, body }
    this.bytes = 0;
    this.missing = new Map(); // url → date de l'échec (on ne réessaie pas avant un jour)
    this.pending = new Map();
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  /** L'image d'un identifiant /media/<id> : { type, body }, ou null (inconnue, introuvable chez la source). */
  async get(id) {
    let url;
    try { url = Buffer.from(String(id), 'base64url').toString('utf8'); } catch { return null; }
    const rule = ruleFor(url);
    if (!rule || mediaUrl(url) !== `/media/${id}`) return null;
    const hit = this.memory.get(url);
    if (hit) return hit;
    const failed = this.missing.get(url);
    if (failed && this.clock.now() - failed < DAY) return null;
    if (!this.pending.has(url)) this.pending.set(url, this.#load(url, rule).finally(() => this.pending.delete(url)));
    return this.pending.get(url);
  }

  #file(url) {
    return this.dir ? path.join(this.dir, crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)) : null;
  }

  #keep(url, image) {
    if (this.bytes + image.body.length > MEMORY_BYTES) {
      this.memory.clear();
      this.bytes = 0;
    }
    this.memory.set(url, image);
    this.bytes += image.body.length;
    return image;
  }

  async #load(url, rule) {
    const file = this.#file(url);
    for (const ext of file ? Object.values(TYPES) : []) {
      try {
        const body = fs.readFileSync(`${file}.${ext}`);
        return this.#keep(url, { type: Object.keys(TYPES).find((t) => TYPES[t] === ext), body });
      } catch { /* pas encore sur le disque */ }
    }
    const image = await this.#download(url, rule);
    if (!image) {
      this.missing.set(url, this.clock.now());
      return null;
    }
    if (file) {
      try { fs.writeFileSync(`${file}.${TYPES[image.type]}`, image.body); } catch (err) { this.logger.warn({ err: err.message }, 'Image : écriture du cache impossible'); }
    }
    return this.#keep(url, image);
  }

  async #download(url, rule) {
    let res;
    try {
      res = await this.fetch(url, { headers: { 'user-agent': 'PariTenu/1.0 (paris gratuits entre amis)' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      return null;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !TYPES[type] || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return null;
    const big = body.length > SMALL || (pngSize(body)?.width ?? 0) > 2 * SIDE;
    if (!big) return { type, body };
    // Trop lourde : réduite si c'est un PNG qu'on sait lire, sinon refusée (les joueurs sont souvent en 4G).
    const small = type === 'image/png' && isPng(body) ? shrink(body, rule) : null;
    return small ? { type: 'image/png', body: small } : null;
  }
}
