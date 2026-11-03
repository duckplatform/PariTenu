import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { PIN_PATTERN } from '../lib/pin.js';

// ——— Schémas des entrées communs au site et à l'admin (messages affichés tels quels dans l'interface)

export const pin = z.string().regex(PIN_PATTERN, 'Le PIN fait 4 chiffres.');
export const pseudo = z.string().trim().min(2, 'Ton pseudo fait au moins 2 caractères.').max(20, 'Ton pseudo fait au plus 20 caractères.');
export const emoji = z.string().trim().min(1, 'Choisis un emoji.').max(16, 'Choisis un seul emoji.');
// Avatar : un emoji, un drapeau « f:fr » ou un maillot « j:<couleur>:<couleur>:<numéro> » (numéro à deux chiffres au plus).
export const avatar = emoji.refine((v) => !v.startsWith('j:') || /^j:(\d|1[01]):(\d|1[01]):\d{1,2}$/.test(v), 'Le numéro du maillot fait deux chiffres au plus.');
export const groupName = z.string().trim().min(2, 'Le nom du groupe fait au moins 2 caractères.').max(40, 'Le nom du groupe fait au plus 40 caractères.');
export const id = z.string().min(1).max(40);

/** Réglages d'un groupe (core/settings.js), envoyés par un admin du groupe ou l'admin du site : seuls les champs changés. */
export const Settings = z.object({
  basePoints: z.number().int().min(10, 'Entre 10 et 1000 points.').max(1000, 'Entre 10 et 1000 points.'),
  oddsCap: z.number().min(1.5, 'Plafond entre ×1,5 et ×100.').max(100, 'Plafond entre ×1,5 et ×100.').nullable(),
  arbiterBonus: z.number().int().min(0, 'Prime entre 0 et 500 points.').max(500, 'Prime entre 0 et 500 points.'),
  validationHours: z.number().int().min(1, 'Délai entre 1 et 168 heures.').max(168, 'Délai entre 1 et 168 heures.'),
  voteHours: z.number().int().min(1, 'Délai entre 1 et 168 heures.').max(168, 'Délai entre 1 et 168 heures.'),
  comments: z.boolean(),
  categories: z.array(z.object({
    id: z.string().max(40).optional(),
    emoji,
    label: z.string().trim().min(2, 'Une catégorie fait au moins 2 caractères.').max(30, 'Une catégorie fait au plus 30 caractères.'),
    hidden: z.boolean().optional(),
  })).min(1).max(30),
  kinds: z.object({ yesno: z.boolean(), multi: z.boolean() }).partial(),
  sources: z.record(z.string().max(20), z.object({
    competitions: z.array(z.string().max(40)).max(60),
    params: z.record(z.string(), z.unknown()).optional(),
  })),
}).partial();

const httpsUrl = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
const isOrigin = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username;
  } catch {
    return false;
  }
};
const text = (max, what) => z.string().trim().max(max, `${what} fait au plus ${max} caractères.`);

/** Identité de l'installation (services/branding.js), réglée par l'admin du site : seuls les champs changés. */
export const Branding = z.object({
  name: z.string().trim().min(2, 'Le nom fait au moins 2 caractères.').max(40, 'Le nom fait au plus 40 caractères.'),
  shortName: z.string().trim().min(1, 'Donne un nom court (sous l’icône du téléphone).').max(14, 'Le nom court fait au plus 14 caractères (il doit tenir sous l’icône).'),
  // Une origine https (sans chemin) : les liens d'invitation, de coupon et de partage la prennent.
  publicUrl: z.string().trim().max(200).refine((v) => v === '' || isOrigin(v), 'L’adresse publique commence par https:// et s’arrête au nom de domaine (ex. https://paris.example.fr).')
    .transform((v) => (v ? new URL(v).origin : '')),
  tagline: text(120, 'L’accroche'),
  intro: text(400, 'La présentation'),
  footerNote: text(200, 'La note de pied de page'),
  hostName: text(60, 'Le nom de l’hébergeur'),
  hostUrl: z.string().trim().max(200).refine((v) => v === '' || httpsUrl(v), 'L’adresse de l’hébergeur commence par https://.'),
}).partial();

// Ville de la météo : recherche par nom.
export const PlaceQuery = z.object({ q: z.string().trim().min(2, 'Tape au moins 2 lettres.').max(60, '60 caractères maximum.') });

export function parse(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    // Nos messages sont en français ; ceux de zod par défaut (en anglais) deviennent un message générique.
    const message = result.error.issues[0]?.message ?? '';
    throw badRequest(!message || /^(Invalid|Too (small|big)|Expected|Unrecognized|Required)/.test(message) ? 'Données invalides.' : message);
  }
  return result.data;
}

export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
