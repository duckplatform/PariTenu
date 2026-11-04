import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
// crypto.argon2 demande un Node compilé avec OpenSSL 3.2 ou plus : un Node lié à l'OpenSSL d'un système plus ancien
// (fréquent chez les hébergeurs) ne l'a pas (ERR_CRYPTO_ARGON2_NOT_SUPPORTED). Il ne sert plus qu'à relire les hachages Argon2id d'avant.
const argon2 = promisify(crypto.argon2);

// scrypt au niveau de base OWASP (N = 2^14, r = 8, p = 5 : 16 MiB). Un PIN à 4 chiffres reste devinable en
// quelques milliers d'essais : la vraie protection est le blocage après 5 erreurs et le lien secret.
export const PIN_PARAMS = Object.freeze({ cost: 2 ** 14, blockSize: 8, parallelization: 5 });

export const PIN_PATTERN = /^\d{4}$/;

// La mémoire demandée est 128 × N × r octets : on en autorise le double (le plafond par défaut, 32 MiB, bloquerait N = 2^15).
const derive = (pin, salt, length, { cost, blockSize, parallelization }) =>
  scrypt(pin, salt, length, { cost, blockSize, parallelization, maxmem: 256 * cost * blockSize });

export async function hashPin(pin, params = PIN_PARAMS) {
  const salt = crypto.randomBytes(16);
  const key = await derive(pin, salt, 32, params);
  return `$scrypt$ln=${Math.log2(params.cost)},r=${params.blockSize},p=${params.parallelization}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPin(pin, stored) {
  const s = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored ?? '');
  if (s) {
    const expected = Buffer.from(s[5], 'base64url');
    const key = await derive(pin, Buffer.from(s[4], 'base64url'), expected.length, { cost: 2 ** +s[1], blockSize: +s[2], parallelization: +s[3] });
    return crypto.timingSafeEqual(key, expected);
  }
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=1\$([\w-]+)\$([\w-]+)$/.exec(stored ?? '');
  if (!m) return false;
  const expected = Buffer.from(m[4], 'base64url');
  const tag = await argon2('argon2id', {
    message: pin, nonce: Buffer.from(m[3], 'base64url'), memory: +m[1], passes: +m[2], parallelism: 1, tagLength: expected.length,
  });
  return crypto.timingSafeEqual(tag, expected);
}
