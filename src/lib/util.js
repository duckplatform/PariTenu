import crypto from 'node:crypto';

export const newId = () => crypto.randomBytes(8).toString('hex');

/** Jeton aléatoire en base64url (16 octets = 128 bits par défaut). */
export const newToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const MINUTE = 60_000;
