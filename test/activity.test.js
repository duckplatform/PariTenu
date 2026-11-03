// La page Activité : fil regroupé (pronostics d'une même personne, résultats en cartes, plusieurs résultats d'une même
// compétition le même jour en une seule) et « À la une » (depuis 24 h).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { betUrl, createBet, DAY, HOUR, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const activity = (g, who = 'max') => g.c[who].ok('GET', `/api/groups/${g.gid}/activity`);
const pick = (g, who, b, label) => g.c[who].ok('POST', betUrl(g, b.betId, 'pick'), { optionId: b.opt[label] });

/** Clôture, verdict de Léa (l'arbitre), puis 24 h de validation : le pari est réglé. */
async function settle(g, b, winner) {
  srv.clock.advance(HOUR);
  await g.c.lea.ok('POST', betUrl(g, b.betId, 'resolve'), { optionId: b.opt[winner] });
  srv.clock.advance(DAY);
}

describe('page Activité', () => {
  it('les pronostics d’une même personne ensemble (changement d’avis compris) ; un résultat en carte, avec les points de chacun', async () => {
    const g = await setupGroup(srv, ['max', 'tom', 'ines']);
    const late = await createBet(srv, g, { question: 'Julien arrive après 20 h 15 ?' });
    const rain = await createBet(srv, g, { question: 'Il pleut samedi ?' });
    await pick(g, 'max', late, 'Oui');
    await pick(g, 'max', rain, 'Non');
    await pick(g, 'max', late, 'Non'); // il change d'avis
    await pick(g, 'tom', late, 'Oui');
    await pick(g, 'ines', late, 'Oui');
    let { items, highlights } = await activity(g);
    assert.equal(highlights, null, 'rien de réglé : pas de « À la une »');
    const maxPicks = items.filter((i) => i.kind === 'picks' && i.memberId === g.id.max);
    assert.equal(maxPicks.length, 1, 'un seul élément pour ses trois pronostics');
    assert.deepEqual(maxPicks[0].picks.map((p) => [p.question, p.label, p.changed]), [['Julien arrive après 20 h 15 ?', 'Non', true], ['Il pleut samedi ?', 'Non', false]]);

    await settle(g, late, 'Non');
    ({ items, highlights } = await activity(g));
    const result = items.find((i) => i.kind === 'result' && i.betId === late.betId);
    assert.deepEqual([result.question, result.winning, result.odds, result.ranking.label], ['Julien arrive après 20 h 15 ?', 'Non', 3, 'Vie du groupe']);
    assert.deepEqual(result.gains, [{ memberId: g.id.max, amount: 300 }]);
    assert.deepEqual(result.missed.sort(), [g.id.tom, g.id.ines].sort());
    assert.equal(result.prime.memberId, g.id.lea, 'la prime de l’arbitre');
    assert.ok(!items.some((i) => i.kind === 'line' && i.event.type === 'closed'), 'la clôture automatique ne s’affiche pas');

    // « À la une » : le pari réglé, les gains, le coup de flair (Max seul contre tous, cote ×3), le leader.
    assert.equal(highlights.settled, 1);
    assert.deepEqual(highlights.gains[0], { memberId: g.id.max, amount: 300 });
    assert.deepEqual([highlights.flair.memberIds, highlights.flair.label, highlights.flair.odds, highlights.flair.amount], [[g.id.max], 'Non', 3, 300]);
    assert.deepEqual(highlights.leaders.map((l) => [l.label, l.memberId, l.change]), [['Vie du groupe', g.id.max, false]], 'premier leader : il n’a doublé personne');

    // Un jour plus tard : plus rien « à la une », le résultat reste dans le fil.
    srv.clock.advance(DAY);
    ({ items, highlights } = await activity(g));
    assert.equal(highlights, null);
    assert.ok(items.some((i) => i.kind === 'result' && i.betId === late.betId));
  });

  it('plusieurs résultats d’une compétition le même jour : une seule carte avec le bilan de chacun ; qui passe en tête', async () => {
    const g = await setupGroup(srv, ['max', 'tom']);
    const first = await createBet(srv, g, { question: 'Premier pari du jour ?' });
    await pick(g, 'tom', first, 'Oui');
    await pick(g, 'max', first, 'Non');
    await settle(g, first, 'Oui');
    srv.clock.advance(DAY); // Tom mène depuis la veille
    const bets = [];
    for (const question of ['Pari numéro un ?', 'Pari numéro deux ?', 'Pari numéro trois ?']) {
      const b = await createBet(srv, g, { question });
      await pick(g, 'max', b, 'Oui');
      await pick(g, 'tom', b, 'Non');
      bets.push(b);
    }
    srv.clock.advance(HOUR);
    for (const b of bets) await g.c.lea.ok('POST', betUrl(g, b.betId, 'resolve'), { optionId: b.opt.Oui });
    srv.clock.advance(DAY);
    const { items, highlights } = await activity(g);
    const card = items.find((i) => i.kind === 'results');
    assert.ok(card, items.map((i) => i.kind).join(', '));
    assert.deepEqual(card.results.map((r) => r.question).sort(), ['Pari numéro deux ?', 'Pari numéro trois ?', 'Pari numéro un ?']);
    assert.deepEqual(card.players.map((p) => [p.memberId, p.won, p.played, p.points]), [[g.id.max, 3, 3, 600], [g.id.tom, 0, 3, 0]]);
    assert.ok(!items.some((i) => i.kind === 'result' && bets.some((b) => b.betId === i.betId)), 'pas en plus, une par une');
    assert.deepEqual(highlights.leaders.map((l) => [l.memberId, l.change]), [[g.id.max, true]], 'Max dépasse Tom');
  });
});

describe('commentaires désactivés par le groupe', () => {
  it('plus de commentaire possible, et ceux d’avant disparaissent du fil ; réactivés, ils reviennent', async () => {
    const g = await setupGroup(srv, ['max']);
    const b = await createBet(srv, g, { question: 'On commente ou pas ?' });
    await g.c.max.ok('POST', betUrl(g, b.betId, 'comments'), { body: 'Facile, oui !' });
    const has = async () => (await activity(g)).items.some((i) => i.kind === 'comment');
    const inFeed = async () => (await g.c.max.ok('GET', `/api/groups/${g.gid}/feed`)).events.some((e) => e.type === 'commented');
    assert.equal(await has(), true);
    assert.equal((await g.c.max.patch(`/api/groups/${g.gid}/settings`, { comments: false })).status, 403, 'réservé aux admins du groupe');
    await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { comments: false });
    const refused = await g.c.max.post(betUrl(g, b.betId, 'comments'), { body: 'Et maintenant ?' });
    assert.deepEqual([refused.status, refused.body.error], [403, 'Les commentaires sont désactivés dans ce groupe.']);
    assert.equal(await has(), false, 'page Activité');
    assert.equal(await inFeed(), false, 'colonne de l’accueil');
    assert.equal((await g.c.max.ok('GET', `/api/groups/${g.gid}`)).settings.comments, false, 'l’app sait qu’ils sont désactivés (fiche d’un pari)');
    await g.c.lea.ok('PATCH', `/api/groups/${g.gid}/settings`, { comments: true });
    assert.equal(await has(), true, 'rien n’a été effacé');
  });
});
