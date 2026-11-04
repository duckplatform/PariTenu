// Paris de sport visuels : équipes et pilotes (logos, photos, couleurs), score en direct puis final, relais d'images.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pngSize } from '../src/lib/png.js';
import { betUrl, coupon, HOUR, MINUTE, joinCompetitions, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

async function fresh(fn) {
  const s = await startServer();
  try {
    await fn(s);
  } finally {
    await s.stop();
  }
}

const enable = async (s, g, sources) => {
  await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { sources });
  await joinCompetitions(g.c.lea, g.gid); // personne n'y est inscrit d'office : Léa dit « Je participe »
  return s.deps.sources.autoOpen(g.gid);
};
const listBets = async (g, who = 'lea') => (await g.c[who].ok('GET', `/api/groups/${g.gid}/bets`)).bets;
const find = async (g, question, who = 'lea') => (await listBets(g, who)).find((b) => b.question === question);
const LIGUE_1 = { foot: { competitions: ['fra.1'] } };
/** Le relais d'images pour une adresse de source (comme mediaUrl côté serveur). */
const media = (url) => `/media/${Buffer.from(url).toString('base64url')}`;

describe('paris de sport visuels', () => {
  it('un match porte ses deux équipes (nom, logo relayé, couleur) ; chaque option sait à qui elle se rapporte', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const bet = await find(g, 'Football · Ligue 1 · Lille – Lens');
    assert.equal(bet.event.layout, 'versus');
    assert.deepEqual(bet.event.competitors.map((c) => [c.key, c.name, c.abbr, c.color]), [['home', 'Lille', 'LIL', '#e01e13'], ['away', 'Lens', 'LEN', '#ffcc00']]);
    assert.equal(bet.event.competitors[0].img, media('https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/lille.png&w=96&h=96'));
    assert.deepEqual(bet.options.map((o) => o.key), ['home', 'draw', 'away']);
    assert.equal(bet.event.live, null, 'pas encore commencé');
    // Le logo passe par l'app (jamais d'appel du navigateur chez ESPN), gardé une semaine par le navigateur.
    const logo = await g.c.max.req('GET', bet.event.competitors[0].img, { raw: true });
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.match(logo.headers.get('cache-control'), /max-age=604800/);
    // Un pari maison n'a pas de rencontre.
    assert.equal((await g.c.lea.ok('POST', `/api/groups/${g.gid}/bets`, { question: 'Max arrive à l’heure ?', category: 'groupe', kind: 'yesno', closesAt: s.clock.now() + HOUR })).id != null, true);
    assert.equal((await find(g, 'Max arrive à l’heure ?')).event, null);
  }));

  it('score en direct pendant le match, chaque minute, une requête par tableau pour tous les groupes ; puis score final', () => fresh(async (s) => {
    const kickoff = Math.ceil((s.clock.now() + 20 * MINUTE) / MINUTE) * MINUTE;
    s.upstream.addMatch({ id: '9003', path: 'soccer/fra.1', at: kickoff, home: 'Lyon', away: 'Nice' });
    const g = await setupGroup(s, ['max']);
    const lea2 = { gid: (await g.c.lea.ok('POST', '/api/groups', { name: 'Bureau', emoji: '💼', coupon: coupon(s) })).groupId, c: { lea: g.c.lea } };
    await enable(s, g, LIGUE_1);
    await enable(s, lea2, LIGUE_1);
    assert.equal(await s.deps.sources.refreshLive(), 0, 'rien ne se joue encore');
    // Un pari que personne n'a joué disparaît à la clôture : Léa parie (son prono vaut dans ses deux groupes).
    const open = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    await g.c.lea.ok('POST', betUrl(g, open.id, 'pick'), { optionId: open.options[0].id });

    s.clock.advance(kickoff + 30 * MINUTE - s.clock.now());
    s.deps.bets.sweepAll();
    s.upstream.play('9003', 1, 0, "29'", 'STATUS_FIRST_HALF');
    const boards = () => s.upstream.calls.filter((u) => u.includes('fra.1/scoreboard')).length;
    const before = boards();
    assert.equal(await s.deps.sources.refreshLive(), 1, 'le même match dans deux groupes : une seule rencontre');
    assert.ok(boards() - before <= 2, 'un tableau du jour (au plus deux jours candidats)');
    let bet = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    assert.deepEqual(bet.event.live, { state: 'in', clock: "29'", scores: { home: 1, away: 0 } });
    assert.deepEqual((await find(lea2, 'Football · Ligue 1 · Lyon – Nice')).event.live.scores, { home: 1, away: 0 }, 'le même direct dans l’autre groupe');

    // Relu au plus une fois par minute ; la mi-temps s'affiche en français.
    s.upstream.play('9003', 1, 1, "45'+2'", 'STATUS_HALFTIME');
    assert.equal(await s.deps.sources.refreshLive(), 0, 'trop tôt');
    s.clock.advance(MINUTE);
    await s.deps.sources.refreshLive();
    bet = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    assert.deepEqual([bet.event.live.clock, bet.event.live.scores], ['Mi-temps', { home: 1, away: 1 }]);

    // Fin du match : le score final reste, même avant que le résultat ne soit validé.
    s.upstream.finish('9003', 2, 1);
    s.clock.advance(MINUTE);
    await s.deps.sources.refreshLive();
    bet = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    assert.deepEqual(bet.event.live, { state: 'post', clock: 'Terminé', scores: { home: 2, away: 1 }, winner: 'home' });
    s.clock.advance(MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 0, 'score final connu : on ne le redemande plus');
  }));

  it('le score final arrive aussi avec le résultat du pari (réglé aussitôt)', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const bet = await find(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.max.ok('POST', betUrl(g, bet.id, 'pick'), { optionId: bet.options[2].id });
    s.upstream.finish('9001', 0, 3);
    s.clock.advance(s.upstream.match('9001').at + 3 * HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    const { bet: done } = await g.c.max.ok('GET', betUrl(g, bet.id));
    assert.equal(done.status, 'settled');
    assert.deepEqual(done.event.live, { state: 'post', clock: 'Terminé', scores: { home: 0, away: 3 }, winner: 'away' });
  }));

  it('buts, cartons et statistiques en direct ; gardés quand le résultat arrive, relus une dernière fois si besoin', () => fresh(async (s) => {
    const kickoff = Math.ceil((s.clock.now() + 20 * MINUTE) / MINUTE) * MINUTE;
    s.upstream.addMatch({ id: '9004', path: 'soccer/fra.1', at: kickoff, home: 'Lyon', away: 'Nice' });
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const open = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    await g.c.max.ok('POST', betUrl(g, open.id, 'pick'), { optionId: open.options[0].id });

    s.clock.advance(kickoff + 30 * MINUTE - s.clock.now());
    s.deps.bets.sweepAll();
    s.upstream.play('9004', 1, 0, "29'", 'STATUS_FIRST_HALF');
    const first = [["12'", 'home', 'Goal', 'A. Lacazette', 'R. Cherki'], ["25'", 'away', 'Yellow Card', 'D. Ndayishimiye']];
    s.upstream.facts('9004', { details: first, statistics: { possessionPct: [58.4, 41.6], totalShots: [7, 3] } });
    await s.deps.sources.refreshLive();
    let bet = await find(g, 'Football · Ligue 1 · Lyon – Nice');
    assert.deepEqual(bet.event.live.events.map((e) => [e.t, e.side, e.kind, e.who]), [["12'", 'home', 'goal', 'A. Lacazette'], ["25'", 'away', 'yellow', 'D. Ndayishimiye']]);
    assert.deepEqual(bet.event.live.stats.map((x) => [x.label, x.home, x.away]), [['Possession', 58.4, 41.6], ['Tirs', 7, 3], ['Cartons jaunes', 0, 1]]);
    assert.deepEqual(bet.event.live.events[0].assists, ['R. Cherki'], 'le passeur, lu dans le résumé du match');

    // Le résultat arrive avant que le direct ait vu la fin du match : il est relu une dernière fois (sinon les buts de la
    // fin manqueraient, et le résumé lu pour le résultat n'a ni buts ni cartons).
    s.upstream.facts('9004', { details: [...first, ["67'", 'away', 'Penalty - Scored', 'T. Moffi'], ["88'", 'home', 'Goal', 'R. Cherki', 'C. Tolisso'], ["90'+2'", 'away', 'Red Card', 'D. Ndayishimiye']], statistics: { possessionPct: [55, 45], totalShots: [14, 9] } });
    s.upstream.finish('9004', 2, 1);
    s.clock.advance(kickoff + 3 * HOUR - s.clock.now());
    await s.deps.sources.checkDue();
    ({ bet } = await g.c.max.ok('GET', betUrl(g, open.id)));
    assert.equal(bet.status, 'settled');
    assert.deepEqual([bet.event.live.state, bet.event.live.scores], ['post', { home: 2, away: 1 }]);
    assert.deepEqual(bet.event.live.events.map((e) => [e.t, e.kind, e.who, e.note]).slice(2), [["67'", 'goal', 'T. Moffi', 'pen'], ["88'", 'goal', 'R. Cherki', null], ["90'+2'", 'red', 'D. Ndayishimiye', null]]);
    assert.deepEqual(bet.event.live.stats.find((x) => x.label === 'Tirs'), { label: 'Tirs', home: 14, away: 9, pct: false });
    assert.deepEqual(bet.event.live.events.filter((e) => e.assists).map((e) => [e.who, e.assists]), [['A. Lacazette', ['R. Cherki']], ['R. Cherki', ['C. Tolisso']]]);
  }));

  it('un match lu avant les passeurs (faits d’avant le 2026-11-01) est relu une fois pour eux', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const open = await find(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.max.ok('POST', betUrl(g, open.id, 'pick'), { optionId: open.options[0].id });
    s.upstream.facts('9001', { details: [["50'", 'home', 'Goal', 'J. David', 'A. Gomes']] });
    s.upstream.finish('9001', 1, 0);
    s.clock.advance(s.upstream.match('9001').at + 3 * HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    // Le direct tel que l'écrivait la version d'avant : les buts, sans passeur ni version des faits.
    s.deps.live.saveLive('foot:9001:1x2', { state: 'post', clock: 'Terminé', scores: { home: 1, away: 0 }, winner: 'home', events: [{ t: "50'", side: 'home', kind: 'goal', who: 'J. David', note: null }] });
    s.clock.advance(15 * MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 1);
    const live = (await find(g, 'Football · Ligue 1 · Lille – Lens')).event.live;
    assert.deepEqual(live.events.map((e) => [e.who, e.assists]), [['J. David', ['A. Gomes']]]);
    assert.equal(live.factsRead, undefined, 'marque interne, pas pour l’app');
    s.clock.advance(20 * MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 0, 'relu une seule fois');
  }));

  it('un match réglé sans ses faits (fini avant qu’on les lise) est relu une fois ; sans faits chez la source, plus jamais', () => fresh(async (s) => {
    const at = s.upstream.match('9001').at;
    s.upstream.addMatch({ id: '9005', path: 'soccer/fra.1', at, home: 'Lyon', away: 'Nice' });
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    for (const question of ['Football · Ligue 1 · Lille – Lens', 'Football · Ligue 1 · Lyon – Nice']) {
      const bet = await find(g, question);
      await g.c.max.ok('POST', betUrl(g, bet.id, 'pick'), { optionId: bet.options[0].id });
    }
    // Les deux résultats arrivent sans que le direct ait jamais lu ces matchs (comme ceux finis avant la mise en ligne).
    s.upstream.finish('9001', 2, 0);
    s.upstream.finish('9005', 1, 1);
    s.clock.advance(at + 3 * HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    const live = async (question) => (await find(g, question)).event.live;
    assert.equal((await live('Football · Ligue 1 · Lyon – Nice')).events, undefined);

    // ESPN a les faits de Lyon – Nice, pas ceux de Lille – Lens : une seule relecture de chacun.
    s.upstream.facts('9005', { details: [["9'", 'home', 'Goal', 'A. Lacazette'], ["90'", 'away', 'Goal', 'T. Moffi']], statistics: { totalShots: [12, 8] } });
    s.clock.advance(MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 2);
    assert.deepEqual((await live('Football · Ligue 1 · Lyon – Nice')).events.map((e) => [e.t, e.who]), [["9'", 'A. Lacazette'], ["90'", 'T. Moffi']]);
    assert.deepEqual(await live('Football · Ligue 1 · Lille – Lens'), { state: 'post', clock: 'Terminé', scores: { home: 2, away: 0 }, winner: 'home' });
    s.upstream.facts('9001', { details: [["50'", 'home', 'Goal', 'J. David']] });
    s.clock.advance(20 * MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 0, 'plus rien à relire');
  }));

  it('Grand Prix moto : photos des pilotes recadrées sur le visage, couleur et numéro ; podium à l’arrivée', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, { moto: { competitions: ['motogp'] } });
    const race = (await listBets(g)).find((b) => /^Moto · MotoGP · Grand Prix de Malaisie$/.test(b.question));
    assert.equal(race.event.layout, 'field');
    await g.c.max.ok('POST', betUrl(g, race.id, 'pick'), { optionId: race.options[0].id });
    const marquez = race.event.competitors.find((c) => c.name === 'Marc Marquez');
    assert.deepEqual([marquez.number, marquez.color, marquez.team], [93, '#ad0000', 'Équipe 1']);
    assert.match(marquez.img, /^\/media\//);
    assert.equal(race.options.find((o) => o.label === 'Marc Marquez').key, marquez.key);
    // La photo en pied (600 × 900) arrive réduite et recadrée : un carré de 160 pixels.
    const photo = await g.c.max.req('GET', marquez.img, { raw: true });
    const body = Buffer.from(await photo.arrayBuffer());
    assert.deepEqual(pngSize(body), { width: 160, height: 160 });

    // Arrivée : le podium s'affiche avec le résultat.
    const order = ['Marco Bezzecchi', 'Marc Marquez', 'Pedro Acosta'].map((n) => s.upstream.rider(n));
    s.upstream.motoResults.RAC = order;
    s.clock.advance(s.upstream.gp.race + 2 * HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    const { bet } = await g.c.lea.ok('GET', betUrl(g, race.id));
    assert.deepEqual(bet.event.live.podium.map((p) => p.name), ['Marco Bezzecchi', 'Marc Marquez', 'Pedro Acosta']);
  }));

  it('Formule 1 et tennis : photos ou drapeaux (OpenF1, ESPN)', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, { f1: { competitions: ['f1'] }, tennis: { competitions: ['atp'] } });
    const bets = await listBets(g);
    const f1 = bets.find((b) => b.question === 'Formule 1 · Mexico City · Autódromo Hermanos Rodríguez');
    assert.ok(f1.event.competitors.every((c) => c.img?.startsWith('/media/') && /^#[0-9a-f]{6}$/.test(c.color)), 'photo et couleur d’écurie');
    const tennis = bets.find((b) => /Sinner – Carlos Alcaraz/.test(b.question));
    const [sinner] = tennis.event.competitors;
    assert.equal(sinner.name, 'Jannik Sinner');
    assert.match(sinner.flag, /^\/media\//);
    assert.equal((await g.c.max.req('GET', sinner.img, { raw: true })).status, 404, 'pas de photo chez ESPN : l’app montre le drapeau');
    assert.equal((await g.c.max.req('GET', sinner.flag, { raw: true })).status, 200);
  }));
});

describe('relais d’images', () => {
  it('seules les images des sources connues passent', async () => {
    const c = srv.client();
    for (const url of ['https://evil.example.com/x.png', 'http://a.espncdn.com/i/teamlogos/soccer/500/lille.png', 'https://a.espncdn.com/apis/site/v2/sports']) {
      assert.equal((await c.req('GET', media(url), { raw: true })).status, 404, url);
    }
    assert.equal((await c.req('GET', '/media/%%%', { raw: true })).status, 400, 'adresse illisible');
    const calls = srv.upstream.calls.length;
    assert.equal((await c.req('GET', media('https://evil.example.com/x.png'), { raw: true })).status, 404);
    assert.equal(srv.upstream.calls.length, calls, 'aucun appel vers une adresse inconnue');
  });
});

describe('🏓 padel (Padel API, clé personnelle)', () => {
  const PADEL = { padel: { competitions: ['men', 'women'] } };

  it('sans clé, le padel n’est pas proposé', () => fresh(async (s) => {
    const g = await setupGroup(s, []);
    assert.ok((await g.c.lea.ok('GET', `/api/groups/${g.gid}/sources`)).sources.some((x) => x.id === 'padel'));
  }).then(async () => {
    const s = await startServer({ PT_PADEL_TOKEN: '' });
    try {
      const g = await setupGroup(s, []);
      assert.ok(!(await g.c.lea.ok('GET', `/api/groups/${g.gid}/sources`)).sources.some((x) => x.id === 'padel'));
    } finally {
      await s.stop();
    }
  }));

  it('un pari par match du tableau principal, les deux paires face à face ; sets en direct ; résultat', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    assert.equal(await enable(s, g, PADEL), 2, 'un match messieurs, un match dames');
    const bets = await listBets(g);
    const semi = bets.find((b) => b.question === 'Padel · Kuwait Major, demi-finale · Coello / Tapia – Galán / Chingotto');
    assert.ok(semi, bets.map((b) => b.question).join(' | '));
    assert.deepEqual(semi.options.map((o) => [o.key, o.label]), [['team_1', 'Coello / Tapia'], ['team_2', 'Galán / Chingotto']]);
    assert.deepEqual(semi.event.competitors.map((c) => [c.key, c.name, c.abbr]), [['team_1', 'Coello / Tapia', 'CT'], ['team_2', 'Galán / Chingotto', 'GC']]);
    assert.equal(semi.closesAt, s.upstream.padel.matches[0].at, 'heure de Madrid (comme Paris) bien lue');
    assert.deepEqual([semi.ranking.label, semi.scoring], ['Premier Padel (messieurs)', 'fixed']);
    assert.deepEqual([semi.source.url, semi.source.site, semi.source.name], ['https://fr.fantasypadeltour.com/match/90001/match-de-test', 'Fantasy Padel Tour', 'Padel API'], 'le lien : la page du match, en français');
    await g.c.max.ok('POST', betUrl(g, semi.id, 'pick'), { optionId: semi.options[1].id });

    // Le match se joue : un set à zéro pour Coello / Tapia, deuxième set en cours.
    s.clock.advance(s.upstream.padel.matches[0].at + HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    s.upstream.padelPlay(90001, [[6, 4], [2, 1]]);
    assert.equal(await s.deps.sources.refreshLive(), 1);
    let bet = await find(g, semi.question);
    assert.deepEqual(bet.event.live, { state: 'in', clock: '2e set', sets: { team_1: [6, 2], team_2: [4, 1] }, scores: { team_1: 1, team_2: 0 } });

    // Galán / Chingotto renversent le match en trois sets.
    s.upstream.padelFinish(90001, 'team_2', [[6, 4], [3, 6], [5, 7]]);
    s.clock.advance(3 * HOUR);
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    const { bet: done } = await g.c.max.ok('GET', betUrl(g, semi.id));
    assert.equal(done.status, 'settled');
    assert.equal(done.resolutionNote, 'Vainqueurs : Galán / Chingotto (6-4 3-6 5-7)');
    assert.deepEqual([done.event.live.scores, done.event.live.winner], [{ team_1: 1, team_2: 2 }, 'team_2']);
  }));

  it('« Terminé » sans les sets : on relit le match jusqu’au score final', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, PADEL);
    const semi = (await listBets(g)).find((b) => b.question.startsWith('Padel · Kuwait Major, demi-finale'));
    await g.c.max.ok('POST', betUrl(g, semi.id, 'pick'), { optionId: semi.options[0].id });
    s.clock.advance(s.upstream.padel.matches[0].at + HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    // L'offre gratuite annonce la fin du match avant de donner le score (vu le 2026-10-31 : 1 h 45 d'écart).
    s.upstream.padelFinish(90001, null, []);
    assert.equal(await s.deps.sources.refreshLive(), 1);
    assert.deepEqual((await find(g, semi.question)).event.live, { state: 'post', clock: 'Terminé' });
    s.upstream.padelFinish(90001, 'team_1', [[6, 1], [6, 1]]);
    s.clock.advance(MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 1, 'pas encore de score final : relu');
    assert.deepEqual((await find(g, semi.question)).event.live,
      { state: 'post', clock: 'Terminé', sets: { team_1: [6, 6], team_2: [1, 1] }, scores: { team_1: 2, team_2: 0 }, winner: 'team_1' });
    s.clock.advance(MINUTE);
    assert.equal(await s.deps.sources.refreshLive(), 0, 'score final connu : on ne le redemande plus');
  }));

  it('forfait avant le match : pari annulé', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, PADEL);
    const final = (await listBets(g)).find((b) => b.question.startsWith('Padel · Kuwait Major, finale'));
    await g.c.max.ok('POST', betUrl(g, final.id, 'pick'), { optionId: final.options[0].id });
    s.upstream.padelFinish(90002, null, [], 'walkover');
    s.clock.advance(s.upstream.padel.matches[1].at + 4 * HOUR - s.clock.now());
    s.deps.bets.sweepAll();
    await s.deps.sources.checkDue();
    const { bet } = await g.c.max.ok('GET', betUrl(g, final.id));
    assert.deepEqual([bet.status, bet.cancelReason], ['cancelled', 'source']);
  }));

  it('heures et scores sous toutes leurs formes', async () => {
    const { matchTime, setsOf } = await import('../src/sources/padel.js');
    assert.equal(matchTime({ scheduled_at: '2026-11-01 18:30:00' }), Date.parse('2026-11-01T17:30:00Z'), 'heure de Madrid en hiver');
    assert.equal(matchTime({ scheduled_at: '2026-07-01 18:30' }), Date.parse('2026-07-01T16:30:00Z'), 'heure de Madrid en été');
    assert.equal(matchTime({ scheduled_at: '2026-11-01T18:30:00+01:00' }), Date.parse('2026-11-01T17:30:00Z'));
    assert.ok(Number.isNaN(matchTime({ scheduled_at: null })));
    assert.deepEqual(setsOf('6-4 3-6 7-6(5)'), { team_1: [6, 3, 7], team_2: [4, 6, 6] });
    assert.deepEqual(setsOf([{ team_1: '7(5)', team_2: '6' }]), { team_1: [7], team_2: [6] });
    assert.equal(setsOf('hidden_free_plan'), null);
  });
});
