import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { betUrl, createBet, DAY, HOUR, MINUTE, setupGroup, startServer } from './helpers.js';

let srv;
let g;
before(async () => { srv = await startServer(); });
after(() => srv.stop());
beforeEach(async () => { g = await setupGroup(srv, ['max', 'tom', 'ines', 'sam']); });

const detail = async (who, betId) => (await g.c[who].ok('GET', betUrl(g, betId))).bet;
const pick = (who, betId, optionId) => g.c[who].post(betUrl(g, betId, 'pick'), { optionId });
const advance = (ms) => srv.clock.advance(ms);
/** Les points d'un membre : la somme de son relevé (corrections comprises). */
const scoreOf = async (who) => (await g.c[who].ok('GET', `/api/groups/${g.gid}/members/${g.id[who]}`)).profile.ledger.reduce((s, l) => s + l.amount, 0);

describe('créer un pari', () => {
  it('Oui/Non : deux options déjà remplies, statut ouvert, créateur arbitre par défaut', async () => {
    const { betId, opt } = await createBet(srv, g);
    assert.deepEqual(Object.keys(opt), ['Oui', 'Non']);
    const bet = await detail('max', betId);
    assert.equal(bet.status, 'open');
    assert.equal(bet.arbiterId, g.id.lea);
    assert.equal(bet.can.pick, true);
    assert.equal((await detail('lea', betId)).can.pick, false, 'l’arbitre ne parie pas');
  });

  it('refuse les entrées invalides avec un message lisible', async () => {
    const now = srv.clock.now();
    const base = { question: 'Une vraie question ?', category: 'groupe', kind: 'yesno', closesAt: now + HOUR };
    const post = (body) => g.c.lea.post(`/api/groups/${g.gid}/bets`, { ...base, ...body });
    const cases = [
      [{ question: 'Hm' }, 'La question fait au moins 5 caractères.'],
      [{ question: 'x'.repeat(141) }, 'La question fait au plus 140 caractères.'],
      [{ category: 'inconnue' }, 'Choisis une catégorie de la liste.'],
      [{ closesAt: now + MINUTE }, 'La clôture doit être au moins 5 minutes plus tard.'],
      [{ closesAt: now + 400 * DAY }, 'La clôture ne peut pas être dans plus d’un an.'],
      [{ expectedAt: now + 30 * MINUTE }, 'Le résultat est attendu après la clôture des pronostics.'],
      [{ kind: 'multi', options: ['Seul'] }, 'Il faut entre 2 et 8 options.'],
      [{ kind: 'multi', options: Array.from({ length: 9 }, (_, i) => `O${i}`) }, 'Il faut entre 2 et 8 options.'],
      [{ kind: 'multi', options: ['Léa', 'léa'] }, 'Deux options ont le même nom.'],
      [{ arbiterId: 'personne' }, "L'arbitre doit être un membre du groupe."],
    ];
    for (const [body, message] of cases) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error, message);
    }
  });

  it('choix multiples : les options gardent leur ordre', async () => {
    const { opt } = await createBet(srv, g, { question: 'Qui gagne Koh-Lanta ?', kind: 'multi', options: [' Laura ', 'Teddy', '', 'Bastien'] });
    assert.deepEqual(Object.keys(opt), ['Laura', 'Teddy', 'Bastien']);
  });
});

describe('parier', () => {
  it('une option à la fois, changement d’avis jusqu’à la clôture, plus rien après', async () => {
    const { betId, opt } = await createBet(srv, g);
    assert.equal((await pick('max', betId, opt.Oui)).status, 200);
    assert.equal((await pick('max', betId, opt.Non)).status, 200, 'il change d’avis');
    assert.equal((await pick('max', betId, opt.Non)).status, 200, 'le même choix : rien ne change');
    const bet = await detail('max', betId);
    assert.deepEqual([bet.myPick, bet.participants, bet.can.pick], [opt.Non, 1, true]);
    assert.deepEqual(bet.options.map((o) => [o.label, o.count]), [['Oui', 0], ['Non', 1]]);
    assert.deepEqual(bet.events.filter((e) => e.type.startsWith('pick')).map((e) => [e.type, e.data.label, e.data.from]),
      [['picked', 'Oui', undefined], ['pick_changed', 'Non', 'Oui']], 'le fil raconte le changement d’avis');
    assert.equal((await pick('tom', betId, 'inconnue')).status, 400);
    assert.equal((await pick('lea', betId, opt.Oui)).status, 403);
    advance(HOUR + 1000);
    const late = await pick('max', betId, opt.Oui);
    assert.equal(late.status, 409);
    assert.equal(late.body.error, 'Trop tard : les pronostics sont clos.');
    assert.equal((await detail('max', betId)).myPick, opt.Non);
  });

  it('les cotes et les points potentiels suivent les pronostics', async () => {
    const { betId, opt } = await createBet(srv, g);
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    await pick('ines', betId, opt.Non);
    const bet = await detail('sam', betId);
    const [oui, non] = bet.options;
    assert.deepEqual([oui.count, oui.odds, oui.points, oui.pickers], [1, 3, 300, [g.id.max]]);
    assert.deepEqual([non.count, non.odds, non.points], [2, 1.5, 150]);
    assert.equal(bet.participants, 3);
  });

  it('un arbitre désigné libère le créateur, qui peut alors parier', async () => {
    const { betId, opt } = await createBet(srv, g, { arbiter: 'sam' });
    assert.equal((await pick('lea', betId, opt.Oui)).status, 200);
    assert.equal((await pick('sam', betId, opt.Oui)).status, 403);
  });
});

describe('clôture', () => {
  it('automatique à l’heure prévue', async () => {
    const { betId, opt } = await createBet(srv, g);
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    advance(HOUR);
    const bet = await detail('lea', betId);
    assert.equal(bet.status, 'closed');
    assert.equal(bet.can.resolve, true);
  });

  it('moins de 2 participants : annulé d’office', async () => {
    const { betId, opt } = await createBet(srv, g);
    await pick('max', betId, opt.Oui);
    advance(HOUR);
    const bet = await detail('lea', betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelReason, 'too_few');
  });

  it('pari unanime : annulé d’office, aucun point', async () => {
    const { betId, opt } = await createBet(srv, g);
    for (const who of ['max', 'tom', 'ines']) await pick(who, betId, opt.Oui);
    advance(HOUR);
    const bet = await detail('lea', betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelReason, 'unanimous');
  });

  it('l’arbitre peut clôturer plus tôt ; un simple membre non', async () => {
    const { betId, opt } = await createBet(srv, g);
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    assert.equal((await g.c.tom.post(betUrl(g, betId, 'close'))).status, 403);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'close'))).status, 200);
    assert.equal((await detail('lea', betId)).status, 'closed');
    assert.equal((await pick('ines', betId, opt.Oui)).status, 409);
  });
});

describe('trancher, valider, contester, voter', () => {
  async function closedBet(arbiter) {
    const b = await createBet(srv, g, arbiter ? { arbiter } : {});
    await pick('max', b.betId, b.opt.Oui);
    await pick('tom', b.betId, b.opt.Non);
    await pick('ines', b.betId, b.opt.Non);
    advance(HOUR);
    return b;
  }

  it('sans contestation : points au bout de 24 h, avec la prime d’arbitre', async () => {
    const { betId, opt } = await closedBet();
    assert.equal((await g.c.max.post(betUrl(g, betId, 'resolve'), { optionId: opt.Non })).status, 403);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'resolve'), { optionId: opt.Non, note: 'arrivé à 20 h 10' })).status, 200);
    let bet = await detail('tom', betId);
    assert.equal(bet.status, 'validating');
    assert.equal(bet.can.contest, true);
    assert.equal(bet.resolutionNote, 'arrivé à 20 h 10');
    advance(24 * HOUR - 1000);
    assert.equal((await detail('tom', betId)).status, 'validating');
    advance(1000);
    bet = await detail('tom', betId);
    assert.equal(bet.status, 'settled');
    assert.deepEqual(bet.awards.map((a) => [a.memberId, a.kind, a.amount]).sort(), [
      [g.id.ines, 'gain', 150], [g.id.lea, 'prime', 20], [g.id.tom, 'gain', 150],
    ].sort());
    assert.equal(bet.myPoints, 150);
    assert.equal(await scoreOf('tom'), 150);
    assert.equal(await scoreOf('max'), 0);
  });

  it('trancher avant la clôture est refusé', async () => {
    const { betId, opt } = await createBet(srv, g);
    const r = await g.c.lea.post(betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Attends la clôture des pronostics pour trancher.');
  });

  it('contestation puis vote qui renverse le résultat : pas de prime', async () => {
    const { betId, opt } = await closedBet();
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    assert.equal((await g.c.sam.post(betUrl(g, betId, 'contest'), { reason: 'pas parié' })).status, 403, 'seuls les participants contestent');
    assert.equal((await g.c.tom.post(betUrl(g, betId, 'contest'), { reason: '' })).status, 400);
    await g.c.tom.ok('POST', betUrl(g, betId, 'contest'), { reason: 'Il est arrivé à 20 h 10, j’ai la photo' });
    let bet = await detail('sam', betId);
    assert.equal(bet.status, 'voting');
    assert.equal(bet.dispute.reason, 'Il est arrivé à 20 h 10, j’ai la photo');
    assert.deepEqual(bet.eligibleVoters.sort(), [g.id.max, g.id.tom, g.id.ines, g.id.sam].sort());
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'vote'), { choice: opt.Non })).status, 403, 'l’arbitre ne vote pas');
    await g.c.tom.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    assert.equal((await g.c.tom.post(betUrl(g, betId, 'vote'), { choice: opt.Non })).status, 409);
    await g.c.ines.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    await g.c.sam.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    assert.equal((await detail('sam', betId)).status, 'voting', 'Max n’a pas encore voté');
    await g.c.max.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Oui });
    bet = await detail('sam', betId);
    assert.equal(bet.status, 'settled', 'tout le monde a voté : le vote se termine aussitôt');
    assert.equal(bet.winningOptionId, opt.Non);
    assert.deepEqual(bet.awards.map((a) => a.kind), ['gain', 'gain']);
    assert.equal(await scoreOf('lea'), 0, 'pas de prime après contestation');
  });

  it('égalité au vote : annulé', async () => {
    const { betId, opt } = await closedBet();
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, betId, 'contest'), { reason: 'non' });
    await g.c.tom.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    await g.c.ines.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    await g.c.max.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Oui });
    await g.c.sam.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Oui });
    const bet = await detail('max', betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelReason, 'vote_tie');
  });

  it('moins de 3 votants à la fin du délai : la décision de l’arbitre tient (sans prime)', async () => {
    const { betId, opt } = await closedBet();
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, betId, 'contest'), { reason: 'non' });
    await g.c.tom.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    await g.c.ines.ok('POST', betUrl(g, betId, 'vote'), { choice: opt.Non });
    advance(48 * HOUR);
    const bet = await detail('max', betId);
    assert.equal(bet.status, 'settled');
    assert.equal(bet.winningOptionId, opt.Oui);
    assert.deepEqual(bet.awards, [{ memberId: g.id.max, kind: 'gain', amount: 300 }]);
    const late = await g.c.sam.post(betUrl(g, betId, 'vote'), { choice: opt.Oui });
    assert.equal(late.status, 409);
  });

  it('l’annulation peut gagner le vote', async () => {
    const { betId, opt } = await closedBet();
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Oui });
    await g.c.tom.ok('POST', betUrl(g, betId, 'contest'), { reason: 'question ambiguë' });
    for (const who of ['tom', 'ines', 'sam']) await g.c[who].ok('POST', betUrl(g, betId, 'vote'), { choice: 'cancel' });
    advance(48 * HOUR);
    const bet = await detail('max', betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelReason, 'vote');
  });

  it('personne n’avait vu juste : aucun gain, la prime reste', async () => {
    const b = await createBet(srv, g, { kind: 'multi', question: 'Qui gagne le tournoi ?', options: ['Max', 'Tom', 'Inès'] });
    await pick('max', b.betId, b.opt.Max);
    await pick('tom', b.betId, b.opt.Tom);
    await pick('sam', b.betId, b.opt.Tom);
    advance(HOUR);
    await g.c.lea.ok('POST', betUrl(g, b.betId, 'resolve'), { optionId: b.opt['Inès'] });
    advance(24 * HOUR);
    const bet = await detail('lea', b.betId);
    assert.equal(bet.status, 'settled');
    assert.deepEqual(bet.awards, [{ memberId: g.id.lea, kind: 'prime', amount: 20 }]);
    const settled = bet.events.find((e) => e.type === 'settled');
    assert.equal(settled.data.outcome, 'nobody');
  });
});

describe('arbitre absent ou désisté', () => {
  it('un admin sans pronostic peut trancher après 7 jours ; abandon au bout de 30 jours', async () => {
    const { betId, opt } = await createBet(srv, g, { arbiter: 'sam' });
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    advance(HOUR);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'resolve'), { optionId: opt.Oui })).status, 403, 'trop tôt');
    let bet = await detail('lea', betId);
    assert.equal(bet.overdue, false);
    advance(DAY + 1000);
    assert.equal((await detail('lea', betId)).overdue, true, 'l’arbitre est en retard');
    advance(6 * DAY);
    bet = await detail('lea', betId);
    assert.equal(bet.can.resolve, true, 'admin sans pronostic, 7 jours après');
    advance(23 * DAY);
    bet = await detail('lea', betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelReason, 'abandoned');
  });

  it('un admin qui a parié ne peut pas trancher à la place de l’arbitre', async () => {
    const { betId, opt } = await createBet(srv, g, { arbiter: 'sam' });
    await pick('lea', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    advance(8 * DAY);
    assert.equal((await detail('lea', betId)).can.resolve, false);
  });

  it('désistement : arbitre « à désigner », le créateur en choisit un qui n’a pas parié', async () => {
    const { betId, opt } = await createBet(srv, g, { arbiter: 'sam' });
    await pick('max', betId, opt.Oui);
    assert.equal((await g.c.max.post(betUrl(g, betId, 'withdraw'))).status, 403);
    await g.c.sam.ok('POST', betUrl(g, betId, 'withdraw'));
    assert.equal((await detail('lea', betId)).arbiterId, null);
    const refused = await g.c.lea.post(betUrl(g, betId, 'arbiter'), { arbiterId: g.id.max });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Ce membre a déjà parié : il ne peut pas arbitrer ce pari.');
    await g.c.lea.ok('POST', betUrl(g, betId, 'arbiter'), { arbiterId: g.id.ines });
    assert.equal((await detail('lea', betId)).arbiterId, g.id.ines);
  });

  it('sans arbitre, un admin sans pronostic peut trancher dès la clôture', async () => {
    const { betId, opt } = await createBet(srv, g, { arbiter: 'sam' });
    await g.c.sam.ok('POST', betUrl(g, betId, 'withdraw'));
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    advance(HOUR);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'resolve'), { optionId: opt.Oui })).status, 200);
  });
});

describe('modifier, préciser, repousser, annuler, supprimer', () => {
  it('tout est modifiable tant que personne n’a parié', async () => {
    const { betId } = await createBet(srv, g);
    const now = srv.clock.now();
    await g.c.lea.ok('PATCH', betUrl(g, betId), { question: 'Qui arrive en dernier ?', category: 'groupe', kind: 'multi', options: ['Julien', 'Max'], closesAt: now + 2 * HOUR });
    const bet = await detail('lea', betId);
    assert.equal(bet.question, 'Qui arrive en dernier ?');
    assert.deepEqual(bet.options.map((o) => o.label), ['Julien', 'Max']);
    assert.equal((await g.c.max.patch(betUrl(g, betId), { question: 'Piratage ?', category: 'groupe', kind: 'yesno', closesAt: now + HOUR })).status, 403);
    await pick('max', betId, bet.options[0].id);
    const locked = await g.c.lea.patch(betUrl(g, betId), { question: 'Autre chose ?', category: 'groupe', kind: 'yesno', closesAt: now + HOUR });
    assert.equal(locked.status, 409);
    assert.equal((await g.c.lea.delete(betUrl(g, betId))).status, 409);
  });

  it('précision datée et clôture repoussée', async () => {
    const { betId } = await createBet(srv, g);
    await g.c.lea.ok('POST', betUrl(g, betId, 'details'), { text: 'Le retard compte à partir de 20 h 16.' });
    const before = await detail('lea', betId);
    await g.c.lea.ok('POST', betUrl(g, betId, 'postpone'), { closesAt: before.closesAt + HOUR });
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'postpone'), { closesAt: before.closesAt })).status, 400);
    const bet = await detail('max', betId);
    assert.equal(bet.closesAt, before.closesAt + HOUR);
    assert.equal(bet.events.find((e) => e.type === 'detail_added').data.text, 'Le retard compte à partir de 20 h 16.');
  });

  it('supprimer sans pronostic, annuler sinon', async () => {
    const a = await createBet(srv, g);
    await g.c.lea.ok('DELETE', betUrl(g, a.betId));
    assert.equal((await g.c.lea.get(betUrl(g, a.betId))).status, 404);
    const b = await createBet(srv, g);
    await pick('max', b.betId, b.opt.Oui);
    assert.equal((await g.c.max.post(betUrl(g, b.betId, 'cancel'), { note: '' })).status, 403);
    await g.c.lea.ok('POST', betUrl(g, b.betId, 'cancel'), { note: 'Julien ne vient plus' });
    const bet = await detail('max', b.betId);
    assert.equal(bet.status, 'cancelled');
    assert.equal(bet.cancelNote, 'Julien ne vient plus');
  });
});

describe('correction par un admin', () => {
  it('écritures inverses puis nouveau règlement, sans prime ; le score reste la somme du journal', async () => {
    const { betId, opt } = await createBet(srv, g);
    await pick('max', betId, opt.Oui);
    await pick('tom', betId, opt.Non);
    await pick('ines', betId, opt.Non);
    advance(HOUR);
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt.Non });
    advance(24 * HOUR);
    assert.equal(await scoreOf('tom'), 150);
    assert.equal(await scoreOf('lea'), 20);

    assert.equal((await g.c.max.post(betUrl(g, betId, 'correct'), { optionId: opt.Oui, reason: 'erreur' })).status, 403);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'correct'), { optionId: opt.Non, reason: 'pareil' })).status, 400);
    await g.c.lea.ok('POST', betUrl(g, betId, 'correct'), { optionId: opt.Oui, reason: 'L’arbitre s’est trompé de ligne' });
    const bet = await detail('max', betId);
    assert.equal(bet.status, 'settled');
    assert.equal(bet.winningOptionId, opt.Oui);
    assert.deepEqual(bet.awards, [{ memberId: g.id.max, kind: 'gain', amount: 300 }]);
    assert.equal(await scoreOf('tom'), 0);
    assert.equal(await scoreOf('lea'), 0);
    assert.equal(await scoreOf('max'), 300);
    const ledger = (await g.c.tom.ok('GET', `/api/groups/${g.gid}/members/${g.id.tom}`)).profile.ledger;
    assert.deepEqual(ledger.map((l) => [l.kind, l.amount]), [['reversal', -150], ['gain', 150]]);

    await g.c.lea.ok('POST', betUrl(g, betId, 'correct'), { optionId: 'cancel', reason: 'Finalement on annule' });
    assert.equal(await scoreOf('max'), 0);
    assert.equal((await detail('max', betId)).cancelReason, 'correction');
  });
});

describe('commentaires', () => {
  it('chacun supprime les siens, un admin peut tout supprimer', async () => {
    const { betId } = await createBet(srv, g);
    const { id: c1 } = await g.c.max.ok('POST', betUrl(g, betId, 'comments'), { body: 'Il sera en retard 😂' });
    const { id: c2 } = await g.c.tom.ok('POST', betUrl(g, betId, 'comments'), { body: '🔥' });
    assert.equal((await g.c.tom.delete(betUrl(g, betId, `comments/${c1}`))).status, 403);
    await g.c.lea.ok('DELETE', betUrl(g, betId, `comments/${c1}`));
    await g.c.tom.ok('DELETE', betUrl(g, betId, `comments/${c2}`));
    assert.deepEqual((await detail('max', betId)).comments, []);
    assert.equal((await g.c.max.post(betUrl(g, betId, 'comments'), { body: '   ' })).status, 400);
  });
});
