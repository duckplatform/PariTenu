/**
 * Horloge du serveur. Elle fait foi pour les clôtures et les délais ; les tests et la démo la
 * déplacent (advance / set) pour vivre 24 h de validation en une seconde.
 */
export function createClock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    advance(ms) { offset += ms; },
    set(ts) { offset = ts - Date.now(); },
    reset() { offset = 0; },
  };
}
