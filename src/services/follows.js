import { sourceById } from '../sources/index.js';

/**
 * Le « fil » d'un pari ouvert par une source : sa compétition pour le sport ('foot:fra.1'), la source sinon ('meteo').
 * null pour un pari entre amis (toujours visible).
 */
export function feedOf(bet) {
  if (!bet.source) return null;
  return sourceById(bet.source)?.competitions ? bet.ranking : bet.source;
}

/**
 * Compétitions suivies : le groupe propose des compétitions (réglages des paris), chaque membre choisit d'y participer
 * ('in') ou non ('out'). Sans réponse, ses paris ne s'affichent pas : personne n'est envahi par ce qui ne l'intéresse pas.
 */
export class FollowService {
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  /** Map fil → 'in' | 'out' des choix d'un membre. */
  choices(memberId) {
    return new Map(this.db.prepare('SELECT feed, choice FROM follows WHERE member_id = ?').all(memberId).map((r) => [r.feed, r.choice]));
  }

  set(memberId, feed, choice) {
    this.db.prepare(`INSERT INTO follows (member_id, feed, choice, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(member_id, feed) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`)
      .run(memberId, feed, choice, this.clock.now());
  }

  /** Premier choix seulement (parier sur un pari, activer une compétition) : un « non » déjà donné reste un « non ». */
  setIfUnset(memberId, feed, choice) {
    this.db.prepare('INSERT OR IGNORE INTO follows (member_id, feed, choice, updated_at) VALUES (?, ?, ?, ?)')
      .run(memberId, feed, choice, this.clock.now());
  }

  follows(memberId, feed) {
    return this.db.prepare("SELECT 1 FROM follows WHERE member_id = ? AND feed = ? AND choice = 'in'").get(memberId, feed) != null;
  }
}
