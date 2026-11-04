import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { newToken, sha256 } from '../src/lib/util.js';
import { betUrl, coupon, createBet, DAY, HOUR, MINUTE, PIN, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

/** Se connecter depuis le lien d'un groupe (token : son adresse ; null : sans lien, comme depuis l'accueil du site). */
const login = (client, token, pseudo, pin = PIN, extra = {}) => client.post('/api/account/login', { pseudo, pin, ...(token ? { group: token } : {}), ...extra });
/** Mon membre dans ce groupe (son id change d'un groupe à l'autre). */
const meIn = async (client, gid) => (await client.ok('GET', `/api/groups/${gid}`)).me;

describe('un compte par joueur', () => {
  it('créer un groupe crée le compte : un cookie de session HttpOnly, valable dans tous ses groupes', async () => {
    const c = srv.client();
    const r = await c.post('/api/groups', { name: 'Les Potes', emoji: '🍻', pseudo: 'Créa', avatar: '🦊', pin: PIN, coupon: coupon(srv) });
    assert.equal(r.status, 201);
    const cookie = c.setCookies.find((x) => x.startsWith('pt_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /Secure/i, 'en http local, pas de Secure (sinon le cookie serait perdu)');
    const me = await meIn(c, r.body.groupId);
    assert.deepEqual([me.role, me.pseudo], ['admin', 'Créa']);
    assert.deepEqual((await c.ok('GET', '/api/instance')).account, { id: (await c.ok('GET', '/api/account')).account.id, pseudo: 'Créa', avatar: '🦊' });
  });

  it('rejoindre par le lien crée le compte : pseudo unique sur toute l’instance (sans tenir compte des majuscules), PIN à 4 chiffres', async () => {
    const g = await setupGroup(srv, ['max']);
    const info = await srv.client().ok('GET', `/api/groups/${g.token}/entry`);
    assert.equal(info.group.name, 'Les Potes');
    assert.equal(info.members, undefined, 'ni pseudos ni avatars des membres pour qui n’en est pas');
    assert.deepEqual(info.group, { id: g.token, name: 'Les Potes', emoji: '🍻' });
    assert.equal(info.signedIn, false);
    assert.equal(info.account, null);
    assert.equal((await g.c.max.ok('GET', `/api/groups/${g.token}/entry`)).signedIn, true);
    const dup = await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: g.pseudo.max.toUpperCase(), avatar: '🐯', pin: PIN });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'Ce pseudo est déjà pris : choisis-en un autre.');
    // Un pseudo pris dans un autre groupe l'est aussi ici : c'est le même compte partout.
    const other = await setupGroup(srv, []);
    assert.equal((await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: other.pseudo.lea, avatar: '🐯', pin: PIN })).status, 409);
    for (const pin of ['123', '12345', 'abcd', '12a4']) {
      const r = await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: 'Tomate', avatar: '🐯', pin });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'Le PIN fait 4 chiffres.');
    }
    assert.equal((await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: 'T', avatar: '🐯', pin: PIN })).body.error,
      'Ton pseudo fait au moins 2 caractères.');
    assert.equal((await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: 'Ancien membre 7', avatar: '🐯', pin: PIN })).status, 400, 'réservé aux membres partis');
  });

  it('connecté, on rejoint un autre groupe d’un geste ; sur un autre appareil, pseudo + PIN ouvrent tous ses groupes', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, []);
    const join = await a.c.max.post(`/api/groups/${b.token}/join`, {});
    assert.equal(join.status, 201);
    assert.equal((await meIn(a.c.max, b.gid)).pseudo, a.pseudo.max, 'son pseudo et son avatar, sans rien retaper');
    assert.equal((await a.c.max.post(`/api/groups/${b.token}/join`, {})).body.already, true, 'déjà dedans : on y entre simplement');

    const pc = srv.client();
    assert.equal((await pc.get(`/api/groups/${a.gid}`)).status, 401);
    assert.equal((await login(pc, a.token, 'Personne')).status, 404);
    const r = await login(pc, b.token, a.pseudo.max.toLowerCase());
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.account.pseudo, r.body.newPin], [a.pseudo.max, false]);
    assert.equal((await meIn(pc, a.gid)).pseudo, a.pseudo.max);
    assert.equal((await meIn(pc, b.gid)).pseudo, a.pseudo.max);
    assert.deepEqual((await pc.ok('GET', '/api/account')).groups.map((x) => x.id), [a.gid, b.gid]);
  });

  it('connexion seulement depuis le lien d’un groupe : sans lien, refusée ; lien inconnu, 404 ; celui d’un autre groupe, oui', async () => {
    const g = await setupGroup(srv, ['max']);
    const other = await setupGroup(srv, []);
    const r = await login(srv.client(), null, g.pseudo.max);
    assert.deepEqual([r.status, r.body.code], [403, 'group_link_required']);
    assert.match(r.body.error, /lien d’un de tes groupes/);
    assert.equal((await login(srv.client(), 'lien-inconnu-0000000000', g.pseudo.max)).status, 404);
    // Le lien d'un groupe où il n'est pas : il s'y connecte (puis peut le rejoindre d'un geste).
    const pc = srv.client();
    assert.equal((await login(pc, other.token, g.pseudo.max)).status, 200);
    assert.equal((await pc.post(`/api/groups/${other.token}/join`, {})).status, 201);
  });

  it('changer de PIN : les essais ratés comptent comme à la connexion, 5 bloquent le compte', async () => {
    const g = await setupGroup(srv, ['max']);
    for (let i = 4; i >= 1; i--) assert.equal((await g.c.max.post('/api/account/pin', { current: '0000', next: '1111' })).body.attemptsLeft, i);
    assert.equal((await g.c.max.post('/api/account/pin', { current: '0000', next: '1111' })).status, 423);
    assert.equal((await g.c.max.post('/api/account/pin', { current: PIN, next: '1111' })).status, 423, 'même avec le bon PIN');
    assert.equal((await login(srv.client(), g.token, g.pseudo.max)).status, 423, 'la connexion aussi');
    srv.clock.advance(15 * MINUTE);
    await g.c.max.ok('POST', '/api/account/pin', { current: PIN, next: '1111' });
  });

  it('une session n’ouvre que les groupes de son compte', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, ['tom']);
    const r = await b.c.tom.get(`/api/groups/${a.gid}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'not_member');
  });

  it('5 PIN faux bloquent le compte 15 minutes, puis deux fois plus à chaque fois ; le bon PIN remet à zéro', async () => {
    const g = await setupGroup(srv, ['max']);
    const thief = srv.client();
    const fiveWrong = async () => {
      for (let i = 4; i >= 1; i--) {
        const r = await login(thief, g.token, g.pseudo.max, '0000');
        assert.equal(r.status, 401);
        assert.equal(r.body.attemptsLeft, i);
      }
      return login(thief, g.token, g.pseudo.max, '0000');
    };
    const fifth = await fiveWrong();
    assert.equal(fifth.status, 423);
    assert.match(fifth.body.error, /bloqué.*15 min/);
    assert.equal((await login(thief, g.token, g.pseudo.max)).status, 423, 'même avec le bon PIN');
    srv.clock.advance(15 * MINUTE);
    assert.match((await fiveWrong()).body.error, /30 min/, 'deuxième blocage : deux fois plus long');
    srv.clock.advance(15 * MINUTE);
    assert.equal((await login(thief, g.token, g.pseudo.max)).status, 423);
    srv.clock.advance(15 * MINUTE);
    assert.equal((await login(thief, g.token, g.pseudo.max)).status, 200);
    assert.match((await fiveWrong()).body.error, /15 min/, 'après une connexion réussie, on repart du plus court');
    srv.clock.advance(15 * MINUTE);
  });
});

describe('administration du groupe', () => {
  it('changer le lien : une nouvelle adresse ; l’ancienne ne permet plus ni d’entrer ni de se connecter, les sessions restent', async () => {
    const g = await setupGroup(srv, ['max']);
    assert.equal((await g.c.max.post(`/api/groups/${g.gid}/address`)).status, 403);
    const { id: address } = await g.c.lea.ok('POST', `/api/groups/${g.gid}/address`);
    assert.notEqual(address, g.token);
    assert.match(address, /^[0-9a-f]{16}$/, '64 bits, comme une adresse de groupe');
    const old = await srv.client().get(`/api/groups/${g.token}/entry`);
    assert.equal(old.status, 404);
    assert.equal(old.body.code, 'group_not_found');
    assert.match(old.body.error, /lien/);
    assert.equal((await srv.client().post(`/api/groups/${g.token}/join`, { pseudo: 'Intrus', avatar: '🐯', pin: PIN })).status, 404, 'plus personne n’entre par l’ancienne');
    assert.equal((await login(srv.client(), g.token, g.pseudo.max)).status, 404, 'ni ne s’y connecte');
    assert.equal((await login(srv.client(), address, g.pseudo.max)).status, 200);
    assert.equal((await srv.client().get(`/api/groups/${address}/entry`)).status, 200);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 404, 'l’ancienne adresse ne mène plus au groupe');
    assert.equal((await g.c.max.ok('GET', `/api/groups/${address}`)).group.id, address, 'sa session reste : il y est à la nouvelle');
    assert.deepEqual((await g.c.max.ok('GET', '/api/account')).groups.map((x) => x.id), [address]);
  });

  it('réinitialiser un PIN : connexions coupées, le prochain PIN tapé depuis le lien du groupe devient le nouveau', async () => {
    const g = await setupGroup(srv, ['max']);
    assert.deepEqual(await g.c.lea.ok('POST', `/api/groups/${g.gid}/members/${g.id.max}/reset-pin`), { done: true, waiting: 0 });
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 401);
    // Le pseudo n'est pas secret : sans le lien du groupe, impossible de se connecter, ni d'y choisir le nouveau PIN.
    assert.equal((await login(g.c.max, null, g.pseudo.max, '9876')).body.code, 'group_link_required');
    assert.equal((await login(g.c.max, (await setupGroup(srv, [])).token, g.pseudo.max, '9876')).body.code, 'pin_reset', 'le lien d’un groupe où il n’est pas');
    assert.equal((await login(g.c.max, g.token, g.pseudo.max, '9876')).body.code, 'choose_pin');
    const r = await login(g.c.max, g.token, g.pseudo.max, '9876', { newPin: true });
    assert.equal(r.body.newPin, true);
    assert.equal((await login(srv.client(), g.token, g.pseudo.max, PIN)).status, 401);
    assert.equal((await login(srv.client(), g.token, g.pseudo.max, '9876')).status, 200);
  });

  it('un compte dans plusieurs groupes : il faut la réinitialisation d’un admin de chacun', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, []);
    await a.c.max.ok('POST', `/api/groups/${b.token}/join`, {});
    const maxInB = (await meIn(a.c.max, b.gid)).id;
    assert.deepEqual(await a.c.lea.ok('POST', `/api/groups/${a.gid}/members/${a.id.max}/reset-pin`), { done: false, waiting: 1 });
    assert.equal((await a.c.max.get(`/api/groups/${a.gid}`)).status, 200, 'rien ne change encore : l’admin d’un groupe ne prend pas le compte');
    assert.deepEqual(await b.c.lea.ok('POST', `/api/groups/${b.gid}/members/${maxInB}/reset-pin`), { done: true, waiting: 0 });
    assert.equal((await a.c.max.get(`/api/groups/${a.gid}`)).status, 401);

    // Un admin qui l'est aussi dans l'autre groupe le couvre d'un coup.
    const c = await setupGroup(srv, ['jo']);
    await c.c.jo.ok('POST', `/api/groups/${b.token}/join`, {});
    await b.c.lea.ok('POST', `/api/groups/${c.token}/join`, {});
    await c.c.lea.ok('POST', `/api/groups/${c.gid}/members/${(await meIn(b.c.lea, c.gid)).id}/role`, { role: 'admin' });
    assert.deepEqual(await b.c.lea.ok('POST', `/api/groups/${b.gid}/members/${(await meIn(c.c.jo, b.gid)).id}/reset-pin`), { done: true, waiting: 0 });

    // Le joueur se connecte avec son PIN entre-temps : il ne l'a pas oublié, la demande en cours tombe.
    const d = await setupGroup(srv, ['sam']);
    await d.c.sam.ok('POST', `/api/groups/${b.token}/join`, {});
    await d.c.lea.ok('POST', `/api/groups/${d.gid}/members/${d.id.sam}/reset-pin`);
    assert.equal((await login(srv.client(), d.token, d.pseudo.sam)).status, 200);
    assert.deepEqual(await b.c.lea.ok('POST', `/api/groups/${b.gid}/members/${(await meIn(d.c.sam, b.gid)).id}/reset-pin`), { done: false, waiting: 1 });
  });

  it('rôles : il reste toujours au moins un admin', async () => {
    const g = await setupGroup(srv, ['max']);
    assert.equal((await g.c.max.post(`/api/groups/${g.gid}/members/${g.id.lea}/role`, { role: 'member' })).status, 403);
    await g.c.lea.ok('POST', `/api/groups/${g.gid}/members/${g.id.max}/role`, { role: 'admin' });
    await g.c.max.ok('POST', `/api/groups/${g.gid}/members/${g.id.lea}/role`, { role: 'member' });
    const last = await g.c.max.post(`/api/groups/${g.gid}/members/${g.id.max}/role`, { role: 'member' });
    assert.equal(last.status, 409);
  });

  it('retirer un membre : ses pronostics sur les paris ouverts disparaissent, son historique reste', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines']);
    const done = await createBet(srv, g);
    await g.c.max.ok('POST', betUrl(g, done.betId, 'pick'), { optionId: done.opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, done.betId, 'pick'), { optionId: done.opt.Non });
    srv.clock.advance(HOUR);
    const open = await createBet(srv, g);
    await g.c.max.ok('POST', betUrl(g, open.betId, 'pick'), { optionId: open.opt.Oui });
    await g.c.lea.ok('POST', `/api/groups/${g.gid}/members/${g.id.max}/remove`);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 403, 'son compte ne lui ouvre plus ce groupe');
    assert.equal((await g.c.lea.ok('GET', betUrl(g, open.betId))).bet.participants, 0);
    assert.equal((await g.c.lea.ok('GET', betUrl(g, done.betId))).bet.participants, 2);
    const members = (await g.c.lea.ok('GET', `/api/groups/${g.gid}`)).members;
    assert.equal(members.find((m) => m.id === g.id.max).status, 'removed');
    assert.equal((await g.c.lea.post(`/api/groups/${g.gid}/members/${g.id.lea}/remove`)).status, 400);
    // Revenu par le lien : il retrouve sa place et son historique.
    await g.c.max.ok('POST', `/api/groups/${g.token}/join`, {});
    assert.equal((await meIn(g.c.max, g.gid)).id, g.id.max);
  });

  it('quitter le groupe : pseudo anonymisé, un autre membre devient admin si besoin', async () => {
    const g = await setupGroup(srv, ['max']);
    await g.c.lea.ok('POST', `/api/groups/${g.gid}/me/leave`);
    const data = await g.c.max.ok('GET', `/api/groups/${g.gid}`);
    const lea = data.members.find((m) => m.id === g.id.lea);
    assert.equal(lea.pseudo, 'Ancien membre 1');
    assert.equal(lea.status, 'left');
    assert.equal(data.me.role, 'admin');
    assert.equal((await g.c.lea.get(`/api/groups/${g.gid}`)).status, 403);
  });

  it('réglages : bornes, catégories masquables mais pas supprimables', async () => {
    const g = await setupGroup(srv, ['max']);
    assert.equal((await g.c.max.patch(`/api/groups/${g.gid}/settings`, { basePoints: 50 })).status, 403);
    assert.equal((await g.c.lea.patch(`/api/groups/${g.gid}/settings`, { basePoints: 5 })).status, 400);
    const { settings } = await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { basePoints: 50, oddsCap: 5, arbiterBonus: 0 });
    assert.deepEqual([settings.basePoints, settings.oddsCap, settings.arbiterBonus], [50, 5, 0]);
    const cats = settings.categories.map((c) => (c.id === 'meteo' ? { ...c, hidden: true } : c));
    const saved = (await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { categories: [...cats, { emoji: '🎂', label: 'Anniversaires' }] })).settings;
    assert.equal(saved.categories.find((c) => c.id === 'meteo').hidden, true);
    assert.ok(saved.categories.some((c) => c.label === 'Anniversaires' && c.id));
    const removed = await g.c.lea.patch(`/api/groups/${g.gid}/settings`, { categories: saved.categories.slice(1) });
    assert.equal(removed.status, 400);
    const bet = await g.c.lea.post(`/api/groups/${g.gid}/bets`, { question: 'Neige à Noël ?', category: 'meteo', kind: 'yesno', closesAt: srv.clock.now() + HOUR });
    assert.equal(bet.status, 400, 'catégorie masquée');
  });

  it('les points de base et le plafond s’appliquent au règlement', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines', 'sam', 'jo']);
    await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { basePoints: 50, oddsCap: 3 });
    const { betId, opt } = await createBet(srv, g);
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Oui });
    for (const who of ['tom', 'ines', 'sam', 'jo']) await g.c[who].ok('POST', betUrl(g, betId, 'pick'), { optionId: opt.Non });
    srv.clock.advance(HOUR);
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    srv.clock.advance(24 * HOUR);
    const bet = (await g.c.lea.ok('GET', betUrl(g, betId))).bet;
    assert.equal(bet.awards.find((a) => a.kind === 'gain').amount, 150, 'cote 5 plafonnée à 3, × 50');
  });

  it('export JSON réservé aux admins, sans PIN ni session', async () => {
    const g = await setupGroup(srv, ['max']);
    await createBet(srv, g);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}/export`)).status, 403);
    const r = await g.c.lea.get(`/api/groups/${g.gid}/export`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    const text = JSON.stringify(r.body);
    assert.equal(r.body.bets.length, 1);
    // L'id du groupe y figure (c'est aussi son adresse tant qu'un admin ne l'a pas changée) : l'admin la connaît déjà.
    assert.ok(!/\$(scrypt|argon2id)\$/.test(text), 'pas de hash de PIN');
  });
});

describe('mon compte', () => {
  it('changer d’avatar et de PIN : pour tous mes groupes', async () => {
    const g = await setupGroup(srv, ['max']);
    await g.c.max.ok('PATCH', '/api/account', { avatar: '🐙' });
    assert.equal((await meIn(g.c.max, g.gid)).avatar, '🐙');
    assert.equal((await g.c.max.post('/api/account/pin', { current: '0000', next: '1111' })).status, 401);
    await g.c.max.ok('POST', '/api/account/pin', { current: PIN, next: '1111' });
    assert.equal((await login(srv.client(), g.token, g.pseudo.max, PIN)).status, 401);
    assert.equal((await login(srv.client(), g.token, g.pseudo.max, '1111')).status, 200);
    assert.equal((await srv.client().post('/api/account/pin', { current: PIN, next: '1111' })).status, 401, 'sans compte connecté');
  });

  it('pseudo et avatar : les mêmes dans tous mes groupes, changés partout d’un coup', async () => {
    const g = await setupGroup(srv, ['max', 'tom']);
    const lea = g.c.lea;
    // Deuxième groupe depuis le même téléphone : rien à retaper, c'est mon compte.
    const { groupId: g2 } = await lea.ok('POST', '/api/groups', { name: 'Le Foot du jeudi', emoji: '⚽', coupon: coupon(srv) });
    const me = async (gid) => (({ pseudo, avatar }) => `${pseudo} ${avatar}`)(await meIn(lea, gid));
    assert.deepEqual([await me(g.gid), await me(g2)], [`${g.pseudo.lea} 🦊`, `${g.pseudo.lea} 🦊`]);
    // Changer : c'est changé dans les deux.
    await lea.ok('PATCH', '/api/account', { pseudo: 'Lélé', avatar: 'j:3:1:10' });
    assert.deepEqual([await me(g.gid), await me(g2)], ['Lélé j:3:1:10', 'Lélé j:3:1:10']);
    // Le pseudo d'un autre compte : refusé, rien ne change.
    const taken = await lea.patch('/api/account', { pseudo: g.pseudo.max.toLowerCase() });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'Ce pseudo est déjà pris : choisis-en un autre.');
    // Le pseudo d'un membre retiré de mon groupe (qui en a changé depuis) : toujours affiché dans l'historique du groupe.
    await lea.ok('POST', `/api/groups/${g.gid}/members/${g.id.tom}/remove`);
    await g.c.tom.ok('PATCH', '/api/account', { pseudo: `Tomtom ${g.pseudo.tom}`.slice(0, 20) });
    const old = await lea.patch('/api/account', { pseudo: g.pseudo.tom });
    assert.equal(old.body.error, 'Ce pseudo est déjà pris dans « Les Potes », un de tes groupes.');
    assert.equal(await me(g2), 'Lélé j:3:1:10');
    // Le numéro du maillot fait deux chiffres au plus.
    const big = await lea.patch('/api/account', { avatar: 'j:3:1:100' });
    assert.equal(big.body.error, 'Le numéro du maillot fait deux chiffres au plus.');
  });

  it('se déconnecter : de tous ses groupes sur cet appareil, pas sur les autres', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, []);
    await a.c.max.ok('POST', `/api/groups/${b.token}/join`, {});
    const pc = srv.client();
    await login(pc, a.token, a.pseudo.max);
    await a.c.max.ok('POST', '/api/account/logout');
    assert.ok(!a.c.max.cookies.has('pt_session'), 'cookie effacé');
    assert.equal((await a.c.max.get(`/api/groups/${a.gid}`)).status, 401);
    assert.equal((await a.c.max.get(`/api/groups/${b.gid}`)).status, 401);
    assert.equal((await a.c.max.ok('GET', '/api/account')).account, null);
    assert.equal((await pc.get(`/api/groups/${b.gid}`)).status, 200, 'le PC reste connecté');
  });
});

describe('comptes d’avant (une connexion et un PIN par groupe)', () => {
  /** Remet le joueur de ce client dans l'état d'avant v8 : pas de session de compte, une session et un PIN par groupe. */
  async function legacy(client, gids, pins) {
    const { db, accounts } = srv.deps;
    const { account } = await client.ok('GET', '/api/account');
    db.prepare('DELETE FROM player_sessions WHERE player_id = ?').run(account.id);
    db.prepare('UPDATE players SET pin_hash = NULL WHERE id = ?').run(account.id);
    client.cookies.clear();
    for (const [i, gid] of gids.entries()) {
      const member = db.prepare('SELECT id FROM members WHERE player_id = ? AND group_id = ?').get(account.id, gid);
      db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(await accounts.hashPin(pins[i]), member.id);
      const token = newToken(32);
      db.prepare('INSERT INTO sessions (id_hash, member_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(token), member.id, srv.clock.now(), srv.clock.now(), srv.clock.now() + DAY);
      client.cookies.set(`pt_${gid}`, token);
    }
    return account;
  }

  it('un appareil connecté à un groupe le reste : sa session devient celle du compte, pour tous ses groupes', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, []);
    await a.c.max.ok('POST', `/api/groups/${b.token}/join`, {});
    await legacy(a.c.max, [a.gid], ['1111']);
    assert.equal((await a.c.max.get(`/api/groups/${a.gid}`)).status, 200);
    assert.ok(a.c.max.cookies.has('pt_session'), 'session de compte posée');
    assert.equal((await a.c.max.get(`/api/groups/${b.gid}`)).status, 200, 'et tous ses groupes avec');
  });

  it('plusieurs PIN (un par groupe) : n’importe lequel ouvre le compte une fois, puis devient son PIN', async () => {
    const a = await setupGroup(srv, ['max']);
    const b = await setupGroup(srv, []);
    await a.c.max.ok('POST', `/api/groups/${b.token}/join`, {});
    await legacy(a.c.max, [a.gid, b.gid], ['1111', '2222']);
    const r = await login(srv.client(), a.token, a.pseudo.max, '2222');
    assert.equal(r.status, 200);
    assert.equal(r.body.unified, true, 'l’interface prévient : c’est désormais ton PIN partout');
    assert.equal((await login(srv.client(), a.token, a.pseudo.max, '1111')).status, 401);
    assert.equal((await login(srv.client(), a.token, a.pseudo.max, '2222')).body.unified, false);
  });
});

describe('supprimer son groupe', () => {
  it('un admin du groupe, en retapant son nom : tout disparaît, les comptes et leurs autres groupes restent', async () => {
    const g = await setupGroup(srv, ['max']);
    const other = await setupGroup(srv, []);
    await g.c.max.ok('POST', `/api/groups/${other.token}/join`, {});
    await createBet(srv, g, { question: 'Ce pari va disparaître ?' });
    const { group } = await g.c.lea.ok('GET', `/api/groups/${g.gid}`);
    assert.equal((await g.c.max.req('DELETE', `/api/groups/${g.gid}`, { body: { confirm: group.name } })).status, 403, 'un simple membre non');
    const wrong = await g.c.lea.req('DELETE', `/api/groups/${g.gid}`, { body: { confirm: 'Pas le bon nom' } });
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'Retape exactement le nom du groupe pour confirmer.']);
    assert.equal((await g.c.lea.get(`/api/groups/${g.gid}`)).status, 200, 'rien n’a bougé');
    await g.c.lea.ok('DELETE', `/api/groups/${g.gid}`, { confirm: `  ${group.name.toUpperCase()} ` });
    assert.equal((await g.c.lea.get(`/api/groups/${g.gid}`)).status, 404);
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}`)).status, 404, 'pour tous ses membres');
    assert.equal((await g.c.max.get(`/api/groups/${other.gid}`)).status, 200, 'ses autres groupes restent');
    assert.deepEqual((await g.c.lea.ok('GET', '/api/account')).groups.map((x) => x.id), [], 'son compte reste, sans ce groupe');
    const log = srv.deps.db.prepare("SELECT summary FROM admin_log WHERE action = 'group_deleted' ORDER BY at DESC LIMIT 1").get();
    assert.match(log.summary, /supprimé par son admin/, 'l’admin du site le voit dans son journal');
  });
});
