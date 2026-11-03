// Ce qu'on sait d'une rencontre au-delà du pari : les équipes ou les pilotes (noms, logos, photos, couleurs) et le score
// en direct puis final. Une ligne par pari de source (ref.key), commune à tous les groupes où ce pari est ouvert.
//
//   media : { layout: 'versus' | 'field', competitors: [{ key, name, abbr, logo, img, flag, color, number, team }] }
//           versus : deux équipes (key 'home' / 'away') ou deux athlètes (key = id de l'option) ; field : les pilotes
//           d'une course (key = id de l'option). Les images sont les adresses des sources (servies par /media).
//   live  : { state: 'pre' | 'in' | 'post', clock, scores: { [key]: n }, sets: { [key]: [jeux…] }, winner, podium }
//           et les faits du match selon le sport : events, periods, stats, leaders, situation, finish
//           (src/sources/facts.js), ranking et fastest pour une course (F1, MotoGP) ; factsRead : version des faits
//           avec laquelle la rencontre finie a été lue (SourceService.refreshLive, pas pour l'app).

export class LiveStore {
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  /** { media, live, liveAt } d'un pari de source (ref.key), ou null. */
  get(key) {
    const row = this.db.prepare('SELECT media, live, live_at FROM source_events WHERE key = ?').get(String(key));
    if (!row) return null;
    return { media: row.media ? JSON.parse(row.media) : null, live: row.live ? JSON.parse(row.live) : null, liveAt: row.live_at };
  }

  saveMedia(key, media) {
    this.db.prepare(`INSERT INTO source_events (key, media, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET media = excluded.media, updated_at = excluded.updated_at`)
      .run(String(key), JSON.stringify(media), this.clock.now());
  }

  /** Dernière lecture du direct ; live null : la source n'a rien dit (on garde le dernier état connu). */
  saveLive(key, live) {
    const now = this.clock.now();
    this.db.prepare(`INSERT INTO source_events (key, live, live_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET live = COALESCE(excluded.live, live), live_at = excluded.live_at, updated_at = excluded.updated_at`)
      .run(String(key), live ? JSON.stringify(live) : null, now, now);
  }
}
