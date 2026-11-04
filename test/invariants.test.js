// Simulation : des centaines de paris joués au hasard (pronostics, verdicts, contestations, votes,
// corrections, départs), puis vérification des règles qui ne doivent jamais casser.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { pointsFor } from '../src/core/scoring.js';
import { createClock } from '../src/lib/clock.js';
import { DAY, HOUR, makeConfig } from './helpers.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function simulate(seed) {
  const clock = createClock();
  const { deps, close } = createApp(makeConfig(), { clock });
  const { db, groups, bets } = deps;
  const rand = rng(seed);
  const pickOne = (list) => list[Math.floor(rand() * list.length)];
  const attempt = (fn) => { try { fn(); return true; } catch (err) { if (!err.status) throw err; return false; } };

  const { groupId, memberId: adminId } = await groups.createGroup({ name: 'Sim', emoji: '🎲', pseudo: 'Admin', avatar: '🦊', pin: '0000' });
  // Un groupe neuf n'a rien d'activé : l'admin ouvre les paris maison.
  groups.updateSettings(groups.member(adminId), { kinds: { yesno: true, multi: true }, categories: groups.settings(groupId).categories.map((c) => ({ ...c, hidden: false })) });
  const token = groups.find(groupId).address;
  for (let i = 0; i < 7; i++) await groups.join(token, { pseudo: `Joueur${i}`, avatar: '🐻', pin: '0000' });
  const me = (id) => groups.member(id);
  const active = () => groups.activeMembers(groupId);

  for (let round = 0; round < 120; round++) {
    const creator = pickOne(active());
    const multi = rand() < 0.4;
    const arbiter = rand() < 0.5 ? creator : pickOne(active());
    let betId;
    if (!attempt(() => {
      betId = bets.create(me(creator.id), {
        question: `Pari numéro ${round} ?`, category: 'insolite', kind: multi ? 'multi' : 'yesno',
        options: multi ? ['A', 'B', 'C', 'D'].slice(0, 2 + Math.floor(rand() * 3)) : undefined,
        closesAt: clock.now() + HOUR, arbiterId: arbiter.id,
      });
    })) continue;
    const options = bets.options(betId);
    for (const m of active()) if (rand() < 0.7) attempt(() => bets.pick(me(m.id), betId, pickOne(options).id));
    if (rand() < 0.05) attempt(() => groups.removeMember(me(adminId), pickOne(active()).id));
    clock.advance(HOUR + 1);
    bets.sweep(groupId);
    let bet = bets.get(betId);
    if (bet.status === 'closed') {
      const resolver = bet.arbiter_id;
      if (rand() < 0.1) clock.advance(8 * DAY); // arbitre absent
      bets.sweep(groupId);
      const who = rand() < 0.9 && me(resolver)?.status === 'active' ? me(resolver) : me(adminId);
      attempt(() => bets.resolve(who, betId, { optionId: pickOne(options).id }));
      bet = bets.get(betId);
      if (bet.status === 'validating' && rand() < 0.3) {
        const contester = bets.picks(betId)[0];
        if (attempt(() => bets.contest(me(contester.memberId), betId, 'Pas d’accord'))) {
          for (const m of active()) if (rand() < 0.6) attempt(() => bets.vote(me(m.id), betId, rand() < 0.15 ? 'cancel' : pickOne(options).id));
        }
      }
      clock.advance(3 * DAY);
      bets.sweep(groupId);
      bet = bets.get(betId);
      if (rand() < 0.1) attempt(() => bets.correct(me(adminId), betId, { optionId: rand() < 0.2 ? 'cancel' : pickOne(options).id, reason: 'Correction' }));
    }
  }
  clock.advance(40 * DAY);
  bets.sweep(groupId);
  return { db, groups, bets, deps, groupId, close };
}

describe('invariants (simulation de 120 paris, 3 graines)', () => {
  for (const seed of [1, 42, 2026]) {
    it(`graine ${seed}`, async () => {
      const { db, bets, deps, groupId, close } = await simulate(seed);
      try {
        const settings = deps.groups.settings(groupId);
        const all = db.prepare('SELECT * FROM bets WHERE group_id = ?').all(groupId);
        assert.ok(all.length > 80, 'la simulation joue vraiment');
        const statuses = new Set(all.map((b) => b.status));
        for (const s of ['settled', 'cancelled']) assert.ok(statuses.has(s), `au moins un pari ${s}`);
        assert.ok(!statuses.has('open') && !statuses.has('validating') && !statuses.has('voting'), 'toutes les échéances sont passées');

        for (const bet of all) {
          const picks = bets.picks(bet.id);
          // Un seul pronostic par membre, jamais celui de l'arbitre au moment de trancher.
          assert.equal(new Set(picks.map((p) => p.memberId)).size, picks.length);
          if (bet.resolved_by) assert.ok(!picks.some((p) => p.memberId === bet.resolved_by), 'celui qui tranche n’a pas parié');

          const rows = db.prepare('SELECT * FROM points WHERE bet_id = ?').all(bet.id);
          const net = rows.reduce((s, r) => s + r.amount, 0);
          const current = rows.filter((r) => r.round === bet.round && r.kind !== 'reversal');
          // Chaque règlement remplacé est exactement annulé par ses écritures inverses.
          for (let r = 1; r < bet.round; r++) {
            assert.equal(rows.filter((x) => x.round === r).reduce((s, x) => s + x.amount, 0), 0, `round ${r} annulé`);
          }
          if (bet.status === 'cancelled') {
            assert.equal(net, 0, 'un pari annulé ne rapporte rien au total');
            continue;
          }
          if (bet.status !== 'settled') continue;
          assert.equal(net, current.reduce((s, r) => s + r.amount, 0));
          // Les gains sont exactement ceux du barème.
          const winners = picks.filter((p) => p.optionId === bet.winning_option_id);
          const gains = current.filter((r) => r.kind === 'gain');
          assert.equal(gains.length, winners.length);
          if (winners.length) {
            const expected = pointsFor(picks.length / winners.length, settings);
            for (const gain of gains) assert.equal(gain.amount, expected);
          }
          const primes = current.filter((r) => r.kind === 'prime');
          assert.ok(primes.length <= 1);
          if (primes.length) {
            assert.equal(primes[0].member_id, bet.resolved_by);
            assert.equal(bet.contested, 0, 'pas de prime après contestation');
            assert.ok(picks.length >= 3);
          }
        }
        // Chaque pari compte dans une saison ; le score de saison est la somme du journal de ses paris, jamais négatif,
        // et les saisons d'un membre additionnées redonnent tout son journal.
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bets WHERE season_id IS NULL').get().n, 0);
        const totals = new Map();
        for (const { id } of db.prepare('SELECT id FROM seasons WHERE group_id = ?').all(groupId)) {
          for (const row of deps.seasons.standings(id)) {
            const sum = db.prepare('SELECT COALESCE(SUM(p.amount), 0) AS s FROM points p JOIN bets b ON b.id = p.bet_id WHERE b.season_id = ? AND p.member_id = ?').get(id, row.memberId).s;
            assert.equal(row.score, sum);
            assert.ok(row.score >= 0);
            totals.set(row.memberId, (totals.get(row.memberId) ?? 0) + row.score);
          }
        }
        for (const [memberId, total] of totals) {
          assert.equal(total, db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM points WHERE member_id = ?').get(memberId).s);
        }
      } finally {
        close();
      }
    });
  }
});
