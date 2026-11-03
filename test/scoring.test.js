import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decimalOdds, isUnanimous, oddsByOption, pointsFor, settle, tallyVotes } from '../src/core/scoring.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const S = { ...DEFAULT_SETTINGS };
const picks = (spec) => Object.entries(spec).flatMap(([opt, members]) => members.map((m) => ({ memberId: m, optionId: opt })));

describe('cotes du groupe', () => {
  it('cote = participants ÷ pronostics sur l’option, null si personne', () => {
    const p = picks({ oui: ['lea', 'max', 'sam'], non: ['tom', 'ines'] });
    assert.deepEqual(oddsByOption(['oui', 'non', 'nsp'], p), [
      { optionId: 'oui', count: 3, odds: 5 / 3 },
      { optionId: 'non', count: 2, odds: 2.5 },
      { optionId: 'nsp', count: 0, odds: null },
    ]);
  });

  it('points = 100 × cote, arrondis à l’entier le plus proche, avec plafond éventuel', () => {
    assert.equal(pointsFor(5 / 3, S), 167);
    assert.equal(pointsFor(2.5, S), 250);
    assert.equal(pointsFor(7 / 3, S), 233);
    assert.equal(pointsFor(10, { ...S, oddsCap: 5 }), 500);
    assert.equal(pointsFor(2, { ...S, basePoints: 50 }), 100);
  });

  it('unanimité', () => {
    assert.equal(isUnanimous(picks({ oui: ['a', 'b'] })), true);
    assert.equal(isUnanimous(picks({ oui: ['a'], non: ['b'] })), false);
    assert.equal(isUnanimous([]), false);
  });
});

describe('règlement', () => {
  it('exemple du cahier des charges : Non gagne, Tom et Inès prennent 250, prime de 20 pour l’arbitre', () => {
    const r = settle({ picks: picks({ oui: ['lea', 'max', 'sam'], non: ['tom', 'ines'] }), winningOptionId: 'non', settings: S, resolverId: 'julien' });
    assert.equal(r.outcome, 'scored');
    assert.equal(r.each, 250);
    assert.deepEqual(r.awards, [
      { memberId: 'tom', kind: 'gain', amount: 250 },
      { memberId: 'ines', kind: 'gain', amount: 250 },
      { memberId: 'julien', kind: 'prime', amount: 20 },
    ]);
  });

  it('moins de 2 participants ou unanimité : aucun point, pas de prime', () => {
    assert.deepEqual(settle({ picks: picks({ oui: ['a'] }), winningOptionId: 'oui', settings: S, resolverId: 'z' }).awards, []);
    const u = settle({ picks: picks({ oui: ['a', 'b', 'c'] }), winningOptionId: 'oui', settings: S, resolverId: 'z' });
    assert.equal(u.outcome, 'unanimous');
    assert.deepEqual(u.awards, []);
  });

  it('personne sur l’option gagnante : aucun gain, mais la prime reste due', () => {
    const r = settle({ picks: picks({ a: ['x', 'y'], b: ['z'] }), winningOptionId: 'c', settings: S, resolverId: 'arb' });
    assert.equal(r.outcome, 'nobody');
    assert.deepEqual(r.awards, [{ memberId: 'arb', kind: 'prime', amount: 20 }]);
  });

  it('prime seulement sans contestation et à partir de 3 participants', () => {
    const p3 = picks({ a: ['x', 'y'], b: ['z'] });
    assert.ok(settle({ picks: p3, winningOptionId: 'a', settings: S, resolverId: 'arb', contested: true }).awards.every((a) => a.kind !== 'prime'));
    const p2 = picks({ a: ['x'], b: ['y'] });
    assert.ok(settle({ picks: p2, winningOptionId: 'a', settings: S, resolverId: 'arb' }).awards.every((a) => a.kind !== 'prime'));
    assert.ok(settle({ picks: p3, winningOptionId: 'a', settings: { ...S, arbiterBonus: 0 }, resolverId: 'arb' }).awards.every((a) => a.kind !== 'prime'));
  });

  it('le seul à avoir raison sur 8 participants prend 800', () => {
    const p = picks({ a: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], b: ['malin'] });
    assert.deepEqual(settle({ picks: p, winningOptionId: 'b', settings: S }).awards, [{ memberId: 'malin', kind: 'gain', amount: 800 }]);
  });
});

describe('paris sportifs : cote fixe', () => {
  it('cote américaine → décimale', () => {
    assert.equal(decimalOdds('+150'), 2.5);
    assert.equal(decimalOdds('-250'), 1.4);
    assert.equal(decimalOdds(-115), 1.87);
    assert.equal(decimalOdds('EVEN'), null);
    assert.equal(decimalOdds(undefined), null);
  });

  it('chaque bon pronostic rapporte sa cote : seul, ou tous d’accord, sans prime', () => {
    const fixedOdds = new Map([['a', 1.4], ['b', 4.5]]);
    const alone = settle({ picks: [{ memberId: 'm1', optionId: 'b' }], winningOptionId: 'b', settings: DEFAULT_SETTINGS, fixedOdds });
    assert.deepEqual([alone.outcome, alone.odds, alone.each, alone.awards], ['scored', 4.5, 450, [{ memberId: 'm1', kind: 'gain', amount: 450 }]]);
    const all = settle({
      picks: [{ memberId: 'm1', optionId: 'a' }, { memberId: 'm2', optionId: 'a' }, { memberId: 'm3', optionId: 'a' }],
      winningOptionId: 'a', settings: DEFAULT_SETTINGS, resolverId: 'm4', fixedOdds,
    });
    assert.deepEqual(all.awards.map((a) => [a.memberId, a.amount]), [['m1', 140], ['m2', 140], ['m3', 140]], 'unanime : rien d’annulé, pas de prime');
    assert.equal(settle({ picks: [{ memberId: 'm1', optionId: 'a' }], winningOptionId: 'b', settings: DEFAULT_SETTINGS, fixedOdds }).outcome, 'nobody');
    assert.equal(settle({ picks: [{ memberId: 'm1', optionId: 'b' }], winningOptionId: 'b', settings: { ...DEFAULT_SETTINGS, oddsCap: 3 }, fixedOdds }).each, 300, 'plafond du groupe');
  });
});

describe('vote après contestation', () => {
  const v = (...choices) => choices.map((choice, i) => ({ memberId: `m${i}`, choice }));

  it('moins de 3 votants : la décision de l’arbitre est maintenue', () => {
    assert.deepEqual(tallyVotes(v('b', 'b'), 'a'), { result: 'a', reason: 'too_few_votes', counts: { b: 2 } });
  });

  it('majorité', () => {
    assert.equal(tallyVotes(v('a', 'b', 'b'), 'a').result, 'b');
    assert.equal(tallyVotes(v('cancel', 'cancel', 'a'), 'a').result, 'cancel');
  });

  it('égalité en tête : annulation', () => {
    assert.deepEqual(tallyVotes(v('a', 'b', 'a', 'b'), 'a').result, 'cancel');
    assert.equal(tallyVotes(v('a', 'b', 'a', 'b'), 'a').reason, 'tie');
  });
});
