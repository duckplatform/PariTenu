import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newId } from './lib/util.js';

// Une migration par version du schéma, jamais modifiée une fois livrée : on en ajoute une nouvelle.
export const MIGRATIONS = [
  // v1 — schéma initial
  `
  CREATE TABLE groups (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    emoji        TEXT NOT NULL,
    invite_token TEXT NOT NULL UNIQUE,
    settings     TEXT NOT NULL DEFAULT '{}',
    created_at   INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE members (
    id           TEXT PRIMARY KEY,
    group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    pseudo       TEXT NOT NULL COLLATE NOCASE,
    avatar       TEXT NOT NULL,
    pin_hash     TEXT,                      -- NULL : PIN réinitialisé, à choisir à la prochaine connexion
    role         TEXT NOT NULL CHECK (role IN ('admin','member')),
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','left')),
    failed_pins  INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    UNIQUE (group_id, pseudo)
  ) STRICT;

  CREATE TABLE sessions (
    id_hash      TEXT PRIMARY KEY,
    member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_member ON sessions(member_id);

  CREATE TABLE bets (
    id                 TEXT PRIMARY KEY,
    group_id           TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    creator_id         TEXT NOT NULL REFERENCES members(id),
    arbiter_id         TEXT REFERENCES members(id),   -- NULL : l'arbitre désigné s'est désisté
    category           TEXT NOT NULL,
    question           TEXT NOT NULL,
    details            TEXT NOT NULL DEFAULT '',
    kind               TEXT NOT NULL CHECK (kind IN ('yesno','multi')),
    status             TEXT NOT NULL CHECK (status IN ('open','closed','validating','voting','settled','cancelled')),
    closes_at          INTEGER NOT NULL,
    expected_at        INTEGER,
    closed_at          INTEGER,
    winning_option_id  TEXT,
    resolution_note    TEXT NOT NULL DEFAULT '',
    resolved_by        TEXT REFERENCES members(id),
    resolved_at        INTEGER,
    validation_ends_at INTEGER,
    vote_ends_at       INTEGER,
    contested          INTEGER NOT NULL DEFAULT 0,
    settled_at         INTEGER,
    cancel_reason      TEXT,
    cancel_note        TEXT NOT NULL DEFAULT '',
    round              INTEGER NOT NULL DEFAULT 0,  -- numéro du dernier règlement (une correction en ajoute un)
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX bets_group ON bets(group_id, status);

  CREATE TABLE bet_options (
    id       TEXT PRIMARY KEY,
    bet_id   TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    label    TEXT NOT NULL,
    position INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX bet_options_bet ON bet_options(bet_id);

  CREATE TABLE picks (
    bet_id     TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    member_id  TEXT NOT NULL REFERENCES members(id),
    option_id  TEXT NOT NULL REFERENCES bet_options(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (bet_id, member_id)
  ) STRICT;
  CREATE INDEX picks_member ON picks(member_id);

  -- Journal des points : on n'y modifie ni n'y supprime jamais rien, une correction ajoute des écritures inverses.
  CREATE TABLE points (
    id         INTEGER PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    member_id  TEXT NOT NULL REFERENCES members(id),
    bet_id     TEXT NOT NULL REFERENCES bets(id),
    round      INTEGER NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('gain','prime','reversal')),
    amount     INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX points_member ON points(member_id);
  CREATE INDEX points_bet ON points(bet_id);
  CREATE INDEX points_group ON points(group_id, created_at);

  -- Historique des paris et du groupe : sert à la fiche d'un pari et au fil d'activité.
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    bet_id     TEXT REFERENCES bets(id) ON DELETE CASCADE,
    member_id  TEXT REFERENCES members(id),
    type       TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX events_group ON events(group_id, id);
  CREATE INDEX events_bet ON events(bet_id);

  CREATE TABLE disputes (
    bet_id     TEXT PRIMARY KEY REFERENCES bets(id) ON DELETE CASCADE,
    member_id  TEXT NOT NULL REFERENCES members(id),
    reason     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE votes (
    bet_id     TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    member_id  TEXT NOT NULL REFERENCES members(id),
    choice     TEXT NOT NULL,          -- id d'une option, ou 'cancel'
    created_at INTEGER NOT NULL,
    PRIMARY KEY (bet_id, member_id)
  ) STRICT;

  CREATE TABLE comments (
    id         TEXT PRIMARY KEY,
    bet_id     TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    member_id  TEXT NOT NULL REFERENCES members(id),
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX comments_bet ON comments(bet_id);
  `,
  // v2 — paris reliés à une source de données (match, météo, cours…) : le résultat arrive tout seul
  `
  ALTER TABLE bets ADD COLUMN source TEXT;              -- id de la source (src/sources) ; NULL : pari tranché par un arbitre
  ALTER TABLE bets ADD COLUMN source_ref TEXT;          -- JSON : de quoi retrouver le résultat chez la source
  ALTER TABLE bets ADD COLUMN source_checked_at INTEGER;
  ALTER TABLE bet_options ADD COLUMN source_key TEXT;   -- réponse de la source qui fait gagner cette option
  CREATE INDEX bets_source ON bets(status, source) WHERE source IS NOT NULL;
  `,
  // v3 — classements par compétition (ou par catégorie) et par saison ; paris ouverts automatiquement, sans créateur.
  // La table bets est reconstruite (creator_id devient facultatif) : clés étrangères suspendues le temps de la copie.
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE seasons (
    id         TEXT PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    ranking    TEXT NOT NULL,             -- 'foot:fra.1' (compétition d'une source) ou 'cat:groupe' (catégorie)
    label      TEXT NOT NULL,             -- '2026-27', 'Automne 2026'
    starts_at  INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL,
    closed_at  INTEGER,                   -- NULL : saison en cours, ou finie avec des résultats encore attendus
    standings  TEXT,                      -- JSON figé à la clôture : [{ memberId, score, played, correct, rank }]
    UNIQUE (group_id, ranking, label)
  ) STRICT;
  CREATE INDEX seasons_open ON seasons(ends_at) WHERE closed_at IS NULL;

  CREATE TABLE bets_v3 (
    id                 TEXT PRIMARY KEY,
    group_id           TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    creator_id         TEXT REFERENCES members(id),   -- NULL : pari ouvert automatiquement (source de données)
    arbiter_id         TEXT REFERENCES members(id),
    category           TEXT NOT NULL,
    question           TEXT NOT NULL,
    details            TEXT NOT NULL DEFAULT '',
    kind               TEXT NOT NULL CHECK (kind IN ('yesno','multi')),
    status             TEXT NOT NULL CHECK (status IN ('open','closed','validating','voting','settled','cancelled')),
    closes_at          INTEGER NOT NULL,
    expected_at        INTEGER,
    closed_at          INTEGER,
    winning_option_id  TEXT,
    resolution_note    TEXT NOT NULL DEFAULT '',
    resolved_by        TEXT REFERENCES members(id),
    resolved_at        INTEGER,
    validation_ends_at INTEGER,
    vote_ends_at       INTEGER,
    contested          INTEGER NOT NULL DEFAULT 0,
    settled_at         INTEGER,
    cancel_reason      TEXT,
    cancel_note        TEXT NOT NULL DEFAULT '',
    round              INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    source             TEXT,
    source_ref         TEXT,
    source_checked_at  INTEGER,
    ranking            TEXT,                          -- classement du pari (voir seasons.ranking) ; rempli au démarrage s'il manque
    season_id          TEXT REFERENCES seasons(id)
  ) STRICT;
  INSERT INTO bets_v3 (id, group_id, creator_id, arbiter_id, category, question, details, kind, status, closes_at, expected_at,
      closed_at, winning_option_id, resolution_note, resolved_by, resolved_at, validation_ends_at, vote_ends_at, contested,
      settled_at, cancel_reason, cancel_note, round, created_at, updated_at, source, source_ref, source_checked_at)
    SELECT id, group_id, creator_id, arbiter_id, category, question, details, kind, status, closes_at, expected_at,
      closed_at, winning_option_id, resolution_note, resolved_by, resolved_at, validation_ends_at, vote_ends_at, contested,
      settled_at, cancel_reason, cancel_note, round, created_at, updated_at, source, source_ref, source_checked_at FROM bets;
  DROP TABLE bets;
  ALTER TABLE bets_v3 RENAME TO bets;
  CREATE INDEX bets_group ON bets(group_id, status);
  CREATE INDEX bets_source ON bets(status, source) WHERE source IS NOT NULL;
  CREATE INDEX bets_season ON bets(season_id);
  `,
  },
  // v4 — un joueur dans plusieurs groupes (un pronostic compte partout où le même pari est ouvert),
  // compétitions suivies par chaque membre, cotes fixes des paris sportifs.
  `
  CREATE TABLE players (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  ) STRICT;
  -- Un jeton par appareil (cookie pt_player) : le même joueur sur son téléphone et son PC.
  CREATE TABLE player_tokens (
    token_hash TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX player_tokens_player ON player_tokens(player_id);
  ALTER TABLE members ADD COLUMN player_id TEXT REFERENCES players(id);
  CREATE INDEX members_player ON members(player_id);

  CREATE TABLE follows (
    member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    feed       TEXT NOT NULL,             -- compétition ('foot:fra.1') ou source hors sport ('meteo')
    choice     TEXT NOT NULL CHECK (choice IN ('in','out')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (member_id, feed)
  ) STRICT;

  -- group : cote du groupe (paris entre amis) ; bookmaker : cote des bookmakers ; fixed : barème fixe (pas de cote connue)
  ALTER TABLE bets ADD COLUMN scoring TEXT NOT NULL DEFAULT 'group' CHECK (scoring IN ('group','fixed','bookmaker'));
  ALTER TABLE bet_options ADD COLUMN odds REAL;   -- cote fixe de l'option (paris sportifs)

  -- Paris sportifs encore ouverts : barème fixe, en attendant une cote de bookmaker.
  UPDATE bets SET scoring = 'fixed' WHERE status = 'open'
    AND source IN ('foot','usfoot','rugby','basket','hockey','baseball','tennis','mma','f1','moto','afl');
  UPDATE bet_options SET odds = 2 WHERE bet_id IN (SELECT id FROM bets WHERE scoring = 'fixed');
  -- Qui a déjà parié sur une compétition (ou une source) la suit.
  INSERT OR IGNORE INTO follows (member_id, feed, choice, updated_at)
    SELECT DISTINCT p.member_id, CASE WHEN b.ranking LIKE 'cat:%' THEN b.source ELSE b.ranking END, 'in', MAX(p.created_at)
    FROM picks p JOIN bets b ON b.id = p.bet_id WHERE b.source IS NOT NULL AND b.ranking IS NOT NULL
    GROUP BY p.member_id, b.source, b.ranking;
  `,
  // v5 — une catégorie ne règle plus que ses paris maison ; les compétitions activées s'ouvrent quelle que soit leur catégorie.
  { run: separateManualCategories },
  // v6 — pseudo et avatar d'un joueur, les mêmes dans tous ses groupes (copiés dans members, qui sert à l'affichage).
  {
    sql: `
    ALTER TABLE players ADD COLUMN pseudo TEXT;
    ALTER TABLE players ADD COLUMN avatar TEXT;
    `,
    run: shareIdentities,
  },
  // v7 — paris de sport plus visuels : équipes ou pilotes (logos, photos, couleurs) et score en direct puis final, par
  // pari de source (ref.key, le même dans tous les groupes). Voir src/services/live.js.
  `
  CREATE TABLE source_events (
    key        TEXT PRIMARY KEY,
    media      TEXT,                 -- JSON : équipes ou pilotes
    live       TEXT,                 -- JSON : score, chrono, vainqueur, podium
    live_at    INTEGER,              -- dernière lecture du direct
    updated_at INTEGER NOT NULL
  ) STRICT;
  `,
  // v8 — un compte par joueur : un pseudo unique sur toute l'instance, un PIN et une connexion valables dans tous ses
  // groupes (voir src/services/accounts.js). members.pin_hash et sessions ne servent plus qu'aux comptes d'avant.
  {
    sql: `
    -- NULL : PIN encore dans members.pin_hash (plusieurs groupes, plusieurs PIN), ou à choisir (réinitialisé)
    ALTER TABLE players ADD COLUMN pin_hash TEXT;
    ALTER TABLE players ADD COLUMN failed_pins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN lock_level INTEGER NOT NULL DEFAULT 0;  -- blocages d'affilée : chacun dure deux fois plus

    CREATE TABLE player_sessions (
      id_hash      TEXT PRIMARY KEY,
      player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX player_sessions_player ON player_sessions(player_id);

    -- PIN oublié : un admin de chacun des groupes du joueur doit le réinitialiser (un seul admin ne prend pas le compte).
    CREATE TABLE pin_resets (
      player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      by_member  TEXT NOT NULL REFERENCES members(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, group_id)
    ) STRICT;
    `,
    run: createAccounts,
  },
  // v9 — admin de l'instance (src/services/admin.js) : son mot de passe, ses sessions et le journal de ses actions ; les
  // coupons qu'il génère (src/services/coupons.js) remplacent le code de l'instance pour créer un groupe.
  `
  CREATE TABLE coupons (
    id             TEXT PRIMARY KEY,
    code_hash      TEXT NOT NULL UNIQUE,   -- sha256 du code : le code n'est montré qu'à sa création
    hint           TEXT NOT NULL,          -- ses 4 derniers caractères, pour le reconnaître
    note           TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER,                -- NULL : sans date limite (il expire quand même en servant)
    revoked_at     INTEGER,
    used_at        INTEGER,
    used_by        TEXT REFERENCES players(id) ON DELETE SET NULL,
    used_by_pseudo TEXT,                   -- gardés même si le compte ou le groupe est supprimé
    group_id       TEXT REFERENCES groups(id) ON DELETE SET NULL,
    group_name     TEXT
  ) STRICT;

  CREATE TABLE admin_auth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    failed        INTEGER NOT NULL DEFAULT 0,
    locked_until  INTEGER NOT NULL DEFAULT 0,
    lock_level    INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE admin_sessions (
    id_hash      TEXT PRIMARY KEY,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT ''
  ) STRICT;

  -- Tout ce que fait l'admin (et ses connexions) : on n'y modifie ni n'y supprime rien.
  CREATE TABLE admin_log (
    id      INTEGER PRIMARY KEY,
    at      INTEGER NOT NULL,
    action  TEXT NOT NULL,
    target  TEXT NOT NULL DEFAULT '',     -- player:<id>, group:<id>, coupon:<id>
    summary TEXT NOT NULL DEFAULT '',
    ip      TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE INDEX admin_log_at ON admin_log(at);
  `,
  // v10 — un pari venu d'une source est réglé dès le résultat officiel (plus de validation ni de contestation) : ceux qui
  // attendaient la fin de leurs 24 h sont réglés au prochain balayage, datés de leur résultat.
  `
  UPDATE bets SET validation_ends_at = resolved_at WHERE source IS NOT NULL AND status = 'validating';
  `,
  // v11 — réglages de l'instance, par l'admin du site : les sources externes coupées pour tous les groupes.
  `
  CREATE TABLE instance_settings (
    key   TEXT PRIMARY KEY,   -- disabled_sources : JSON, ids des sources coupées
    value TEXT NOT NULL
  ) STRICT;
  `,
  // v12 — Formule 1 : une course annulée annule le pari dès qu'elle sort du calendrier officiel (plus d'attente de
  // 30 jours) ; les paris déjà ouverts le disent aussi.
  `
  UPDATE bets SET details = replace(details, 'Course annulée : pari annulé au bout de 30 jours.',
    'Course annulée : pari annulé dès qu’elle sort du calendrier officiel ; course repoussée : le pari suit sa nouvelle date.')
  WHERE source = 'f1';
  `,
  // v13 — les paris de sport s'appellent « sport · compétition · rencontre », sans « qui gagne ? » : ceux déjà ouverts
  // (et les anciens, dans l'historique et le fil) aussi.
  { run: retitleSportBets },
  // v14 — plus de lien d'invitation : l'adresse du groupe (/<adresse>) sert à entrer et à se connecter. Celle des groupes
  // existants est l'adresse qu'ils ont déjà (leur id) ; les anciens liens d'invitation ne marchent plus. « Changer le
  // lien » en tire une nouvelle (l'id, interne, ne change jamais).
  `
  ALTER TABLE groups RENAME COLUMN invite_token TO address;
  UPDATE groups SET address = id;
  `,
];

/**
 * v8 : un compte par joueur.
 * - Les joueurs sans aucun membre (restes d'un rattachement d'appareils) disparaissent.
 * - Chaque membre actif sans joueur (pas revenu depuis les joueurs multi-groupes) reçoit le sien.
 * - Deux joueurs au même pseudo : le plus ancien le garde, l'autre devient « pseudo 2 ».
 * - Le PIN d'un joueur qui n'en a qu'un devient celui du compte ; avec plusieurs PIN (un par groupe), le premier tapé à la
 *   prochaine connexion devient celui du compte (src/services/accounts.js).
 */
function createAccounts(db) {
  db.exec(`DELETE FROM player_tokens WHERE player_id NOT IN (SELECT player_id FROM members WHERE player_id IS NOT NULL);
    DELETE FROM players WHERE id NOT IN (SELECT player_id FROM members WHERE player_id IS NOT NULL);`);
  for (const m of db.prepare("SELECT id, pseudo, avatar, created_at FROM members WHERE status = 'active' AND player_id IS NULL").all()) {
    const playerId = newId();
    db.prepare('INSERT INTO players (id, pseudo, avatar, created_at) VALUES (?, ?, ?, ?)').run(playerId, m.pseudo, m.avatar, m.created_at);
    db.prepare('UPDATE members SET player_id = ? WHERE id = ?').run(playerId, m.id);
  }
  for (const { id } of db.prepare('SELECT id FROM players WHERE pseudo IS NULL').all()) {
    const m = db.prepare("SELECT pseudo, avatar FROM members WHERE player_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(id);
    if (m) db.prepare('UPDATE players SET pseudo = ?, avatar = ? WHERE id = ?').run(m.pseudo, m.avatar, id);
  }

  const players = db.prepare('SELECT id, pseudo, created_at FROM players WHERE pseudo IS NOT NULL ORDER BY created_at, id').all();
  const kept = new Set();
  const playerHas = db.prepare('SELECT 1 FROM players WHERE pseudo = ? COLLATE NOCASE');
  // Le pseudo est libre dans les groupes du joueur (personne d'autre ne le porte, même parti).
  const freeFor = db.prepare(`SELECT 1 FROM members o JOIN members m ON m.group_id = o.group_id
    WHERE m.player_id = ? AND (o.player_id IS NULL OR o.player_id != m.player_id) AND o.pseudo = ? LIMIT 1`);
  for (const p of players) {
    const key = p.pseudo.toLowerCase();
    if (!kept.has(key)) { kept.add(key); continue; }
    let pseudo;
    for (let n = 2; ; n++) {
      pseudo = `${p.pseudo.slice(0, 19 - String(n).length)} ${n}`;
      if (!kept.has(pseudo.toLowerCase()) && !playerHas.get(pseudo) && !freeFor.get(p.id, pseudo)) break;
    }
    kept.add(pseudo.toLowerCase());
    db.prepare('UPDATE players SET pseudo = ? WHERE id = ?').run(pseudo, p.id);
    db.prepare("UPDATE members SET pseudo = ? WHERE player_id = ? AND status = 'active'").run(pseudo, p.id);
  }

  for (const { id } of db.prepare('SELECT id FROM players').all()) {
    const pins = db.prepare("SELECT pin_hash FROM members WHERE player_id = ? AND status = 'active' AND pin_hash IS NOT NULL").all(id);
    if (pins.length !== 1) continue;
    db.prepare('UPDATE players SET pin_hash = ? WHERE id = ?').run(pins[0].pin_hash, id);
    db.prepare('UPDATE members SET pin_hash = NULL WHERE player_id = ?').run(id);
  }
  db.exec('CREATE UNIQUE INDEX players_pseudo ON players(pseudo COLLATE NOCASE)');
}

/**
 * v6 : chaque joueur garde le pseudo et l'avatar de son entrée la plus récente (son dernier choix), recopiés dans ses
 * autres groupes ; là où ce pseudo est déjà pris par quelqu'un d'autre, seul l'avatar change.
 */
function shareIdentities(db) {
  const latest = db.prepare(`SELECT m.player_id, m.pseudo, m.avatar FROM members m WHERE m.player_id IS NOT NULL AND m.status = 'active'
    AND m.created_at = (SELECT MAX(created_at) FROM members x WHERE x.player_id = m.player_id AND x.status = 'active')`).all();
  const taken = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND pseudo = ? AND id != ?');
  for (const { player_id: playerId, pseudo, avatar } of latest) {
    db.prepare('UPDATE players SET pseudo = ?, avatar = ? WHERE id = ?').run(pseudo, avatar, playerId);
    for (const m of db.prepare("SELECT id, group_id FROM members WHERE player_id = ? AND status = 'active'").all(playerId)) {
      const free = !taken.get(m.group_id, pseudo, m.id);
      db.prepare(`UPDATE members SET avatar = ?${free ? ', pseudo = ?' : ''} WHERE id = ?`).run(avatar, ...(free ? [pseudo] : []), m.id);
    }
  }
}

/**
 * v5 : jusqu'ici, il fallait activer une catégorie (Sport…) pour recevoir ses compétitions, ce qui autorisait aussi les
 * paris maison de cette catégorie. Une catégorie activée seulement pour ses compétitions (aucun pari maison dedans)
 * perd ses paris maison ; une compétition choisie dans une catégorie coupée reste coupée.
 */
function separateManualCategories(db) {
  const categoryOf = (sourceId) => ({ crypto: 'eco', meteo: 'meteo', manifold: 'actu' })[sourceId] ?? 'sport';
  const used = db.prepare('SELECT 1 FROM bets WHERE group_id = ? AND category = ? AND source IS NULL LIMIT 1');
  for (const group of db.prepare('SELECT id, settings FROM groups').all()) {
    let settings;
    try { settings = JSON.parse(group.settings || '{}'); } catch { continue; }
    if (!Array.isArray(settings.categories) || !settings.sources) continue;
    const wasOff = new Set(settings.categories.filter((c) => c.hidden).map((c) => c.id)); // avant toute modification
    for (const [sourceId, cfg] of Object.entries(settings.sources)) {
      if (!cfg?.competitions?.length) continue;
      const category = settings.categories.find((c) => c.id === categoryOf(sourceId));
      if (!category) continue;
      if (wasOff.has(category.id)) cfg.competitions = [];
      else if (!used.get(group.id, category.id)) category.hidden = true;
    }
    db.prepare('UPDATE groups SET settings = ? WHERE id = ?').run(JSON.stringify(settings), group.id);
  }
}

// v13 : le sport de chaque source au moment du changement (les titres des nouveaux paris viennent des sources).
const SPORT_TITLES = {
  foot: 'Football', usfoot: 'Football américain', rugby: 'Rugby', basket: 'Basket', hockey: 'Hockey sur glace',
  baseball: 'Baseball', afl: 'Football australien', tennis: 'Tennis', mma: 'MMA', padel: 'Padel',
};
const ESPN_TEAMS = new Set(['foot', 'usfoot', 'rugby', 'basket', 'hockey', 'baseball', 'afl']);

/** Le nouveau titre d'un pari de sport (« Football · Ligue 1 · Lille – Lens »), ou null s'il ne change pas. */
export function sportBetTitle(source, question, label = '') {
  const join = (...parts) => parts.filter(Boolean).join(' · ');
  let m;
  if (ESPN_TEAMS.has(source) && (m = /^(.*) : qui gagne \?$/.exec(question))) {
    // ref.label : « Ligue 1 · Lille – Lens » : la compétition est devant la rencontre.
    const competition = label.endsWith(` · ${m[1]}`) ? label.slice(0, -(m[1].length + 3)) : null;
    return join(SPORT_TITLES[source], competition, m[1]);
  }
  if (['tennis', 'mma', 'padel'].includes(source) && (m = /^(.*) : (.*), qui gagne \?$/.exec(question))) return join(SPORT_TITLES[source], m[1], m[2]);
  if (source === 'moto') {
    if ((m = /^Qui gagne le sprint (\S+) du (.*) \?$/.exec(question))) return join('Moto', m[1], `${m[2]}, sprint`);
    if ((m = /^Qui gagne le (.*) en (\S+) \?$/.exec(question))) return join('Moto', m[2], m[1]);
  }
  if (source === 'f1') {
    if ((m = /^Qui gagne le (.*) \?$/.exec(question))) return join('Formule 1', m[1]);
    if (!question.startsWith('Formule 1 · ')) return join('Formule 1', question);
  }
  return null;
}

function retitleSportBets(db) {
  const update = db.prepare('UPDATE bets SET question = ? WHERE id = ?');
  for (const bet of db.prepare('SELECT id, source, source_ref, question FROM bets WHERE source IS NOT NULL').all()) {
    let label = '';
    try { label = JSON.parse(bet.source_ref)?.label ?? ''; } catch { /* référence illisible : sans compétition */ }
    const title = sportBetTitle(bet.source, bet.question, label);
    if (title) update.run(title, bet.id);
  }
}

const depth = new WeakMap();

/** Exécute fn dans une transaction (réentrant : un appel imbriqué rejoint la transaction en cours). */
export function tx(db, fn) {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth.set(db, 0);
  }
}

/** Amène la base jusqu'à la version demandée (la dernière, sauf dans les tests des migrations). */
function migrate(db, target = MIGRATIONS.length) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const current = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? 0);
  for (let v = current; v < target; v++) {
    // Une migration : du SQL, ou une fonction quand il faut réécrire des données (réglages en JSON…).
    const { sql = '', run = null, foreignKeysOff = false } = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] } : MIGRATIONS[v];
    // Reconstruire une table : sans cette pause, DROP TABLE effacerait en cascade les lignes qui la référencent.
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(db, () => {
        if (sql) db.exec(sql);
        run?.(db);
        if (foreignKeysOff && db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${v + 1} : clés étrangères cassées`);
        db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(String(v + 1));
      });
    } finally {
      if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

export function openDatabase(file, { version } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, version);
  return db;
}
