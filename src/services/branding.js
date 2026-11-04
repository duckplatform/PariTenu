// L'identité de l'installation : son nom, son adresse publique, les textes de sa page d'accueil, son hébergeur et son
// icône. PariTenu est un logiciel libre : chaque installation se donne son nom et son allure depuis l'admin du site
// (page Configuration), sans toucher au code. Rangée dans instance_settings (clé « branding », JSON) ; l'icône
// téléversée, déclinée dans ses tailles, dans data/branding/ (en mémoire pour une base en mémoire, dans les tests).
import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../lib/errors.js';
import { decodePng, encodePng, isPng, resize } from '../lib/png.js';
import { VERSION } from '../version.js';

/** Les valeurs d'une installation neuve : celles de PariTenu. */
export const DEFAULT_BRANDING = Object.freeze({
  name: 'Pari tenu !',
  shortName: 'Pari tenu',
  publicUrl: '', // vide : les liens prennent l'adresse de la page
  tagline: 'Pronostique. Chambre tes potes. Sans miser un centime.',
  intro: 'Le jeu de pronostics entre amis : foot, rugby, NBA, F1, tennis… et tous vos paris maison. Les bons pronos rapportent des points, le meilleur de la saison est sacré champion.',
  footerNote: '',
  hostName: '',
  hostUrl: '',
});
const FIELDS = Object.keys(DEFAULT_BRANDING);
// Pour le journal de l'admin : le nom de chaque réglage, et ceux qu'on y recopie en entier (les textes longs non).
const LABELS = {
  name: 'Nom', shortName: 'Nom court', publicUrl: 'Adresse publique', tagline: 'Accroche', intro: 'Présentation',
  footerNote: 'Note de pied de page', hostName: 'Hébergeur', hostUrl: 'Adresse de l’hébergeur',
};
const QUOTED = new Set(['name', 'shortName', 'publicUrl', 'hostName', 'hostUrl']);

// L'icône : PNG carré, décliné pour l'onglet (32), l'écran d'accueil d'un iPhone (180), les applis (192, 512) et
// Android (« maskable » : l'icône à 80 % sur la couleur de son coin, que le téléphone peut rogner en rond).
export const ICON_MIN = 192;
export const ICON_MAX_BYTES = 2 * 1024 * 1024;
const SIZES = [32, 180, 192, 512];
const ICON_FILES = [...SIZES.map((s) => `icon-${s}.png`), 'icon-maskable-512.png'];

export class BrandingService {
  /** dir : dossier des icônes (null : en mémoire). */
  constructor(db, { dir = null } = {}) {
    this.db = db;
    this.dir = dir;
    this.memory = new Map();
    this.cached = null;
  }

  /** Les réglages complets (gardés en mémoire : la coquille de l'app les lit à chaque page). */
  get() {
    if (!this.cached) {
      let stored = {};
      try {
        stored = JSON.parse(this.db.prepare("SELECT value FROM instance_settings WHERE key = 'branding'").get()?.value ?? '{}');
      } catch { /* réglages illisibles : les valeurs par défaut */ }
      const known = Object.fromEntries(FIELDS.filter((f) => typeof stored[f] === 'string').map((f) => [f, stored[f]]));
      this.cached = { ...DEFAULT_BRANDING, ...known, icon: stored.icon?.version ? { version: stored.icon.version } : null };
    }
    return this.cached;
  }

  /** Ce que reçoivent les navigateurs (balise meta « instance », /api/instance) : rien n'y est secret. */
  public() {
    const b = this.get();
    return {
      ...Object.fromEntries(FIELDS.map((f) => [f, b[f]])),
      icon: this.iconUrl(192) ?? '/icons/icon.svg',
      // Renommée : la page d'accueil dit « Propulsé par PariTenu ».
      renamed: b.name !== DEFAULT_BRANDING.name,
      // La version du logiciel, en pied de page (public/js/brand.js : credits).
      version: VERSION,
    };
  }

  /** L'adresse d'une taille de l'icône téléversée (version comprise, pour vider les caches), sinon null. */
  iconUrl(size, maskable = false) {
    const icon = this.get().icon;
    return icon ? `/brand/icon-${maskable ? 'maskable-' : ''}${size}.png?v=${icon.version}` : null;
  }

  #save(next) {
    this.db.prepare(`INSERT INTO instance_settings (key, value) VALUES ('branding', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next));
    this.cached = null;
  }

  /**
   * Enregistre les champs donnés (déjà vérifiés) ; rend les changements pour le journal :
   * [{ field, label, text }] (« Nom : « Pari tenu ! » → « Les Pronos du Vendredi » »).
   */
  update(patch) {
    const current = this.get();
    const changes = FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== current[f]).map((f) => ({
      field: f,
      label: LABELS[f],
      text: QUOTED.has(f) ? `${LABELS[f]} : « ${current[f] || '—'} » → « ${patch[f] || '—'} »` : `${LABELS[f]} modifiée`,
    }));
    if (changes.length) this.#save({ ...current, ...Object.fromEntries(changes.map((c) => [c.field, patch[c.field]])) });
    return changes;
  }

  // ——— Icône

  #write(name, body) {
    if (!this.dir) return this.memory.set(name, body);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, name), body);
  }

  /** Un fichier de l'icône téléversée (« icon-192.png »…), ou null. */
  iconFile(name) {
    if (!this.get().icon || !ICON_FILES.includes(name)) return null;
    if (!this.dir) return this.memory.get(name) ?? null;
    try {
      return fs.readFileSync(path.join(this.dir, name));
    } catch {
      return null;
    }
  }

  /** Remplace l'icône : un PNG d'au moins 192 px de côté, recadré au carré par le centre. Rend sa version. */
  setIcon(body, now) {
    if (!isPng(body)) throw badRequest('L’icône doit être une image PNG.');
    if (body.length > ICON_MAX_BYTES) throw badRequest('L’image fait plus de 2 Mo : réduis-la avant de l’envoyer.');
    let img;
    try {
      img = decodePng(body);
    } catch {
      throw badRequest('Cette image PNG est illisible.');
    }
    const side = Math.min(img.width, img.height);
    if (side < ICON_MIN) throw badRequest(`L’image est trop petite : ${ICON_MIN} pixels de côté au moins (512 conseillés).`);
    const square = resize(img, Math.min(side, 512), Math.min(side, 512),
      { x: Math.floor((img.width - side) / 2), y: Math.floor((img.height - side) / 2), width: side, height: side });
    for (const s of SIZES) this.#write(`icon-${s}.png`, encodePng(resize(square, s, s)));
    this.#write('icon-maskable-512.png', encodePng(maskable(square)));
    const current = this.get();
    this.#save({ ...current, icon: { version: now } });
    return now;
  }

  /** Revient à l'icône de PariTenu. */
  resetIcon() {
    const current = this.get();
    if (!current.icon) return false;
    for (const name of ICON_FILES) {
      if (!this.dir) this.memory.delete(name);
      else fs.rmSync(path.join(this.dir, name), { force: true });
    }
    this.#save({ ...current, icon: null });
    return true;
  }
}

/** Icône « maskable » (Android) : l'icône à 80 %, centrée sur un carré 512 de la couleur de son coin haut gauche. */
function maskable(square) {
  const SIDE = 512;
  const inner = Math.round(SIDE * 0.8);
  const small = resize(square, inner, inner);
  const out = Buffer.alloc(SIDE * SIDE * 4);
  const [r, g, b, a] = square.data.subarray(0, 4);
  const fill = a < 128 ? [255, 255, 255] : [r, g, b];
  for (let i = 0; i < SIDE * SIDE; i++) out.set([...fill, 255], i * 4);
  const offset = Math.floor((SIDE - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const alpha = small.data[s + 3] / 255;
      const d = ((y + offset) * SIDE + x + offset) * 4;
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(small.data[s + c] * alpha + out[d + c] * (1 - alpha));
    }
  }
  return { width: SIDE, height: SIDE, data: out };
}
