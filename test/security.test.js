import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { createClock } from '../src/lib/clock.js';
import { coupon, DAY, makeConfig, PIN, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

describe('en-têtes et garde-fous HTTP', () => {
  it('CSP stricte sur les pages, pas de cache sur l’API', async () => {
    const page = await srv.client().req('GET', '/', { raw: true });
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/, 'casserait l’app en http sur le réseau local');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-powered-by'), null);
    const api = await srv.client().req('GET', '/api/instance', { raw: true });
    assert.equal(api.headers.get('cache-control'), 'no-store');
  });

  it('un ancien lien d’invitation sert l’app (qui dit qu’il a expiré), le manifeste a le bon type', async () => {
    const c = srv.client();
    const invite = await c.req('GET', '/g/nimportequoi', { raw: true });
    assert.equal(invite.status, 200);
    assert.match(await invite.text(), /<div id="app"/);
    const manifest = await c.req('GET', '/manifest.webmanifest', { raw: true });
    assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
    assert.equal((await c.req('GET', '/sw.js', { raw: true })).status, 200);
    assert.equal((await c.req('GET', '/icons/icon-192.png', { raw: true })).status, 200);
    assert.equal((await c.req('GET', '/nexiste/pas', { raw: true })).status, 404);
  });

  it('moteurs de recherche : seul l’accueil est indexable ; groupes, invitations, admin, API et le reste en noindex', async () => {
    const g = await setupGroup(srv, []);
    const robots = async (url) => (await fetch(srv.base + url, { redirect: 'manual' })).headers.get('x-robots-tag');
    assert.equal(await robots('/'), null, 'l’accueil reste indexable');
    for (const url of ['/groups', '/groups/new', '/groups/new/ABCD', '/help', '/invite/abc', '/g/abc', `/${g.gid}`, `/${g.gid}/bet/x`,
      '/admin', '/admin/users', '/api/instance', `/api/groups/${g.token}/entry`, '/css/app.css', '/icons/icon-192.png', '/manifest.webmanifest', '/nexiste/pas']) {
      assert.equal(await robots(url), 'noindex, nofollow', url);
    }
    const res = await fetch(`${srv.base}/robots.txt`);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    const lines = (await res.text()).split('\n');
    for (const rule of ['User-agent: *', 'Allow: /$', 'Allow: /css/', 'Allow: /js/', 'Disallow: /']) assert.ok(lines.includes(rule), rule);
    assert.ok(!lines.some((l) => /^Allow: \/(groups|invite|help|admin|g\/|api\/invite)/.test(l)), 'rien de privé n’est permis');
  });

  it('les adresses de l’app et de l’admin (en anglais, sans #) servent la coquille ; les anciennes redirigent', async () => {
    const g = await setupGroup(srv, []);
    for (const url of ['/', '/groups', '/groups/new', '/groups/new/ABCD-EFGH-JKMN', '/help', '/help/points', '/invite/abc',
      `/${g.gid}`, `/${g.gid}/bet/abc`, `/${g.gid}/rank/espn%3Afra.1/2026`, `/${g.gid}/members/abc`]) {
      const res = await fetch(srv.base + url, { redirect: 'manual' });
      assert.equal(res.status, 200, url);
      assert.match(await res.text(), /<div id="app"/, url);
    }
    for (const url of ['/admin', '/admin/users', '/admin/users/abc', '/admin/groups/abc/edit', '/admin/configuration', '/admin/log']) {
      const res = await fetch(srv.base + url, { redirect: 'manual' });
      assert.deepEqual([res.status, res.headers.get('cache-control'), res.headers.get('x-robots-tag')], [200, 'no-store', 'noindex, nofollow'], url);
      assert.match(await res.text(), /\/js\/admin\/main\.js/, url);
    }
    // Les liens déjà partagés (coupon, aide ; une ancienne invitation : la page qui dit qu'elle a expiré).
    for (const [url, to] of [['/c/ABCD-EFGH-JKMN', '/groups/new/ABCD-EFGH-JKMN'], ['/g/abc', '/invite/abc'],
      ['/g/abc?pari=x1', '/invite/abc'], ['/aide', '/help'], ['/aide/points', '/help/points']]) {
      const res = await fetch(srv.base + url, { redirect: 'manual' });
      assert.deepEqual([res.status, res.headers.get('location')], [302, to], url);
    }
    // Seul un identifiant de groupe (16 caractères hexadécimaux) ouvre une page de groupe ; le reste reste introuvable.
    for (const url of ['/xyz', `/${g.gid.slice(1)}`, '/groups/new/a/b', '/api.js', '/adminx']) {
      assert.equal((await fetch(srv.base + url, { redirect: 'manual' })).status, 404, url);
    }
  });

  it('CSRF : écriture refusée sans JSON ou depuis un autre site', async () => {
    const g = await setupGroup(srv, ['max']);
    const form = await g.c.max.req('POST', `/api/groups/${g.gid}/bets`, { body: 'question=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const foreign = await g.c.max.req('POST', `/api/groups/${g.gid}/me/leave`, { body: {}, headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    // Derrière Tailscale Funnel : l'origine publique correspond au X-Forwarded-Host posé par le relais local.
    const relayed = await g.c.max.req('PATCH', '/api/account', {
      body: { avatar: '🐙' }, headers: { origin: 'https://pc.tailnet.ts.net:8443', 'x-forwarded-host': 'pc.tailnet.ts.net:8443' },
    });
    assert.equal(relayed.status, 200);
    const spoofed = await g.c.max.req('PATCH', '/api/account', {
      body: { avatar: '🐙' }, headers: { origin: 'https://evil.example', 'x-forwarded-host': 'pc.tailnet.ts.net:8443' },
    });
    assert.equal(spoofed.status, 403);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 200, 'toujours membre');
  });

  it('JSON illisible ou trop gros : erreurs propres', async () => {
    const c = srv.client();
    const bad = await c.req('POST', '/api/groups', { body: '{pas du json' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'bad_json');
    const big = await c.req('POST', '/api/groups', { body: JSON.stringify({ name: 'x'.repeat(40_000) }) });
    assert.equal(big.status, 413);
  });

  it('sans session : 401 partout dans le groupe ; groupe inconnu : 404', async () => {
    const g = await setupGroup(srv, []);
    const anon = srv.client();
    for (const path of ['', '/bets', '/rankings', '/feed', `/members/${g.id.lea}`, '/export']) {
      assert.equal((await anon.get(`/api/groups/${g.gid}${path}`)).status, 401, path);
    }
    assert.equal((await anon.get('/api/groups/inconnu/bets')).status, 404);
    assert.equal((await anon.get('/api/groups/inconnu/entry')).body.code, 'group_not_found');
    assert.equal((await anon.get('/api/invite/inconnu')).status, 404, 'plus d’API d’invitation');
  });

  it('un pari d’un autre groupe est introuvable', async () => {
    const a = await setupGroup(srv, []);
    const b = await setupGroup(srv, []);
    const { id } = await a.c.lea.ok('POST', `/api/groups/${a.gid}/bets`, { question: 'Secret du groupe A ?', category: 'groupe', kind: 'yesno', closesAt: srv.clock.now() + 3_600_000 });
    assert.equal((await b.c.lea.get(`/api/groups/${b.gid}/bets/${id}`)).status, 404);
  });

  it('le texte des joueurs est stocké tel quel (l’interface l’affiche sans jamais l’interpréter)', async () => {
    const g = await setupGroup(srv, []);
    const question = '<img src=x onerror=alert(1)> arrive ?';
    const { id } = await g.c.lea.ok('POST', `/api/groups/${g.gid}/bets`, { question, category: 'groupe', kind: 'yesno', closesAt: srv.clock.now() + 3_600_000 });
    assert.equal((await g.c.lea.ok('GET', `/api/groups/${g.gid}/bets/${id}`)).bet.question, question);
  });
});

describe('coupons de création de groupe et limitation des essais', () => {
  const body = (pseudo) => ({ name: 'Les Potes', emoji: '🍻', pseudo, avatar: '🦊', pin: PIN });
  const exists = (pseudo) => srv.deps.accounts.byPseudo(pseudo) != null;

  it('créer un groupe (et son compte) demande un coupon, qui ne sert qu’une fois', async () => {
    const c = srv.client();
    let r = await c.post('/api/groups', body('Coupon'));
    assert.deepEqual([r.status, r.body.code], [400, 'coupon_required']);
    r = await c.post('/api/groups', { ...body('Coupon'), coupon: 'AAAA-BBBB-CCCC' });
    assert.deepEqual([r.status, r.body.code], [403, 'coupon_invalid']);
    assert.equal(exists('Coupon'), false, 'refusé : aucun compte créé');
    const code = coupon(srv);
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/, 'sans 0, O, 1 ni I');
    // Recopié à la main, en minuscules et sans tirets : il marche quand même.
    assert.equal((await c.post('/api/groups', { ...body('Coupon'), coupon: code.toLowerCase().replaceAll('-', ' ') })).status, 201);
    // Déjà servi, même pour un compte connecté.
    r = await c.post('/api/groups', { name: 'Le Foot du jeudi', emoji: '⚽', coupon: code });
    assert.deepEqual([r.status, r.body.code], [403, 'coupon_used']);
    r = await srv.client().post('/api/groups', { ...body('Coupon bis'), coupon: code });
    assert.equal(r.body.code, 'coupon_used');
    assert.equal(exists('Coupon bis'), false, 'coupon déjà servi : pas de compte créé');
    // Connecté : un nouveau coupon, un nom et un emoji suffisent.
    assert.equal((await c.post('/api/groups', { name: 'Le Foot du jeudi', emoji: '⚽', coupon: coupon(srv) })).status, 201);
    assert.deepEqual((await c.ok('GET', '/api/account')).groups.map((g) => [g.name, g.role]), [['Les Potes', 'admin'], ['Le Foot du jeudi', 'admin']]);
    assert.equal((await c.ok('GET', '/api/instance')).trusted, undefined, 'plus de passe-droit « déjà membre »');
  });

  it('deux créations en même temps avec le même coupon : une seule passe', async () => {
    const code = coupon(srv);
    const statuses = (await Promise.all(['Course 1', 'Course 2'].map((p) => srv.client().post('/api/groups', { ...body(p), coupon: code }))))
      .map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 403]);
  });

  it('coupon annulé ou expiré : refusé ; sans date limite, il attend', async () => {
    const revoked = srv.deps.coupons.create({ days: 30 });
    srv.deps.coupons.revoke(revoked.id);
    assert.equal((await srv.client().post('/api/groups', { ...body('Annulé'), coupon: revoked.code })).body.code, 'coupon_revoked');
    const week = srv.deps.coupons.create({ days: 7 });
    const forever = srv.deps.coupons.create({ days: null });
    srv.clock.advance(8 * DAY);
    assert.equal((await srv.client().post('/api/groups', { ...body('Expiré'), coupon: week.code })).body.code, 'coupon_expired');
    assert.equal((await srv.client().post('/api/groups', { ...body('Patient'), coupon: forever.code })).status, 201);
  });

  it('trop de tentatives de connexion depuis la même adresse : 429', async () => {
    const config = { ...makeConfig(), authRateLimit: 3 };
    const instance = createApp(config, { clock: createClock() });
    const server = await new Promise((r) => { const s = instance.app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/account/login`;
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pseudo: 'Personne', pin: '0000', group: 'lien-inconnu' }) });
        statuses.push(res.status);
      }
      assert.deepEqual(statuses, [404, 404, 404, 429, 429]);
    } finally {
      await new Promise((r) => server.close(r));
      instance.close();
    }
  });

  it('cookie Secure derrière Tailscale Funnel (*.ts.net) et en mode always', async () => {
    const s = await startServer({ PT_COOKIE_SECURE: 'always' });
    try {
      const c = s.client();
      await c.post('/api/groups', { name: 'Les Potes', emoji: '🍻', pseudo: 'Léa', avatar: '🦊', pin: PIN, coupon: coupon(s) });
      assert.match(c.setCookies[0], /Secure/);
    } finally {
      await s.stop();
    }
    const funnel = srv.client();
    // Tailscale Funnel relaie depuis 127.0.0.1 (proxy de confiance) avec le nom public de la machine.
    await funnel.post('/api/groups', { name: 'Les Potes', emoji: '🍻', pseudo: 'Funnel', avatar: '🦊', pin: PIN, coupon: coupon(srv) }, { headers: { 'x-forwarded-host': 'mon-pc.tailnet.ts.net' } });
    assert.match(funnel.setCookies[0], /Secure/);
  });
});
