import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { hashPin, verifyPin } from '../src/lib/pin.js';

const LIGHT = { cost: 2 ** 10, blockSize: 8, parallelization: 1 };

// Le Node de cPanel n'a pas Argon2 (OpenSSL du système trop ancien) : les nouveaux hachages n'en dépendent pas.
function argon2Supported() {
  try {
    crypto.argon2Sync('argon2id', { message: 'x', nonce: Buffer.alloc(16), memory: 8, passes: 1, parallelism: 1, tagLength: 32 });
    return true;
  } catch {
    return false;
  }
}

describe('hachage des PIN et du mot de passe admin', () => {
  it('scrypt : le bon PIN passe, un autre non', async () => {
    const hash = await hashPin('1234', LIGHT);
    assert.match(hash, /^\$scrypt\$ln=10,r=8,p=1\$/);
    assert.equal(await verifyPin('1234', hash), true);
    assert.equal(await verifyPin('1235', hash), false);
  });

  it('les réglages sont lus dans le hachage (le défaut reste vérifiable)', async () => {
    const hash = await hashPin('mot de passe admin');
    assert.match(hash, /^\$scrypt\$ln=14,r=8,p=5\$/);
    assert.equal(await verifyPin('mot de passe admin', hash), true);
  });

  it('un hachage inconnu ou absent ne passe pas', async () => {
    assert.equal(await verifyPin('1234', null), false);
    assert.equal(await verifyPin('1234', '$bcrypt$x'), false);
  });

  it('les hachages Argon2id d’avant restent acceptés', { skip: !argon2Supported() && 'Node sans Argon2' }, async () => {
    const salt = crypto.randomBytes(16);
    const tag = crypto.argon2Sync('argon2id', { message: '1234', nonce: salt, memory: 1024, passes: 1, parallelism: 1, tagLength: 32 });
    const legacy = `$argon2id$v=19$m=1024,t=1,p=1$${salt.toString('base64url')}$${tag.toString('base64url')}`;
    assert.equal(await verifyPin('1234', legacy), true);
    assert.equal(await verifyPin('4321', legacy), false);
  });
});
