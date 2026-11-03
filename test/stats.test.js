import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { naturalSeason } from '../src/core/seasons.js';
import { betUrl, createBet, DAY, HOUR, plain, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

/** Joue un pari complet : pronostics, clôture, verdict, validation. */
async function play(g, { winner, picks, arbiter = 'lea', kind = 'yesno', options, question } = {}) {
  const b = await createBet(srv, g, { arbiter: arbiter === 'lea' ? undefined : arbiter, kind, options, question: question ?? 'Un pari pour le test ?' });
  for (const [who, label] of Object.entries(picks)) await g.c[who].ok('POST', betUrl(g, b.betId, 'pick'), { optionId: b.opt[label] });
  srv.clock.advance(HOUR);
  await g.c[arbiter].ok('POST', betUrl(g, b.betId, 'resolve'), { optionId: b.opt[winner] });
  srv.clock.advance(24 * HOUR);
  return b;
}

const rankingUrl = (g, key, season) => `/api/groups/${g.gid}/rankings/${encodeURIComponent(key)}${season ? `?season=${season}` : ''}`;
const standings = (season) => season.standings.map((r) => [plain(r.member.pseudo), r.score, r.rank, r.played, r.correct]);

describe('classements par saison', () => {
  it('un classement par catégorie, sur la saison de l’année : score = points, égalités, réussite', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines']);
    await play(g, { winner: 'Non', picks: { max: 'Oui', tom: 'Non', ines: 'Non' } });
    const { rankings } = await g.c.max.ok('GET', `/api/groups/${g.gid}/rankings`);
    const label = naturalSeason(srv.clock.now()).label;
    assert.deepEqual(rankings.map((r) => [r.key, `${r.emoji} ${r.label}`, r.season.label, r.season.state, r.me]),
      [['cat:groupe', '👥 Vie du groupe', label, 'current', { rank: 4, score: 0, of: 4 }]]);
    const { season, seasons } = await g.c.max.ok('GET', rankingUrl(g, 'cat:groupe'));
    assert.deepEqual(standings(season), [['Inès', 150, 1, 1, 1], ['Tom', 150, 1, 1, 1], ['Léa', 20, 3, 0, 0], ['Max', 0, 4, 1, 0]]);
    assert.deepEqual(season.standings.map((r) => r.rate), [1, 1, null, 0]);
    assert.deepEqual([season.bets, season.pending, seasons.length], [1, 0, 1]);
    assert.equal((await g.c.max.get(rankingUrl(g, 'cat:inconnue'))).status, 404);
  });

  it('fin de la vraie saison : champion sacré, classement figé, la saison suivante repart de zéro', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines']);
    const first = naturalSeason(srv.clock.now());
    await play(g, { winner: 'Oui', picks: { max: 'Oui', tom: 'Non', ines: 'Non' } });
    // Un pari qui se termine après la fin de la saison compte dans la saison suivante.
    const late = await createBet(srv, g, { question: 'Encore en cours au changement de saison ?', closesIn: first.endsAt - srv.clock.now() + HOUR });
    await g.c.tom.ok('POST', betUrl(g, late.betId, 'pick'), { optionId: late.opt.Oui });

    srv.clock.set(first.endsAt + HOUR);
    const { rankings } = await g.c.max.ok('GET', `/api/groups/${g.gid}/rankings`);
    const next = naturalSeason(srv.clock.now());
    assert.equal(rankings[0].season.label, next.label, 'la saison en cours est la nouvelle');
    assert.deepEqual(rankings[0].me, null, 'Max n’a pas encore joué cette saison');
    const { season, seasons } = await g.c.max.ok('GET', rankingUrl(g, 'cat:groupe'));
    assert.deepEqual(standings(season), [['Tom', 0, 1, 0, 0]], 'tout repart de zéro');
    assert.deepEqual(seasons.map((x) => [x.label, x.champions]), [[next.label, []], [first.label, [g.id.max]]]);

    const closed = (await g.c.max.ok('GET', rankingUrl(g, 'cat:groupe', seasons[1].id))).season;
    assert.equal(closed.state, 'closed');
    assert.deepEqual(closed.champions, [g.id.max]);
    assert.deepEqual(standings(closed), [['Max', 300, 1, 1, 1], ['Léa', 20, 2, 0, 0], ['Inès', 0, 3, 1, 0], ['Tom', 0, 3, 1, 0]]);
    const { bets } = await g.c.max.ok('GET', `/api/groups/${g.gid}/seasons/${seasons[1].id}/bets`);
    assert.deepEqual(bets.map((b) => b.question), ['Un pari pour le test ?'], 'les paris de la saison restent consultables');

    const { events } = await g.c.max.ok('GET', `/api/groups/${g.gid}/feed`);
    const end = events.find((e) => e.type === 'season_closed');
    assert.deepEqual([end.data.label, end.data.name, end.data.champions, end.data.score], [first.label, 'Vie du groupe', [g.id.max], 300]);
    const { profile } = await g.c.tom.ok('GET', `/api/groups/${g.gid}/members/${g.id.max}`);
    assert.equal(profile.titles, 1);
    assert.ok(profile.badges.some((b) => b.code === `champion:${seasons[1].id}` && b.detail === `👥 Vie du groupe · ${first.label}`));
    srv.clock.reset();
  });

  it('une saison finie attend ses derniers résultats avant de sacrer son champion', async () => {
    const g = await setupGroup(srv, ['max', 'tom']);
    const first = naturalSeason(srv.clock.now());
    const b = await createBet(srv, g, { question: 'Résultat en retard ?', closesIn: first.endsAt - srv.clock.now() - HOUR });
    await g.c.max.ok('POST', betUrl(g, b.betId, 'pick'), { optionId: b.opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, b.betId, 'pick'), { optionId: b.opt.Non });
    srv.clock.set(first.endsAt + HOUR);
    let { season } = await g.c.max.ok('GET', rankingUrl(g, 'cat:groupe'));
    assert.deepEqual([season.label, season.state, season.pending], [first.label, 'ending', 1]);
    await g.c.lea.ok('POST', betUrl(g, b.betId, 'resolve'), { optionId: b.opt.Oui });
    srv.clock.advance(25 * HOUR);
    ({ season } = await g.c.max.ok('GET', rankingUrl(g, 'cat:groupe')));
    assert.deepEqual([season.state, season.champions], ['closed', [g.id.max]]);
    srv.clock.reset();
  });
});

describe('profil et badges', () => {
  it('stats, série, meilleur coup, historique et relevé', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines', 'sam']);
    await play(g, { winner: 'Oui', picks: { max: 'Oui', tom: 'Non', ines: 'Non', sam: 'Non' } }); // Max seul contre 3 : ×4
    await play(g, { winner: 'Non', picks: { max: 'Non', tom: 'Oui' } });
    await play(g, { winner: 'Non', picks: { max: 'Oui', tom: 'Non' } });
    const { profile } = await g.c.tom.ok('GET', `/api/groups/${g.gid}/members/${g.id.max}`);
    assert.deepEqual(profile.seasons.map((x) => [x.key, x.season, x.score, x.rank, x.of]), [['cat:groupe', naturalSeason(srv.clock.now()).label, 600, 1, 5]]);
    assert.equal(profile.titles, 0);
    assert.deepEqual(
      [profile.stats.played, profile.stats.correct, profile.stats.bestOdds, profile.stats.currentStreak, profile.stats.bestStreak],
      [3, 2, 4, 0, 2]);
    assert.ok(profile.badges.some((b) => b.code === 'first_pick'));
    assert.ok(profile.badges.some((b) => b.code === 'lone_wolf'), 'seul à avoir raison à 4');
    assert.deepEqual(profile.history.map((h) => h.correct), [false, true, true]);
    assert.deepEqual(profile.ledger.map((l) => l.amount), [200, 400]);
    const lea = (await g.c.lea.ok('GET', `/api/groups/${g.gid}/members/${g.id.lea}`)).profile;
    assert.equal(lea.stats.arbitrated, 3);
    assert.equal(lea.stats.created, 3);
  });

  it('série de 5, champion et lanterne rouge de la saison (saison close)', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines']);
    for (let i = 0; i < 5; i++) await play(g, { winner: 'Oui', picks: { max: 'Oui', tom: 'Non', ines: i ? 'Non' : 'Oui' } });
    srv.clock.set(naturalSeason(srv.clock.now()).endsAt + DAY);
    const { profile } = await g.c.max.ok('GET', `/api/groups/${g.gid}/members/${g.id.max}`);
    const codes = profile.badges.map((b) => b.code);
    assert.ok(codes.includes('streak5'));
    assert.ok(codes.some((c) => c.startsWith('champion:')));
    const tom = (await g.c.max.ok('GET', `/api/groups/${g.gid}/members/${g.id.tom}`)).profile;
    assert.ok(tom.badges.some((b) => b.code.startsWith('lantern:')), 'Tom finit dernier de la saison (3 joueurs classés ou plus)');
    srv.clock.reset();
  });

  it('paris en cours visibles sur le profil', async () => {
    const g = await setupGroup(srv, ['max']);
    const b = await createBet(srv, g, { question: 'Encore ouvert ?' });
    await g.c.max.ok('POST', betUrl(g, b.betId, 'pick'), { optionId: b.opt.Oui });
    const { profile } = await g.c.lea.ok('GET', `/api/groups/${g.gid}/members/${g.id.max}`);
    assert.deepEqual(profile.openPicks.map((p) => [p.question, p.optionLabel, p.status]), [['Encore ouvert ?', 'Oui', 'open']]);
  });
});

describe('fil d’activité et liste', () => {
  it('raconte la vie du groupe, du plus récent au plus ancien', async () => {
    const g = await setupGroup(srv, ['max', 'tom']);
    await play(g, { winner: 'Oui', picks: { max: 'Oui', tom: 'Non' } });
    const { events } = await g.c.max.ok('GET', `/api/groups/${g.gid}/feed`);
    assert.deepEqual(events.map((e) => e.type), ['settled', 'resolved', 'closed', 'picked', 'picked', 'created', 'member_joined', 'member_joined', 'group_created']);
    assert.equal(events[0].question, 'Un pari pour le test ?');
    assert.deepEqual(events[0].data.winners, [g.id.max]);
  });

  it('les paris terminés depuis plus de 30 jours sortent de la liste (mais pas de ?all=1)', async () => {
    const g = await setupGroup(srv, ['max', 'tom']);
    await play(g, { winner: 'Oui', picks: { max: 'Oui', tom: 'Non' } });
    assert.equal((await g.c.max.ok('GET', `/api/groups/${g.gid}/bets`)).bets.length, 1);
    srv.clock.advance(31 * DAY);
    assert.equal((await g.c.max.ok('GET', `/api/groups/${g.gid}/bets`)).bets.length, 0);
    assert.equal((await g.c.max.ok('GET', `/api/groups/${g.gid}/bets?all=1`)).bets.length, 1);
    srv.clock.reset();
  });
});
