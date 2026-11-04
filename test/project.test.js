// Les fichiers du projet : une seule version partout (package.json fait foi), un .env.example complet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { VERSION } from '../src/version.js';
import { startServer } from './helpers.js';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(read(name));

describe('version', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.stop());

  it('package.json fait foi : version sémantique, recopiée dans le lock, le manifeste et le CHANGELOG', () => {
    const { version } = json('package.json');
    assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'versionnage sémantique');
    assert.equal(VERSION, version);
    const lock = json('package-lock.json');
    assert.equal(lock.version, version, 'package-lock.json');
    assert.equal(lock.packages[''].version, version, 'package-lock.json (packages[""])');
    assert.equal(json('public/manifest.webmanifest').version, version, 'public/manifest.webmanifest');
    // La dernière version publiée du CHANGELOG, juste sous « [Non publié] ».
    const released = read('CHANGELOG.md').match(/^## \[(\d[^\]]*)\] - (\d{4}-\d{2}-\d{2})$/m);
    assert.ok(released, 'CHANGELOG.md : une section « ## [x.y.z] - AAAA-MM-JJ »');
    assert.equal(released[1], version, 'CHANGELOG.md : la dernière version publiée');
    assert.match(read('CHANGELOG.md'), /^## \[Non publié\]$/m, 'CHANGELOG.md : la section des changements à venir');
  });

  it('les navigateurs la reçoivent : page, /api/instance et manifeste servi', async () => {
    const { brand } = await srv.client().ok('GET', '/api/instance');
    assert.equal(brand.version, VERSION);
    const html = await (await fetch(`${srv.base}/`)).text();
    assert.ok(html.includes(`&quot;version&quot;:&quot;${VERSION}&quot;`), 'dans <meta name="instance">');
    const manifest = await (await fetch(`${srv.base}/manifest.webmanifest`)).json();
    assert.equal(manifest.version, VERSION);
  });
});

describe('.env.example', () => {
  it('décrit chaque variable lue par src/config.js (sauf le crochet de test)', () => {
    const used = new Set([...read('src/config.js').matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
    const example = read('.env.example');
    const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    for (const name of used) {
      if (name === 'PT_TEST_HOOKS' || name === 'NODE_ENV') continue;
      assert.ok(listed.has(name), `${name} manque dans .env.example`);
    }
    assert.ok(!listed.has('PT_TEST_HOOKS'), 'PT_TEST_HOOKS (déplace l’horloge) ne doit pas être proposé');
  });

  it('se lit tel quel : les valeurs proposées sont celles par défaut', async () => {
    const { buildConfig } = await import('../src/config.js');
    const env = {};
    for (const line of read('.env.example').split('\n')) {
      const m = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
    const fromExample = buildConfig(env);
    const defaults = buildConfig({});
    for (const key of ['port', 'host', 'dbPath', 'cookieSecure', 'trustProxy', 'sourceKeys']) {
      assert.deepEqual(fromExample[key], defaults[key], key);
    }
  });
});
