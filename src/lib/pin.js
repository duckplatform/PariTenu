import crypto from 'node:crypto';
import { promisify } from 'node:util';

const argon2 = promisify(crypto.argon2);

// Argon2id au niveau de base OWASP (19 MiB, 2 passes). Un PIN à 4 chiffres reste devinable en
// quelques milliers d'essais : la vraie protection est le blocage après 5 erreurs et le lien secret.
export const PIN_PARAMS = Object.freeze({ memory: 19_456, passes: 2 });

export const PIN_PATTERN = /^\d{4}$/;

export async function hashPin(pin, params = PIN_PARAMS) {
  const salt = crypto.randomBytes(16);
  const tag = await argon2('argon2id', {
    message: pin, nonce: salt, memory: params.memory, passes: params.passes, parallelism: 1, tagLength: 32,
  });
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=1$${salt.toString('base64url')}$${tag.toString('base64url')}`;
}

export async function verifyPin(pin, stored) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=1\$([\w-]+)\$([\w-]+)$/.exec(stored ?? '');
  if (!m) return false;
  const expected = Buffer.from(m[4], 'base64url');
  const tag = await argon2('argon2id', {
    message: pin, nonce: Buffer.from(m[3], 'base64url'), memory: +m[1], passes: +m[2], parallelism: 1, tagLength: expected.length,
  });
  return crypto.timingSafeEqual(tag, expected);
}
