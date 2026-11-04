// Admin de l'instance (/admin) : mot de passe choisi sur le serveur, sessions courtes, comptes, groupes, coupons, journal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { decodePng, encodePng, pngSize } from '../src/lib/png.js';
import { betUrl, coupon, createBet, HOUR, MINUTE, joinCompetitions, PIN, setupGroup, startServer } from './helpers.js';

const PASSWORD = 'un mot de passe solide';
let srv;
before(async () => {
  srv = await startServer();
  await srv.deps.admin.setPassword(PASSWORD);
});
after(() => srv.stop());

async function fresh(fn) {
  const s = await startServer();
  try {
    await fn(s);
  } finally {
    await s.stop();
  }
}

/** Un navigateur connecté à l'admin. */
async function signIn(s = srv) {
  const c = s.client();
  await c.ok('POST', '/api/admin/login', { password: PASSWORD });
  return c;
}

describe('accès à l’admin', () => {
  it('sans mot de passe choisi sur le serveur : rien ne s’ouvre, et il ne se choisit pas depuis le site', () => fresh(async (s) => {
    const c = s.client();
    assert.deepEqual(await c.ok('GET', '/api/admin/session'), { signedIn: false, hasPassword: false });
    const r = await c.post('/api/admin/login', { password: PASSWORD });
    assert.deepEqual([r.status, r.body.code], [409, 'no_password']);
    assert.equal((await c.get('/api/admin/overview')).status, 401);
    assert.equal((await c.post('/api/admin/password', { password: PASSWORD })).status, 401, 'aucune route pour le choisir');
    await assert.rejects(s.deps.admin.setPassword('trop court'), /12 caractères/);
  }));

  it('connexion : cookie HttpOnly, SameSite=Strict, réservé à /api/admin ; une session de joueur ne suffit pas', async () => {
    const g = await setupGroup(srv, []);
    assert.equal((await g.c.lea.get('/api/admin/overview')).status, 401, 'admin d’un groupe ≠ admin du site');
    const c = srv.client();
    assert.equal((await c.post('/api/admin/login', { password: 'pas le bon mot de passe' })).body.attemptsLeft, 4);
    await c.ok('POST', '/api/admin/login', { password: PASSWORD });
    const cookie = c.setCookies.find((x) => x.startsWith('pt_admin='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/admin/i);
    assert.deepEqual(await c.ok('GET', '/api/admin/session'), { signedIn: true, hasPassword: true });
    const page = await c.req('GET', '/admin', { raw: true });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('x-robots-tag'), /noindex/);
    assert.match(page.headers.get('cache-control'), /no-store/);
    // Depuis un autre site, même avec le cookie : refusé.
    assert.equal((await c.post('/api/admin/coupons', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
    await c.ok('POST', '/api/admin/logout');
    assert.equal((await c.get('/api/admin/overview')).status, 401);
  });

  it('5 mots de passe faux bloquent 15 min, puis deux fois plus ; « npm run admin » débloque', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const c = s.client();
    for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/admin/login', { password: `faux ${i}` })).status, 401);
    assert.equal((await c.post('/api/admin/login', { password: 'faux 4' })).status, 423);
    assert.equal((await c.post('/api/admin/login', { password: PASSWORD })).status, 423, 'même le bon attend');
    s.clock.advance(16 * MINUTE);
    for (let i = 0; i < 5; i++) await c.post('/api/admin/login', { password: `encore ${i}` });
    s.clock.advance(16 * MINUTE);
    assert.equal((await c.post('/api/admin/login', { password: PASSWORD })).status, 423, 'deuxième blocage : 30 min');
    await s.deps.admin.setPassword(PASSWORD);
    assert.equal((await c.post('/api/admin/login', { password: PASSWORD })).status, 200);
    const log = (await c.ok('GET', '/api/admin/log')).entries.map((e) => e.action);
    assert.ok(log.includes('login_failed') && log.includes('password_changed') && log.includes('login'));
  }));

  it('la session se ferme après 2 h sans activité, et 12 h après la connexion ; changer le mot de passe ferme tout', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    let c = await signIn(s);
    s.clock.advance(2 * HOUR + MINUTE);
    assert.equal((await c.get('/api/admin/overview')).status, 401, 'inactive depuis 2 h');
    c = await signIn(s);
    for (let i = 0; i < 6; i++) {
      s.clock.advance(HOUR + 50 * MINUTE);
      assert.equal((await c.get('/api/admin/overview')).status, 200);
    }
    s.clock.advance(HOUR);
    assert.equal((await c.get('/api/admin/overview')).status, 401, '12 h après la connexion');
    c = await signIn(s);
    await s.deps.admin.setPassword('un autre mot de passe');
    assert.equal((await c.get('/api/admin/overview')).status, 401);
  }));

  it('npm run admin choisit le mot de passe (deux fois, rien d’affiché)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paritenu-admin-'));
    try {
      const run = (input) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/admin.mjs'], {
        input, encoding: 'utf8', env: { ...process.env, PT_DB_PATH: path.join(dir, 'admin.db'), NODE_ENV: 'test' },
      });
      assert.equal(run('court\ncourt\n').status, 1);
      assert.equal(run(`${PASSWORD}\nautre chose\n`).status, 1, 'les deux diffèrent');
      const ok = run(`${PASSWORD}\n${PASSWORD}\n`);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /Mot de passe enregistré/);
      assert.ok(!ok.stdout.includes(PASSWORD), 'jamais affiché');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('coupons', () => {
  it('l’admin crée un coupon (montré une seule fois), suit son utilisation, peut l’annuler', async () => {
    const adm = await signIn();
    const created = await adm.ok('POST', '/api/admin/coupons', { note: 'Pour Julien', days: 7 });
    assert.match(created.code, /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$/);
    const spare = await adm.ok('POST', '/api/admin/coupons', { note: 'En trop', days: null });
    const find = async (id) => (await adm.ok('GET', '/api/admin/coupons')).coupons.find((c) => c.id === id);
    let c = await find(created.id);
    assert.deepEqual([c.state, c.note, c.hint, 'code' in c], ['available', 'Pour Julien', created.code.slice(-4), false]);

    const julien = srv.client();
    await julien.ok('POST', '/api/groups', { name: 'Chez Julien', emoji: '🔥', pseudo: 'Julien', avatar: '🐯', pin: PIN, coupon: created.code });
    c = await find(created.id);
    assert.deepEqual([c.state, c.usedByPseudo, c.groupName], ['used', 'Julien', 'Chez Julien']);
    assert.ok(c.groupId && c.usedBy && c.usedAt);
    const log = (await adm.ok('GET', '/api/admin/log')).entries;
    assert.match(log[0].summary, new RegExp(`Coupon …${created.code.slice(-4)} utilisé par « Julien » : groupe « Chez Julien » créé`));

    assert.equal((await adm.post(`/api/admin/coupons/${created.id}/revoke`)).status, 409, 'déjà servi : rien à annuler');
    await adm.ok('POST', `/api/admin/coupons/${spare.id}/revoke`);
    assert.equal((await find(spare.id)).state, 'revoked');
    assert.equal((await adm.post('/api/admin/coupons', { days: 12 })).status, 400, 'validité au choix : 7, 30, 90 jours ou sans limite');
  });
});

describe('comptes', () => {
  it('liste et fiche : groupes, rôle, appareils ; un compte bloqué se débloque', async () => {
    const g = await setupGroup(srv, ['max']);
    const adm = await signIn();
    const { players } = await adm.ok('GET', '/api/admin/players');
    const max = players.find((p) => p.pseudo === g.pseudo.max);
    assert.deepEqual([max.groups, max.state], [1, 'ok']);
    for (let i = 0; i < 5; i++) await srv.client().post('/api/account/login', { pseudo: g.pseudo.max, pin: '0000', group: g.token });
    let { player } = await adm.ok('GET', `/api/admin/players/${max.id}`);
    assert.equal(player.state, 'locked');
    assert.deepEqual(player.groups.map((x) => [x.id, x.role, x.status]), [[g.gid, 'member', 'active']]);
    assert.equal(player.devices, 1);
    await adm.ok('POST', `/api/admin/players/${max.id}/unlock`);
    assert.equal((await srv.client().post('/api/account/login', { pseudo: g.pseudo.max, pin: PIN, group: g.token })).status, 200);
    ({ player } = await adm.ok('GET', `/api/admin/players/${max.id}`));
    assert.deepEqual([player.state, player.devices], ['ok', 2]);
  });

  it('créé par l’admin dans un groupe, sans PIN : il le choisit depuis le lien du groupe', async () => {
    const g = await setupGroup(srv, []);
    const adm = await signIn();
    assert.equal((await adm.post('/api/admin/players', { pseudo: g.pseudo.lea, avatar: '🐺', groupId: g.gid })).status, 409, 'pseudo déjà pris');
    const { id } = await adm.ok('POST', '/api/admin/players', { pseudo: 'Nouvelle', avatar: '🐺', groupId: g.gid, role: 'admin' });
    const info = await srv.client().ok('GET', `/api/groups/${g.token}/entry`);
    assert.deepEqual(Object.keys(info).sort(), ['account', 'group', 'signedIn'], 'ni pseudos ni avatars des membres');
    const phone = srv.client();
    assert.equal((await phone.post('/api/account/login', { pseudo: 'Nouvelle', pin: '2580' })).body.code, 'group_link_required', 'sans le lien du groupe');
    assert.equal((await phone.post('/api/account/login', { pseudo: 'Nouvelle', pin: '2580', group: g.token })).body.code, 'choose_pin', 'son pseudo suffit pour qu’on lui demande de choisir son PIN');
    await phone.ok('POST', '/api/account/login', { pseudo: 'Nouvelle', pin: '2580', newPin: true, group: g.token });
    const { me } = await phone.ok('GET', `/api/groups/${g.gid}`);
    assert.deepEqual([me.pseudo, me.role], ['Nouvelle', 'admin']);
    assert.equal((await adm.ok('GET', `/api/admin/players/${id}`)).player.state, 'ok');
  });

  it('modifier, réinitialiser le PIN, déconnecter partout', async () => {
    const g = await setupGroup(srv, ['max']);
    const adm = await signIn();
    const maxId = (await adm.ok('GET', '/api/admin/players')).players.find((p) => p.pseudo === g.pseudo.max).id;
    await adm.ok('PATCH', `/api/admin/players/${maxId}`, { pseudo: 'Maxime', avatar: '🦁' });
    assert.equal((await g.c.lea.ok('GET', `/api/groups/${g.gid}`)).members.find((m) => m.id === g.id.max).pseudo, 'Maxime', 'renommé dans ses groupes');
    assert.deepEqual(await adm.ok('POST', `/api/admin/players/${maxId}/logout`), { devices: 1 });
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 401, 'déconnecté');
    await adm.ok('POST', `/api/admin/players/${maxId}/reset-pin`);
    assert.equal((await srv.client().post('/api/account/login', { pseudo: 'Maxime', pin: PIN, group: g.token })).body.code, 'choose_pin');
  });

  it('supprimer un compte : il quitte ses groupes (anonymisé, historique gardé), il faut retaper son pseudo', async () => {
    const g = await setupGroup(srv, ['max']);
    const { betId, opt } = await createBet(srv, g, { closesIn: HOUR });
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Oui });
    const adm = await signIn();
    const maxId = (await adm.ok('GET', '/api/admin/players')).players.find((p) => p.pseudo === g.pseudo.max).id;
    assert.equal((await adm.req('DELETE', `/api/admin/players/${maxId}`, { body: { confirm: 'Pas lui' } })).status, 400);
    await adm.ok('DELETE', `/api/admin/players/${maxId}`, { confirm: g.pseudo.max.toLowerCase() });
    assert.equal((await adm.get(`/api/admin/players/${maxId}`)).status, 404);
    const { members } = await g.c.lea.ok('GET', `/api/groups/${g.gid}`);
    assert.deepEqual(members.filter((m) => m.id === g.id.max).map((m) => [m.pseudo, m.status]), [['Ancien membre 1', 'left']]);
    assert.equal((await srv.client().post('/api/account/login', { pseudo: g.pseudo.max, pin: PIN, group: g.token })).status, 404);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 401, 'ses connexions disparaissent avec lui');
  });
});

describe('groupes', () => {
  it('liste et fiche, renommer, nouveau lien, ajouter un compte, changer son rôle, le retirer', async () => {
    const g = await setupGroup(srv, ['max']);
    const other = await setupGroup(srv, []);
    const adm = await signIn();
    const listed = (await adm.ok('GET', '/api/admin/groups')).groups.find((x) => x.id === g.gid);
    assert.deepEqual([listed.name, listed.members], ['Les Potes', 2]);
    let { group } = await adm.ok('GET', `/api/admin/groups/${g.gid}`);
    assert.equal(group.coupon.hint.length, 4, 'le coupon qui l’a créé');
    assert.deepEqual(group.members.map((m) => [m.pseudo, m.role]), [[g.pseudo.lea, 'admin'], [g.pseudo.max, 'member']]);

    await adm.ok('PATCH', `/api/admin/groups/${g.gid}`, { name: 'Les Vrais Potes', emoji: '⚡' });
    // Nouveau lien : une nouvelle adresse ; l'ancienne ne mène plus à rien, même pour les membres (l'admin garde l'id).
    const { address } = await adm.ok('POST', `/api/admin/groups/${g.gid}/address`);
    assert.match(address, /^[0-9a-f]{16}$/);
    assert.notEqual(address, g.token);
    assert.equal((await srv.client().get(`/api/groups/${g.token}/entry`)).body.code, 'group_not_found', 'l’ancien lien ne marche plus');
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 404);
    assert.equal((await srv.client().ok('GET', `/api/groups/${address}/entry`)).group.name, 'Les Vrais Potes');
    assert.equal((await g.c.max.ok('GET', '/api/account')).groups[0].id, address, 'le membre retrouve son groupe à la nouvelle adresse');
    assert.equal((await adm.ok('GET', `/api/admin/groups/${g.gid}`)).group.address, address);

    const leaOther = (await adm.ok('GET', '/api/admin/players')).players.find((p) => p.pseudo === other.pseudo.lea);
    const { memberId } = await adm.ok('POST', `/api/admin/groups/${g.gid}/members`, { playerId: leaOther.id });
    assert.equal((await adm.post(`/api/admin/groups/${g.gid}/members`, { playerId: leaOther.id })).status, 409, 'déjà dedans');
    assert.equal((await other.c.lea.ok('GET', `/api/groups/${address}`)).me.role, 'member');
    await adm.ok('PATCH', `/api/admin/members/${memberId}`, { role: 'admin' });
    // Retirer la seule autre admin : le groupe garde un admin (le plus ancien membre).
    await adm.ok('DELETE', `/api/admin/members/${g.id.lea}`);
    await adm.ok('DELETE', `/api/admin/members/${memberId}`);
    ({ group } = await adm.ok('GET', `/api/admin/groups/${g.gid}`));
    assert.deepEqual(group.members.filter((m) => m.status === 'active').map((m) => [m.pseudo, m.role]), [[g.pseudo.max, 'admin']]);
    const feed = (await g.c.max.ok('GET', `/api/groups/${address}/feed`)).events.map((e) => [e.type, e.data.admin ?? null]);
    assert.ok(feed.some(([type, adminDid]) => type === 'member_removed' && adminDid), 'le fil du groupe dit « par l’admin du site »');
  });

  it('créer un groupe pour un compte existant (sans coupon) ; le supprimer en retapant son nom', async () => {
    const g = await setupGroup(srv, ['max']);
    const adm = await signIn();
    const maxId = (await adm.ok('GET', '/api/admin/players')).players.find((p) => p.pseudo === g.pseudo.max).id;
    const { id } = await adm.ok('POST', '/api/admin/groups', { name: 'Le Bureau', emoji: '💼', playerId: maxId });
    assert.equal((await g.c.max.ok('GET', `/api/groups/${id}`)).me.role, 'admin');
    // Un groupe bien rempli (paris, pronostics, commentaires, fil) part en entier.
    const { betId, opt } = await createBet(srv, g, { closesIn: HOUR });
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Oui });
    await g.c.max.ok('POST', betUrl(g, betId, 'comments'), { body: 'Facile' });
    assert.equal((await adm.req('DELETE', `/api/admin/groups/${g.gid}`, { body: { confirm: 'Les Potos' } })).status, 400);
    await adm.ok('DELETE', `/api/admin/groups/${g.gid}`, { confirm: 'les potes' });
    assert.equal((await adm.get(`/api/admin/groups/${g.gid}`)).status, 404);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 404);
    assert.deepEqual((await g.c.max.ok('GET', '/api/account')).groups.map((x) => x.name), ['Le Bureau'], 'ses autres groupes restent');
    // Le coupon garde la trace du groupe supprimé.
    const used = (await adm.ok('GET', '/api/admin/coupons')).coupons.find((c) => c.groupName === 'Les Potes' && c.usedByPseudo === g.pseudo.lea);
    assert.deepEqual([used.state, used.groupId], ['used', null]);
  });

  it('tableau de bord et journal : chiffres, connexions admin, chaque action en clair', async () => {
    const adm = await signIn();
    const code = coupon(srv);
    await srv.client().ok('POST', '/api/groups', { name: 'Tableau', emoji: '📊', pseudo: 'Bord', avatar: '🦉', pin: PIN, coupon: code });
    const overview = await adm.ok('GET', '/api/admin/overview');
    assert.ok(overview.players >= 1 && overview.groups >= 1);
    assert.equal(overview.recentGroups[0].name, 'Tableau');
    assert.ok(overview.sessions.length >= 1 && overview.sessions[0].ip);
    assert.ok(overview.log.length > 0);
    const log = await adm.ok('GET', '/api/admin/log');
    assert.ok(log.entries.every((e) => e.at && e.action && e.summary));
    assert.ok(log.sessions.length >= 1, 'les sessions admin ouvertes sont sur la page Journal');
  });

  it('vue d’ensemble : tendances, pronostics par jour, et « à traiter » (chacun disparaît une fois réglé)', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const adm = await signIn(s);
    const g = await setupGroup(s, ['max', 'tom']);
    const { betId, opt } = await createBet(s, g, { closesIn: HOUR });
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Non });
    let o = await adm.ok('GET', '/api/admin/overview');
    assert.equal(o.picksByDay.length, 14);
    assert.equal(o.picksByDay.at(-1), 2, 'les pronostics d’aujourd’hui, dans la dernière case');
    assert.equal(o.newPlayers, 3);
    assert.equal(o.closingSoon, 1, 'le pari se ferme dans l’heure');
    assert.deepEqual(o.attention, [], 'rien à traiter : tout va bien');

    // Un compte créé par l'admin (sans PIN), Max bloqué, un coupon qui expire dans 2 jours, la F1 qui ne répond plus.
    const { id: noraId } = await adm.ok('POST', '/api/admin/players', { pseudo: 'Nora', avatar: '🐼', groupId: g.gid, role: 'member' });
    const maxId = (await adm.ok('GET', '/api/admin/players')).players.find((p) => p.pseudo === g.pseudo.max).id;
    s.deps.db.prepare('UPDATE players SET locked_until = ? WHERE id = ?').run(s.clock.now() + HOUR, maxId);
    s.deps.coupons.create({ note: 'Julien', days: 2 });
    s.deps.sources.health.set('f1', { okAt: s.clock.now() - 3 * HOUR, failingSince: s.clock.now() - 2 * HOUR, error: 'HTTP 503' });
    s.deps.sources.health.set('foot', { okAt: null, failingSince: s.clock.now() - 10 * MINUTE, error: 'HTTP 500' }); // trop récent : pas encore signalé
    o = await adm.ok('GET', '/api/admin/overview');
    assert.deepEqual(o.attention.map((a) => a.type), ['locked', 'new_pin', 'source_down', 'coupon_expiring']);
    assert.equal(o.attention[0].player.id, maxId);
    assert.deepEqual(o.attention[1].players.map((p) => p.id), [noraId]);
    assert.deepEqual([o.attention[2].source.id, o.attention[2].error], ['f1', 'HTTP 503']);
    assert.equal(o.attention[3].coupon.note, 'Julien');
    const nav = await adm.ok('GET', '/api/admin/nav');
    assert.deepEqual([nav.attention, nav.sources, nav.coupons, nav.sessions], [4, 1, 1, 1]);
    assert.equal(nav.players, o.players);

    // Débloqué, la source qui répond de nouveau : ces points disparaissent.
    await adm.ok('POST', `/api/admin/players/${maxId}/unlock`);
    const readAt = s.clock.now();
    s.deps.sources.health.set('f1', { okAt: readAt, failingSince: null, error: null });
    o = await adm.ok('GET', '/api/admin/overview');
    assert.deepEqual(o.attention.map((a) => a.type), ['new_pin', 'coupon_expiring']);
    const f1 = (await adm.ok('GET', '/api/admin/sources')).sources.find((x) => x.id === 'f1');
    assert.deepEqual([f1.readAt, f1.failingSince], [readAt, null]);

    // Un groupe toujours sans pari 3 jours après sa création (la session admin, elle, a expiré entre-temps).
    const lonely = await setupGroup(s, [], { house: false });
    s.clock.advance(3 * 24 * HOUR + MINUTE);
    o = await (await signIn(s)).ok('GET', '/api/admin/overview');
    assert.ok(o.attention.some((a) => a.type === 'idle_group' && a.group.id === lonely.gid));
    assert.equal(o.groupsWithoutBets, 1);
  }));

  it('lecture des sources : la dernière réussie est notée ; injoignable, depuis quand (signalé au bout d’une heure)', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const adm = await signIn(s);
    const g = await setupGroup(s, ['max'], { house: false });
    await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { sources: { foot: { competitions: ['fra.1'] } } });
    const foot = async () => (await adm.ok('GET', '/api/admin/sources')).sources.find((x) => x.id === 'foot');
    await s.deps.sources.autoOpen();
    const read = await foot();
    assert.ok(read.readAt > 0 && read.failingSince === null && read.error === null, 'lue');

    s.upstream.down = true;
    s.clock.advance(31 * MINUTE); // après le cache de 30 min du tableau des matchs
    const t0 = s.clock.now();
    await s.deps.sources.autoOpen();
    const t1 = s.clock.now();
    s.clock.advance(30 * MINUTE);
    await s.deps.sources.autoOpen();
    const down = await foot();
    assert.equal(down.readAt, read.readAt, 'la dernière lecture réussie reste');
    assert.ok(down.failingSince >= t0 && down.failingSince <= t1, 'injoignable depuis le premier échec');
    assert.equal(down.error, 'injoignable');
    assert.ok(!(await adm.ok('GET', '/api/admin/overview')).attention.some((a) => a.type === 'source_down'), 'une demi-heure : pas encore');
    s.clock.advance(31 * MINUTE);
    assert.ok((await adm.ok('GET', '/api/admin/overview')).attention.some((a) => a.type === 'source_down' && a.source.id === 'foot'));

    s.upstream.down = false;
    const t2 = s.clock.now();
    await s.deps.sources.autoOpen();
    const back = await foot();
    assert.ok(back.readAt >= t2 && back.failingSince === null);
  }));
});

describe('apparence', () => {
  it('le thème du site : habillage d’origine par défaut, changé par l’admin du site seulement, servi à /theme.css', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const css = async () => {
      const res = await fetch(`${s.base}/theme.css`);
      assert.match(res.headers.get('content-type'), /^text\/css/);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
      assert.deepEqual([res.headers.get('last-modified'), res.headers.get('etag')], [null, null], 'pas de 304 vers l’ancien thème');
      return res.text();
    };
    assert.match(await css(), /Thème « Stade »/);
    assert.equal((await s.client().ok('GET', '/api/instance')).theme, 'stade');
    const adm = await signIn(s);
    const { theme, themes } = await adm.ok('GET', '/api/admin/appearance');
    assert.equal(theme, 'stade');
    assert.deepEqual(themes.map((t) => t.id), ['stade', 'tribune', 'nocturne', 'recre', 'arene', 'vestiaire']);

    assert.deepEqual(await adm.ok('PUT', '/api/admin/theme', { theme: 'nocturne' }), { theme: 'nocturne' });
    const nocturne = await css();
    assert.match(nocturne, /font-family: "Barlow Condensed"/);
    assert.match(nocturne, /url\("\/fonts\/nocturne\/barlow-400\.woff2"\)/);
    assert.equal((await s.client().ok('GET', '/api/instance')).theme, 'nocturne');
    assert.equal(s.deps.db.prepare("SELECT value FROM instance_settings WHERE key = 'theme'").get().value, 'nocturne');
    const [last] = (await adm.ok('GET', '/api/admin/log')).entries;
    assert.deepEqual([last.action, last.summary], ['theme_changed', 'Thème « Stade » remplacé par « Nocturne » pour tout le site']);

    // Chaque thème a sa feuille et ses polices, servies par l'app.
    for (const t of themes.filter((x) => x.id !== 'stade')) {
      await adm.ok('PUT', '/api/admin/theme', { theme: t.id });
      const sheet = await css();
      const fonts = [...sheet.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
      assert.ok(fonts.length >= 2, t.id);
      for (const f of fonts) assert.equal((await fetch(s.base + f)).status, 200, f);
    }

    assert.equal((await adm.req('PUT', '/api/admin/theme', { body: { theme: 'fluo' } })).status, 400);
    const g = await setupGroup(s, []);
    assert.equal((await g.c.lea.req('PUT', '/api/admin/theme', { body: { theme: 'recre' } })).status, 401, 'réservé à l’admin du site');
    assert.equal((await s.client().ok('GET', '/api/instance')).theme, 'vestiaire');
  }));
});

describe('configuration de l’installation', () => {
  const OURS = {
    name: 'Paris entre Couilles', shortName: 'EntreCouilles', publicUrl: 'https://paris.entrecouilles.fr/',
    hostName: 'Duck Platform', hostUrl: 'https://duckplatform.net',
  };
  const page = async (s, url) => (await fetch(s.base + url)).text();
  const metaInstance = (html) => JSON.parse(html.match(/<meta name="instance" content="([^"]*)">/)[1]
    .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

  it('nom, adresse publique, textes et hébergeur : réglés par l’admin du site, partout dans l’app, au journal', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    // Installation neuve : celle de PariTenu.
    let html = await page(s, '/');
    assert.match(html, /<title>Pari tenu !<\/title>/);
    assert.deepEqual(metaInstance(html), { ...(await s.client().ok('GET', '/api/instance')).brand });
    assert.equal(metaInstance(html).renamed, false);
    assert.equal(metaInstance(html).icon, '/icons/icon.svg');

    const adm = await signIn(s);
    const config = await adm.ok('GET', '/api/admin/configuration');
    assert.equal(config.branding.name, 'Pari tenu !');
    assert.equal(config.icons, null);
    assert.equal(config.theme, 'stade');

    const saved = await adm.ok('PATCH', '/api/admin/branding', OURS);
    assert.deepEqual(saved.changed, ['name', 'shortName', 'publicUrl', 'hostName', 'hostUrl']);
    assert.equal(saved.branding.publicUrl, 'https://paris.entrecouilles.fr', 'sans « / » final');
    assert.equal(saved.brand.renamed, true);
    const [last] = (await adm.ok('GET', '/api/admin/log')).entries;
    assert.equal(last.action, 'branding_changed');
    assert.match(last.summary, /^Nom : « Pari tenu ! » → « Paris entre Couilles » ; Nom court/);
    assert.equal((await adm.ok('PATCH', '/api/admin/branding', { name: 'Paris entre Couilles' })).changed.length, 0, 'rien de changé');

    // La coquille de l'app, celle de l'admin, le manifeste, l'API publique et les messages du serveur.
    html = await page(s, '/');
    assert.match(html, /<title>Paris entre Couilles<\/title>/);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="EntreCouilles">/);
    assert.equal(metaInstance(html).hostName, 'Duck Platform');
    assert.match(await page(s, '/g/abc'), /<title>Paris entre Couilles<\/title>/);
    assert.match(await page(s, '/admin'), /<title>Admin — Paris entre Couilles<\/title>/);
    const manifest = await (await fetch(`${s.base}/manifest.webmanifest`)).json();
    assert.deepEqual([manifest.name, manifest.short_name, manifest.start_url], ['Paris entre Couilles', 'EntreCouilles', '/']);
    assert.equal((await s.client().ok('GET', '/api/instance')).brand.publicUrl, 'https://paris.entrecouilles.fr');
    const refused = await s.client().post('/api/groups', { name: 'Sans coupon', emoji: '🎲', pseudo: 'Zoé', avatar: '🦊', pin: PIN });
    assert.equal(refused.body.code, 'coupon_required');
    assert.match(refused.body.error, /la personne qui gère Paris entre Couilles$/);

    // Les textes de l'admin ne deviennent jamais du code dans la page.
    await adm.ok('PATCH', '/api/admin/branding', { name: 'Les <script>alert(1)</script> $& amis', intro: 'Une "intro" $1 & co' });
    html = await page(s, '/');
    assert.match(html, /<title>Les &lt;script&gt;alert\(1\)&lt;\/script&gt; \$&amp; amis<\/title>/);
    assert.match(html, /<meta name="description" content="Une &quot;intro&quot; \$1 &amp; co">/);
    assert.ok(!html.includes('<script>alert'));
    assert.equal(metaInstance(html).name, 'Les <script>alert(1)</script> $& amis');

    // Refusés : adresse sans https, avec un chemin, nom trop long, nom court trop long, hébergeur en http.
    for (const body of [{ publicUrl: 'http://paris.entrecouilles.fr' }, { publicUrl: 'https://paris.entrecouilles.fr/jeu' },
      { name: 'x'.repeat(41) }, { name: ' ' }, { shortName: 'Paris entre Couilles' }, { hostUrl: 'http://duckplatform.net' }, { publicUrl: 'javascript:alert(1)' }]) {
      const r = await adm.req('PATCH', '/api/admin/branding', { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const g = await setupGroup(s, []);
    assert.equal((await g.c.lea.req('PATCH', '/api/admin/branding', { body: { name: 'Pirate' } })).status, 401, 'admin d’un groupe ≠ admin du site');
    assert.equal((await g.c.lea.req('GET', '/api/admin/configuration')).status, 401);

    // Revenir aux valeurs de PariTenu : le crédit disparaît.
    const back = await adm.ok('PATCH', '/api/admin/branding', { name: 'Pari tenu !', publicUrl: '', hostName: '' });
    assert.equal(back.brand.renamed, false);
    assert.equal(back.branding.publicUrl, '');
  }));

  it('adresse publique : ses requêtes passent le contrôle d’origine, et ses cookies sont « Secure »', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const adm = await signIn(s);
    const ours = { headers: { origin: 'https://paris.entrecouilles.fr' } };
    assert.equal((await adm.post('/api/admin/coupons', {}, ours)).status, 403, 'pas encore son adresse');
    await adm.ok('PATCH', '/api/admin/branding', { publicUrl: 'https://paris.entrecouilles.fr' });
    assert.equal((await adm.post('/api/admin/coupons', {}, ours)).status, 201);
    assert.equal((await adm.post('/api/admin/coupons', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
    // Derrière le proxy de l'hébergeur, en http côté serveur : le cookie reste réservé au https. (fetch ne laisse pas
    // choisir l'en-tête Host : node:http, si.)
    const { port } = new URL(s.base);
    const cookies = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/api/admin/login', method: 'POST',
        headers: { host: 'paris.entrecouilles.fr', origin: 'https://paris.entrecouilles.fr', 'content-type': 'application/json' },
      }, (res) => { res.resume(); resolve(res.headers['set-cookie'] ?? []); });
      req.on('error', reject);
      req.end(JSON.stringify({ password: PASSWORD }));
    });
    assert.match(cookies.find((x) => x.startsWith('pt_admin=')), /; Secure/i);
  }));

  it('icône : un PNG recadré au carré et décliné dans ses tailles, servi en cache ; refus d’autre chose ; retour à l’origine', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const adm = await signIn(s);
    // Une image 600 × 400 : moitié gauche rouge, moitié droite bleue.
    const data = Buffer.alloc(600 * 400 * 4);
    for (let i = 0; i < 600 * 400; i++) data.set((i % 600) < 300 ? [220, 30, 30, 255] : [30, 30, 220, 255], i * 4);
    const png = encodePng({ width: 600, height: 400, data }).toString('base64');

    const { icons, brand } = await adm.ok('PUT', '/api/admin/icon', { png });
    assert.match(icons.logo, /^\/brand\/icon-192\.png\?v=\d+$/);
    assert.equal(brand.icon, icons.logo);
    for (const [file, side] of [['icon-32.png', 32], ['icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
      const res = await fetch(`${s.base}/brand/${file}?v=1`);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.match(res.headers.get('cache-control'), /immutable/);
      const body = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(pngSize(body), { width: side, height: side }, file);
      if (file === 'icon-192.png') {
        const img = decodePng(body);
        assert.deepEqual([...img.data.subarray(0, 3)], [220, 30, 30], 'recadré au centre : rouge à gauche');
        assert.deepEqual([...img.data.subarray((192 * 192 - 1) * 4, (192 * 192 - 1) * 4 + 3)], [30, 30, 220], 'bleu à droite');
      }
    }
    assert.equal((await fetch(`${s.base}/brand/..%2Fparitenu.db`)).status, 404);
    assert.equal((await fetch(`${s.base}/brand/autre.png`)).status, 404);
    const html = await page(s, '/');
    assert.match(html, /<link rel="icon" href="\/brand\/icon-32\.png\?v=\d+" type="image\/png">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/brand\/icon-180\.png\?v=\d+">/);
    const manifest = await (await fetch(`${s.base}/manifest.webmanifest`)).json();
    assert.deepEqual(manifest.icons.map((i) => i.purpose), ['any', 'any', 'maskable']);
    assert.equal((await adm.ok('GET', '/api/admin/log')).entries[0].action, 'icon_changed');

    // Refusés : pas un PNG, trop petit, illisible.
    const small = encodePng({ width: 100, height: 300, data: Buffer.alloc(100 * 300 * 4, 255) }).toString('base64');
    for (const [body, message] of [[Buffer.from('<svg></svg>').toString('base64'), /PNG/], [small, /trop petite/],
      [Buffer.concat([Buffer.from(png, 'base64').subarray(0, 40), Buffer.alloc(30)]).toString('base64'), /illisible/]]) {
      const r = await adm.req('PUT', '/api/admin/icon', { body: { png: body } });
      assert.equal(r.status, 400);
      assert.match(r.body.error, message);
    }
    const g = await setupGroup(s, []);
    assert.equal((await g.c.lea.req('PUT', '/api/admin/icon', { body: { png } })).status, 401);
    assert.equal((await g.c.lea.req('POST', '/api/groups', { body: { name: 'x'.repeat(40_000) } })).status, 413, 'les 3 Mo ne valent que pour /admin/icon');

    // Retour à l'icône de PariTenu.
    const reset = await adm.ok('DELETE', '/api/admin/icon');
    assert.deepEqual([reset.icons, reset.brand.icon], [null, '/icons/icon.svg']);
    assert.equal((await fetch(`${s.base}/brand/icon-192.png`)).status, 404);
    assert.match(await page(s, '/'), /<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml">/);
  }));
});

describe('classements et sources', () => {
  it('les classements d’un groupe : un par catégorie ou compétition, saison en cours, meneur et détail', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const g = await setupGroup(s, ['max', 'tom']);
    const { betId, opt } = await createBet(s, g, { closesIn: HOUR });
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Non });
    s.clock.advance(HOUR + MINUTE);
    s.deps.bets.sweepAll();
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    s.clock.advance(25 * HOUR);
    s.deps.bets.sweepAll();
    const adm = await signIn(s);
    const { rankings } = await adm.ok('GET', `/api/admin/groups/${g.gid}/rankings`);
    assert.deepEqual(rankings.map((r) => [r.key, r.leader?.member.pseudo]), [['cat:groupe', g.pseudo.max]]);
    const ranking = await adm.ok('GET', `/api/admin/groups/${g.gid}/rankings/${encodeURIComponent('cat:groupe')}`);
    assert.deepEqual(ranking.season.standings.map((r) => [r.member.pseudo, r.rank, r.played, r.correct]), [[g.pseudo.max, 1, 1, 1], [g.pseudo.tom, 2, 1, 0]]);
    assert.ok(ranking.season.standings[0].score > 0);
    const again = await adm.ok('GET', `/api/admin/groups/${g.gid}/rankings/${encodeURIComponent('cat:groupe')}?season=${ranking.seasons[0].id}`);
    assert.equal(again.season.id, ranking.seasons[0].id);
    assert.equal((await adm.get(`/api/admin/groups/${g.gid}/rankings/${encodeURIComponent('foot:fra.1')}`)).status, 404);
    assert.equal((await g.c.lea.get(`/api/admin/groups/${g.gid}/rankings`)).status, 401, 'réservé à l’admin du site');
  }));

  it('couper une source pour tout le site : plus proposée ni ouverte, paris sans pronostic retirés ; rallumée, tout reprend', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const g = await setupGroup(s, ['max']);
    await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { sources: { foot: { competitions: ['fra.1'] } } });
    await joinCompetitions(g.c.lea, g.gid);
    await s.deps.sources.autoOpen(g.gid);
    const foot = async () => (await g.c.lea.ok('GET', `/api/groups/${g.gid}/bets`)).bets.filter((b) => b.source?.id === 'foot');
    const before = await foot();
    assert.ok(before.length >= 2);
    await g.c.max.ok('POST', betUrl(g, before[0].id, 'pick'), { optionId: before[0].options[0].id });
    const adm = await signIn(s);
    let { sources } = await adm.ok('GET', '/api/admin/sources');
    let row = sources.find((x) => x.id === 'foot');
    assert.deepEqual([row.enabled, row.groups, row.openBets, row.key], [true, 1, before.length, null]);
    assert.equal(sources.find((x) => x.id === 'padel').key, 'ok');

    const { removed } = await adm.ok('PATCH', '/api/admin/sources/foot', { enabled: false });
    assert.equal(removed, before.length - 1, 'seul le pari joué reste');
    assert.deepEqual((await foot()).map((b) => b.id), [before[0].id], 'le pari joué va jusqu’à son résultat');
    assert.ok(!(await g.c.lea.ok('GET', `/api/groups/${g.gid}/sources`)).sources.some((x) => x.id === 'foot'), 'plus dans les réglages du groupe');
    assert.ok(!(await s.client().ok('GET', '/api/instance')).catalog.some((x) => x.id === 'foot'), 'plus sur l’accueil');
    assert.equal(await s.deps.sources.autoOpen(g.gid), 0, 'plus rien ne s’ouvre');
    ({ sources } = await adm.ok('GET', '/api/admin/sources'));
    row = sources.find((x) => x.id === 'foot');
    assert.deepEqual([row.enabled, row.groups], [false, 1], 'les réglages du groupe sont gardés');
    assert.equal(s.deps.db.prepare("SELECT value FROM instance_settings WHERE key = 'disabled_sources'").get().value, '["foot"]');

    await adm.ok('PATCH', '/api/admin/sources/foot', { enabled: true });
    assert.ok((await g.c.lea.ok('GET', `/api/groups/${g.gid}/sources`)).sources.find((x) => x.id === 'foot').selected.includes('fra.1'));
    assert.ok(await s.deps.sources.autoOpen(g.gid) >= 1, 'ses paris se rouvrent');
    assert.equal((await adm.req('PATCH', '/api/admin/sources/inconnue', { body: { enabled: false } })).status, 404);
    const log = (await adm.ok('GET', '/api/admin/log')).entries.map((e) => e.summary);
    assert.ok(log.some((x) => /coupée pour tous les groupes \(\d+ paris? sans pronostic retirés?\)/.test(x)));
    assert.ok(log.some((x) => /rallumée pour tous les groupes/.test(x)));
  }));

  it('modifier un groupe : nom et tous ses réglages d’un coup, compétitions ouvertes et retirées, journal détaillé', () => fresh(async (s) => {
    await s.deps.admin.setPassword(PASSWORD);
    const g = await setupGroup(s, ['max']);
    const adm = await signIn(s);
    let { settings, sources, off } = await adm.ok('GET', `/api/admin/groups/${g.gid}/settings`);
    assert.equal(settings.basePoints, 100);
    assert.deepEqual(sources.find((x) => x.id === 'foot').selected, [], 'rien d’activé d’office');
    assert.deepEqual(off, []);
    assert.deepEqual((await adm.ok('GET', `/api/admin/groups/${g.gid}`)).group.competitions, []);

    // Comme l'envoie la page « Modifier » : tout le formulaire, une compétition activée, les points changés.
    const form = (changes) => ({
      name: 'Les Potes du foot', emoji: '⚽',
      settings: {
        ...settings, ...changes.points,
        sources: Object.fromEntries(sources.map((x) => [x.id, { competitions: changes.competitions?.[x.id] ?? x.selected, params: x.values }])),
      },
    });
    const first = await adm.ok('PATCH', `/api/admin/groups/${g.gid}`, form({ points: { basePoints: 200, oddsCap: 5 }, competitions: { foot: ['fra.1'] } }));
    assert.equal(first.removed, 0);
    let { group } = await adm.ok('GET', `/api/admin/groups/${g.gid}`);
    assert.deepEqual([group.name, group.settings.basePoints, group.settings.oddsCap], ['Les Potes du foot', 200, 5]);
    assert.deepEqual(group.competitions.map((c) => c.key), ['foot:fra.1']);
    const feeds = (await g.c.max.ok('GET', `/api/groups/${g.gid}/feeds`)).feeds;
    assert.deepEqual(feeds.map((f) => [f.key, f.choice]), [['foot:fra.1', null]], 'proposée aux membres, chacun choisit');
    const added = (await g.c.max.ok('GET', `/api/groups/${g.gid}/feed`)).events.find((e) => e.type === 'competitions_added');
    assert.deepEqual([added.memberId, added.data], [null, { admin: true, labels: ['⚽ Ligue 1'] }], 'le fil du groupe le dit');
    assert.ok(await s.deps.sources.autoOpen(g.gid) >= 2, 'ses paris s’ouvrent');

    // Sans changement : rien de faux au journal. Puis la compétition coupée : ses paris sans pronostic partent.
    ({ settings, sources } = await adm.ok('GET', `/api/admin/groups/${g.gid}/settings`));
    await adm.ok('PATCH', `/api/admin/groups/${g.gid}`, form({}));
    const second = await adm.ok('PATCH', `/api/admin/groups/${g.gid}`, form({ competitions: { foot: [] } }));
    assert.ok(second.removed >= 2);
    ({ group } = await adm.ok('GET', `/api/admin/groups/${g.gid}`));
    assert.deepEqual(group.competitions, []);
    const log = (await adm.ok('GET', '/api/admin/log')).entries.filter((e) => e.action === 'group_updated').map((e) => e.summary);
    assert.match(log[2], /renommé « Les Potes du foot », emoji, points et délais, compétitions \(\+ ⚽ Ligue 1\)/);
    assert.match(log[1], /enregistré sans changement/);
    assert.match(log[0], /modifié : compétitions \(− ⚽ Ligue 1\)/);

    // Mêmes garde-fous que pour l'admin du groupe ; rien n'est écrit à moitié.
    let r = await adm.req('PATCH', `/api/admin/groups/${g.gid}`, { body: { name: 'Autre nom', emoji: '⚽', settings: { basePoints: 5 } } });
    assert.deepEqual([r.status, r.body.error], [400, 'Entre 10 et 1000 points.']);
    r = await adm.req('PATCH', `/api/admin/groups/${g.gid}`, { body: { name: 'Autre nom', emoji: '⚽', settings: { categories: settings.categories.slice(1) } } });
    assert.match(r.body.error, /ne se supprime pas/);
    assert.equal((await adm.ok('GET', `/api/admin/groups/${g.gid}`)).group.name, 'Les Potes du foot', 'nom inchangé : tout ou rien');
    // Nom et emoji seuls, comme avant.
    await adm.ok('PATCH', `/api/admin/groups/${g.gid}`, { name: 'Les Potes', emoji: '🍻' });

    // Ville de la météo, et une source coupée pour tout le site : absente du formulaire, signalée.
    assert.equal((await adm.ok('GET', '/api/admin/places?q=Lyon')).places[0].name, 'Lyon');
    assert.equal((await adm.get('/api/admin/places?q=L')).body.error, 'Tape au moins 2 lettres.');
    await adm.ok('PATCH', '/api/admin/sources/meteo', { enabled: false });
    ({ sources, off } = await adm.ok('GET', `/api/admin/groups/${g.gid}/settings`));
    assert.ok(!sources.some((x) => x.id === 'meteo'));
    assert.deepEqual(off.map((x) => x.id), ['meteo']);
    for (const path of [`/api/admin/groups/${g.gid}/settings`, '/api/admin/places?q=Lyon']) {
      assert.equal((await g.c.lea.get(path)).status, 401, 'réservé à l’admin du site');
    }
  }));

  it('source sans sa clé (padel) : signalée, sans interrupteur', async () => {
    const s = await startServer({ PT_PADEL_TOKEN: '' });
    try {
      await s.deps.admin.setPassword(PASSWORD);
      const adm = await signIn(s);
      assert.equal((await adm.ok('GET', '/api/admin/sources')).sources.find((x) => x.id === 'padel').key, 'missing');
    } finally {
      await s.stop();
    }
  });
});
