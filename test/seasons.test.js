// Saisons des classements : saisons de l'année (équinoxes, solstices) et saisons officielles des compétitions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { equinox, fixedSeason, naturalSeason, officialSeason, scheduleSeason, seasonLabel } from '../src/core/seasons.js';
import { parisDayAt } from '../src/lib/time.js';

const MINUTE = 60_000;
const near = (actual, iso, msg) => assert.ok(Math.abs(actual - Date.parse(iso)) <= 2 * MINUTE, `${msg} : ${new Date(actual).toISOString()} ≠ ${iso}`);

describe('saisons de l’année', () => {
  it('équinoxes et solstices à la minute près (dates publiées par l’IMCCE)', () => {
    near(equinox(2024, 0), '2024-03-20T03:06Z', 'printemps 2024');
    near(equinox(2024, 1), '2024-06-20T20:51Z', 'été 2024');
    near(equinox(2025, 2), '2025-09-22T18:19Z', 'automne 2025');
    near(equinox(2025, 3), '2025-12-21T15:03Z', 'hiver 2025');
    near(equinox(2026, 0), '2026-03-20T14:46Z', 'printemps 2026');
  });

  it('une saison commence à minuit (heure de Paris) le jour de l’équinoxe ou du solstice', () => {
    const autumn = naturalSeason(Date.parse('2026-10-30T15:00Z'));
    assert.deepEqual(autumn, { label: 'Automne 2026', startsAt: parisDayAt('2026-09-23', 0), endsAt: parisDayAt('2026-12-21', 0) });
    assert.equal(naturalSeason(autumn.endsAt).label, 'Hiver 2026-27', 'l’hiver est à cheval sur deux années');
    assert.equal(naturalSeason(autumn.endsAt - 1).label, 'Automne 2026');
    assert.equal(naturalSeason(Date.parse('2027-02-01T12:00Z')).endsAt, parisDayAt('2027-03-20', 0));
    assert.equal(naturalSeason(Date.parse('2026-07-14T12:00Z')).label, 'Été 2026');
  });
});

describe('saisons des compétitions', () => {
  it('libellé : une année, ou deux à cheval (heure de Paris)', () => {
    assert.equal(seasonLabel(Date.parse('2026-01-01T05:00Z'), Date.parse('2027-01-01T04:59Z')), '2026');
    assert.equal(seasonLabel(Date.parse('2026-06-01T04:00Z'), Date.parse('2027-06-01T03:59Z')), '2026-27');
    assert.equal(seasonLabel(parisDayAt('2026-01-01', 0), parisDayAt('2027-01-01', 0)), '2026');
  });

  it('saison officielle d’ESPN si ses dates tiennent debout, sinon saison à date fixe', () => {
    const at = Date.parse('2026-11-01T20:00Z');
    assert.deepEqual(officialSeason({ startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z' }, at, 7),
      { label: '2026-27', startsAt: Date.parse('2026-06-01T04:00Z'), endsAt: Date.parse('2027-06-01T03:59Z') });
    // Top 14 chez ESPN : la fin avant le début.
    assert.deepEqual(officialSeason({ startDate: '2026-11-01T19:00Z', endDate: '2026-07-02T03:59Z' }, at, 8),
      { label: '2026-27', startsAt: parisDayAt('2026-08-01', 0), endsAt: parisDayAt('2027-08-01', 0) });
    // Ligue des nations : sur deux ans, trop long pour un classement.
    assert.equal(officialSeason({ startDate: '2026-06-01T04:00Z', endDate: '2028-04-01T03:59Z' }, at, 7).label, '2026-27');
    assert.equal(officialSeason(undefined, at).label, '2026', 'rien : année civile');
    assert.equal(officialSeason({ startDate: '2026-12-01T04:00Z', endDate: '2027-06-01T03:59Z' }, at, 7).startsAt, parisDayAt('2026-07-01', 0), 'match hors saison');
  });

  it('date fixe : le 1er du mois choisi ; calendrier connu : du premier au lendemain du dernier Grand Prix', () => {
    assert.deepEqual(fixedSeason(Date.parse('2026-03-30T12:00Z'), 8), { label: '2025-26', startsAt: parisDayAt('2025-08-01', 0), endsAt: parisDayAt('2026-08-01', 0) });
    assert.equal(fixedSeason(Date.parse('2026-10-30T12:00Z')).label, '2026');
    assert.deepEqual(scheduleSeason(2026, Date.parse('2026-03-08T04:00Z'), Date.parse('2026-12-06T13:00Z')),
      { label: '2026', startsAt: parisDayAt('2026-03-08', 0), endsAt: parisDayAt('2026-12-08', 0) });
  });
});
