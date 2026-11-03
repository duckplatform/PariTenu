import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { monthKey, monthStart } from '../src/lib/time.js';

describe('mois à l’heure de Paris', () => {
  it('le 1er novembre à 0 h 30 à Paris appartient déjà à novembre (UTC : encore octobre)', () => {
    const ts = Date.UTC(2026, 9, 31, 23, 30); // 1er nov. 0 h 30 à Paris (UTC+1)
    assert.equal(monthKey(ts), '2026-11');
    assert.equal(monthStart(ts), Date.UTC(2026, 9, 31, 23, 0));
  });

  it('en été (UTC+2) aussi', () => {
    const ts = Date.UTC(2026, 6, 15, 12);
    assert.equal(monthKey(ts), '2026-07');
    assert.equal(monthStart(ts), Date.UTC(2026, 5, 30, 22, 0));
  });

  it('mois du changement d’heure', () => {
    assert.equal(monthStart(Date.UTC(2026, 2, 29, 12)), Date.UTC(2026, 1, 28, 23, 0)); // mars : début en heure d’hiver
    assert.equal(monthStart(Date.UTC(2026, 9, 26, 12)), Date.UTC(2026, 8, 30, 22, 0)); // octobre : début en heure d’été
  });
});
