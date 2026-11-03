/** Ajoute une ligne à l'historique (fiche d'un pari, fil d'activité du groupe). */
export function addEvent(db, now, { groupId, betId = null, memberId = null, type, data = {} }) {
  db.prepare('INSERT INTO events (group_id, bet_id, member_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(groupId, betId, memberId, type, JSON.stringify(data), now);
}

export const parseEvent = (row) => ({
  id: row.id,
  betId: row.bet_id,
  memberId: row.member_id,
  type: row.type,
  data: JSON.parse(row.data),
  createdAt: row.created_at,
});
