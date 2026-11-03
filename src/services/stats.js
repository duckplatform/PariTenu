import { parseEvent } from './events.js';
import { publicMember } from './groups.js';

/**
 * Profils, badges, fil d'activité et export : tout ce qui se calcule à partir du journal.
 * Les classements sont par compétition (ou catégorie) et par saison : voir SeasonService.
 */
export class StatsService {
  constructor(db, clock, groups, seasons) {
    this.db = db;
    this.clock = clock;
    this.groups = groups;
    this.seasons = seasons;
  }

  /** Mes pronostics sur des paris réglés, du plus ancien au plus récent, avec la cote obtenue. */
  #settledPicks(memberId) {
    return this.db.prepare(`SELECT b.id AS bet_id, b.question, b.settled_at, b.winning_option_id, p.option_id,
          (SELECT COUNT(*) FROM picks x WHERE x.bet_id = b.id) AS participants,
          (SELECT COUNT(*) FROM picks x WHERE x.bet_id = b.id AND x.option_id = b.winning_option_id) AS winners
        FROM picks p JOIN bets b ON b.id = p.bet_id
        WHERE p.member_id = ? AND b.status = 'settled' ORDER BY b.settled_at, b.id`).all(memberId)
      .map((r) => ({ ...r, correct: r.option_id === r.winning_option_id, odds: r.winners ? r.participants / r.winners : null }));
  }

  badges(groupId, memberId, settled = this.#settledPicks(memberId)) {
    const badges = [];
    const count = (sql, ...args) => this.db.prepare(sql).get(...args).n;
    if (count('SELECT COUNT(*) AS n FROM picks WHERE member_id = ?', memberId) > 0) {
      badges.push({ code: 'first_pick', emoji: '🎯', label: 'Premier pari' });
    }
    if (settled.some((p) => p.correct && p.winners === 1 && p.participants >= 4)) {
      badges.push({ code: 'lone_wolf', emoji: '🦄', label: 'Seul contre tous', detail: 'Le seul à avoir raison, à 4 ou plus' });
    }
    if (this.#streaks(settled).best >= 5) badges.push({ code: 'streak5', emoji: '🔥', label: 'Série de 5' });
    if (count('SELECT COUNT(*) AS n FROM bets WHERE creator_id = ?', memberId) >= 10) {
      badges.push({ code: 'host', emoji: '🎤', label: 'Ambianceur', detail: '10 paris créés' });
    }
    if (count("SELECT COUNT(*) AS n FROM bets WHERE resolved_by = ? AND status = 'settled' AND contested = 0", memberId) >= 10) {
      badges.push({ code: 'judge', emoji: '⚖️', label: 'Juge de paix', detail: '10 arbitrages sans contestation' });
    }
    const { titles, lanterns } = this.seasons.honours(groupId, memberId);
    for (const t of titles) badges.push({ code: `champion:${t.seasonId}`, emoji: '🏆', label: 'Champion', detail: t.name });
    for (const l of lanterns) badges.push({ code: `lantern:${l.seasonId}`, emoji: '🐌', label: 'Lanterne rouge', detail: l.name });
    return badges;
  }

  #streaks(settled) {
    let best = 0;
    let run = 0;
    for (const p of settled) {
      run = p.correct ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return { best, current: run };
  }

  profile(groupId, memberId) {
    const member = this.groups.member(memberId);
    if (!member || member.group_id !== groupId) return null;
    const settled = this.#settledPicks(memberId);
    const streaks = this.#streaks(settled);
    const correct = settled.filter((p) => p.correct);
    const pickRows = this.db.prepare(`SELECT b.id, b.question, b.status, b.closes_at, b.settled_at, b.winning_option_id, b.round,
          p.option_id, o.label FROM picks p JOIN bets b ON b.id = p.bet_id JOIN bet_options o ON o.id = p.option_id
        WHERE p.member_id = ? ORDER BY p.created_at DESC`).all(memberId);
    const pointsOf = this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM points WHERE bet_id = ? AND member_id = ? AND round = ? AND kind != 'reversal'");
    const badges = this.badges(groupId, memberId, settled);
    return {
      member: publicMember(member),
      seasons: this.seasons.current(groupId, memberId),
      titles: badges.filter((b) => b.code.startsWith('champion:')).length,
      stats: {
        played: settled.length,
        correct: correct.length,
        rate: settled.length ? correct.length / settled.length : null,
        bestOdds: correct.length ? Math.max(...correct.map((p) => p.odds)) : null,
        currentStreak: streaks.current,
        bestStreak: streaks.best,
        created: this.db.prepare('SELECT COUNT(*) AS n FROM bets WHERE creator_id = ?').get(memberId).n,
        arbitrated: this.db.prepare("SELECT COUNT(*) AS n FROM bets WHERE resolved_by = ? AND status = 'settled'").get(memberId).n,
      },
      badges,
      openPicks: pickRows.filter((r) => ['open', 'closed', 'validating', 'voting'].includes(r.status))
        .map((r) => ({ betId: r.id, question: r.question, status: r.status, closesAt: r.closes_at, optionLabel: r.label })),
      history: pickRows.filter((r) => ['settled', 'cancelled'].includes(r.status)).slice(0, 50)
        .map((r) => ({
          betId: r.id, question: r.question, status: r.status, optionLabel: r.label, settledAt: r.settled_at,
          correct: r.status === 'settled' && r.option_id === r.winning_option_id,
          points: r.status === 'settled' ? pointsOf.get(r.id, memberId, r.round).s : 0,
        })),
      ledger: this.db.prepare(`SELECT pt.id, pt.bet_id, pt.kind, pt.amount, pt.created_at, b.question
          FROM points pt JOIN bets b ON b.id = pt.bet_id WHERE pt.member_id = ? ORDER BY pt.id DESC LIMIT 100`).all(memberId)
        .map((r) => ({ id: r.id, betId: r.bet_id, question: r.question, kind: r.kind, amount: r.amount, createdAt: r.created_at })),
    };
  }

  /** Fil du groupe. Les paris ouverts automatiquement n'y figurent pas un par un : un résumé par ouverture suffit. */
  feed(groupId, limit = 60) {
    const comments = this.groups.settings(groupId).comments; // désactivés : pas de commentaires dans le fil
    return this.db.prepare(`SELECT e.*, b.question FROM events e LEFT JOIN bets b ON b.id = e.bet_id
        WHERE e.group_id = ? AND NOT (e.type = 'created' AND e.member_id IS NULL) AND (? OR e.type != 'commented') ORDER BY e.id DESC LIMIT ?`).all(groupId, comments ? 1 : 0, limit)
      .map((r) => ({ ...parseEvent(r), question: r.question ?? null }));
  }

  /** Tout le groupe en JSON, sans les secrets (lien d'invitation, PIN, sessions). */
  export(groupId) {
    const all = (sql) => this.db.prepare(sql).all(groupId);
    const group = this.groups.find(groupId);
    return {
      exportedAt: new Date(this.clock.now()).toISOString(),
      group: { id: group.id, name: group.name, emoji: group.emoji, createdAt: group.created_at, settings: this.groups.settings(groupId) },
      members: this.groups.members(groupId).map(publicMember),
      seasons: all('SELECT * FROM seasons WHERE group_id = ? ORDER BY ranking, starts_at')
        .map((s) => ({ ...s, standings: s.standings ? JSON.parse(s.standings) : null })),
      bets: all('SELECT * FROM bets WHERE group_id = ? ORDER BY created_at'),
      options: all('SELECT o.* FROM bet_options o JOIN bets b ON b.id = o.bet_id WHERE b.group_id = ? ORDER BY o.bet_id, o.position'),
      picks: all('SELECT p.* FROM picks p JOIN bets b ON b.id = p.bet_id WHERE b.group_id = ? ORDER BY p.created_at'),
      points: all('SELECT * FROM points WHERE group_id = ? ORDER BY id'),
      votes: all('SELECT v.* FROM votes v JOIN bets b ON b.id = v.bet_id WHERE b.group_id = ?'),
      disputes: all('SELECT d.* FROM disputes d JOIN bets b ON b.id = d.bet_id WHERE b.group_id = ?'),
      comments: all('SELECT c.* FROM comments c JOIN bets b ON b.id = c.bet_id WHERE b.group_id = ? ORDER BY c.created_at'),
      events: all('SELECT * FROM events WHERE group_id = ? ORDER BY id').map(parseEvent),
    };
  }
}
