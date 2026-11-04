// Migrations qui réécrivent des données : essayées sur une base remise à la version précédente, puis rouverte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { openDatabase } from '../src/db.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paritenu-migrations-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Ce qu'il faut défaire pour remettre une base à la version d'avant (les migrations qui changent le schéma).
const UNDO = {
  6: 'ALTER TABLE players DROP COLUMN avatar; ALTER TABLE players DROP COLUMN pseudo;',
  7: 'DROP TABLE source_events;',
  8: `DROP INDEX players_pseudo; DROP TABLE pin_resets; DROP TABLE player_sessions;
    ALTER TABLE players DROP COLUMN lock_level; ALTER TABLE players DROP COLUMN locked_until;
    ALTER TABLE players DROP COLUMN failed_pins; ALTER TABLE players DROP COLUMN pin_hash;`,
  9: 'DROP TABLE admin_log; DROP TABLE admin_sessions; DROP TABLE admin_auth; DROP TABLE coupons;',
  11: 'DROP TABLE instance_settings;',
  14: 'ALTER TABLE groups RENAME COLUMN address TO invite_token;',
  15: 'DROP INDEX admin_log_player; ALTER TABLE admin_log DROP COLUMN player_pseudo; ALTER TABLE admin_log DROP COLUMN player_id;',
};

/**
 * Une base remise à la version `version`, remplie par fill(db) à cette version, puis rouverte : les migrations suivantes
 * s'appliquent, jusqu'à la version upTo (la dernière par défaut).
 */
function reopenFrom(version, name, fill, upTo) {
  const file = path.join(dir, `v${version}-${name}.db`);
  const db = openDatabase(file);
  for (const v of Object.keys(UNDO).map(Number).filter((v) => v > version).sort((a, b) => b - a)) db.exec(UNDO[v]);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(version));
  fill(db);
  db.close();
  return openDatabase(file, { version: upTo });
}

/**
 * Une base laissée à la version `version` avec ces groupes ({ id, settings, manual: catégories qui ont un pari maison }),
 * rouverte pour appliquer les migrations suivantes : les réglages de chaque groupe après coup.
 */
function migrateFrom(version, groups) {
  const db = reopenFrom(version, groups.map((g) => g.id).join('-'), (base) => fillGroups(base, groups), version + 1);
  const settings = Object.fromEntries(db.prepare('SELECT id, settings FROM groups').all().map((r) => [r.id, JSON.parse(r.settings)]));
  db.close();
  return settings;
}

function fillGroups(db, groups) {
  for (const g of groups) {
    db.prepare("INSERT INTO groups (id, name, emoji, invite_token, settings, created_at) VALUES (?, ?, '🏆', ?, ?, 0)")
      .run(g.id, g.id, `lien-${g.id}`, JSON.stringify(g.settings));
    for (const category of g.manual ?? []) {
      db.prepare("INSERT INTO bets (id, group_id, category, question, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, ?, 'Julien arrive en retard ?', 'yesno', 'settled', 0, 0, 0)")
        .run(`${g.id}-${category}`, g.id, category);
    }
  }
}

const categories = (on) => ['groupe', 'sport', 'meteo', 'eco'].map((id) => ({ id, emoji: '⭐', label: id, hidden: !on.includes(id) }));
const offIds = (s) => s.categories.filter((c) => c.hidden).map((c) => c.id);

describe('v5 : les catégories ne règlent plus que les paris maison', () => {
  it('une catégorie activée seulement pour ses compétitions perd ses paris maison ; les compétitions restent', () => {
    const migrated = migrateFrom(4, [
      // « feu de camp » : Sport activé pour la Ligue 1 et la moto, aucun pari maison de sport.
      { id: 'feu', settings: { categories: categories(['sport']), sources: { foot: { competitions: ['fra.1'] }, moto: { competitions: ['motogp'] }, meteo: { competitions: [] } } } },
      // Des paris maison de sport existent : on n'y touche pas.
      { id: 'foot', settings: { categories: categories(['groupe', 'sport']), sources: { foot: { competitions: ['fra.1'] } } }, manual: ['sport'] },
    ]);
    assert.deepEqual(offIds(migrated.feu), ['groupe', 'sport', 'meteo', 'eco'], 'plus de paris maison du tout');
    assert.deepEqual([migrated.feu.sources.foot.competitions, migrated.feu.sources.moto.competitions], [['fra.1'], ['motogp']]);
    assert.deepEqual(offIds(migrated.foot), ['meteo', 'eco']);
    assert.deepEqual(migrated.foot.sources.foot.competitions, ['fra.1']);
  });

  it('une compétition choisie dans une catégorie coupée reste coupée ; réglages par défaut inchangés', () => {
    const untouched = { sources: { foot: { competitions: ['fra.1'] } } };
    const migrated = migrateFrom(4, [
      { id: 'meteo', settings: { categories: categories(['groupe']), sources: { meteo: { competitions: ['meteo'], params: { place: { name: 'Lyon' } } } } } },
      { id: 'defaut', settings: untouched },
    ]);
    assert.deepEqual(migrated.meteo.sources.meteo, { competitions: [], params: { place: { name: 'Lyon' } } });
    assert.deepEqual(offIds(migrated.meteo), ['sport', 'meteo', 'eco']);
    assert.deepEqual(migrated.defaut, untouched);
  });
});

describe('v6 : un pseudo et un avatar par joueur, dans tous ses groupes', () => {
  it('le dernier choix du joueur gagne partout ; un pseudo déjà pris ne change que l’avatar', () => {
    const db = reopenFrom(5, 'joueurs', (base) => {
      fillGroups(base, [{ id: 'feu', settings: {} }, { id: 'bureau', settings: {} }, { id: 'foot', settings: {} }]);
      base.prepare('INSERT INTO players (id, created_at) VALUES (?, 0)').run('p1');
      const member = base.prepare("INSERT INTO members (id, group_id, pseudo, avatar, role, created_at, player_id) VALUES (?, ?, ?, ?, 'member', ?, ?)");
      member.run('a', 'feu', 'toto', '🦊', 1, 'p1');
      member.run('b', 'bureau', 'Hugo', '🐲', 2, 'p1');
      member.run('c', 'foot', 'Toto', '⚽', 3, 'p1'); // son dernier choix
      member.run('d', 'bureau', 'Max', '🐻', 4, null);
      member.run('e', 'feu', 'Max', '🦉', 5, null); // les autres joueurs ne changent pas
    }, 6);
    const rows = Object.fromEntries(db.prepare('SELECT id, pseudo, avatar FROM members').all().map((m) => [m.id, `${m.pseudo} ${m.avatar}`]));
    assert.deepEqual(rows, { a: 'Toto ⚽', b: 'Toto ⚽', c: 'Toto ⚽', d: 'Max 🐻', e: 'Max 🦉' });
    assert.deepEqual({ ...db.prepare('SELECT pseudo, avatar FROM players WHERE id = ?').get('p1') }, { pseudo: 'Toto', avatar: '⚽' });
    db.close();
  });

  it('pseudo pris par quelqu’un d’autre dans un des groupes : on y garde l’ancien pseudo', () => {
    const db = reopenFrom(5, 'collision', (base) => {
      fillGroups(base, [{ id: 'feu', settings: {} }, { id: 'foot', settings: {} }]);
      base.prepare('INSERT INTO players (id, created_at) VALUES (?, 0)').run('p1');
      const member = base.prepare("INSERT INTO members (id, group_id, pseudo, avatar, role, created_at, player_id) VALUES (?, ?, ?, ?, 'member', ?, ?)");
      member.run('a', 'feu', 'Hugo', '🦊', 1, 'p1');
      member.run('x', 'feu', 'Léa', '🐻', 2, null);
      member.run('b', 'foot', 'Léa', '⚽', 3, 'p1'); // son dernier choix, déjà pris dans « feu »
    }, 6);
    const rows = Object.fromEntries(db.prepare('SELECT id, pseudo, avatar FROM members').all().map((m) => [m.id, `${m.pseudo} ${m.avatar}`]));
    assert.deepEqual(rows, { a: 'Hugo ⚽', x: 'Léa 🐻', b: 'Léa ⚽' });
    db.close();
  });
});

describe('v8 : un compte par joueur', () => {
  it('joueurs sans membre effacés, un compte pour chaque membre sans joueur, pseudos en double numérotés, PIN repris', () => {
    const db = reopenFrom(7, 'comptes', (base) => {
      fillGroups(base, [{ id: 'feu', settings: {} }, { id: 'foot', settings: {} }]);
      const player = base.prepare('INSERT INTO players (id, pseudo, avatar, created_at) VALUES (?, ?, ?, ?)');
      player.run('old', 'Max', '🐻', 1);
      player.run('dup', 'max', '🦉', 2); // un autre Max, d'un autre groupe
      player.run('orphan', 'Zed', '🐲', 3); // reste d'un rattachement d'appareils : plus aucun membre
      player.run('multi', 'Léa', '🦊', 4);
      base.prepare('INSERT INTO player_tokens (token_hash, player_id, created_at) VALUES (?, ?, 0)').run('jeton', 'orphan');
      const member = base.prepare("INSERT INTO members (id, group_id, pseudo, avatar, role, status, pin_hash, created_at, player_id) VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?)");
      member.run('m1', 'feu', 'Max', '🐻', 'active', 'pin-old', 1, 'old');
      member.run('m2', 'foot', 'max', '🦉', 'active', 'pin-dup', 2, 'dup');
      member.run('m3', 'feu', 'Léa', '🦊', 'active', 'pin-a', 3, 'multi');
      member.run('m4', 'foot', 'Léa', '🦊', 'active', 'pin-b', 4, 'multi');
      member.run('m5', 'foot', 'Nina', '🐯', 'active', 'pin-n', 5, null); // pas revenue depuis les joueurs multi-groupes
      member.run('m6', 'feu', 'Ancien membre 1', '👤', 'left', null, 6, null);
    });
    const players = Object.fromEntries(db.prepare('SELECT id, pseudo, pin_hash FROM players').all().map((p) => [p.id, `${p.pseudo} ${p.pin_hash}`]));
    const nina = db.prepare("SELECT player_id FROM members WHERE id = 'm5'").get().player_id;
    assert.deepEqual(players, { old: 'Max pin-old', dup: 'max 2 pin-dup', multi: 'Léa null', [nina]: 'Nina pin-n' });
    const members = Object.fromEntries(db.prepare('SELECT id, pseudo, pin_hash, player_id FROM members').all().map((m) => [m.id, `${m.pseudo} ${m.pin_hash} ${m.player_id}`]));
    assert.deepEqual(members, {
      m1: 'Max null old', m2: 'max 2 null dup', m3: 'Léa pin-a multi', m4: 'Léa pin-b multi', m5: `Nina null ${nina}`, m6: 'Ancien membre 1 null null',
    }, 'plusieurs PIN : gardés, le premier tapé deviendra celui du compte');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM player_tokens').get().n, 0);
    assert.throws(() => db.prepare("INSERT INTO players (id, pseudo, avatar, created_at) VALUES ('x', 'NINA', '🐯', 9)").run(), /UNIQUE/);
    db.close();
  });
});

describe('v10 : un pari de source est réglé dès son résultat officiel', () => {
  it('les paris de source en validation sont réglés au prochain balayage, datés de leur résultat ; les paris maison attendent', () => {
    const db = reopenFrom(9, 'source-en-validation', (base) => {
      base.prepare("INSERT INTO groups (id, name, emoji, invite_token, settings, created_at) VALUES ('g1', 'Les Potes', '🍻', 'jeton', '{}', 1)").run();
      const bet = base.prepare(`INSERT INTO bets (id, group_id, category, question, kind, status, closes_at, resolved_at, validation_ends_at, created_at, updated_at, source)
        VALUES (?, 'g1', 'sport', 'Lille – Lens : qui gagne ?', 'yesno', 'validating', 1, 1000, 9000, 1, 1, ?)`);
      bet.run('source', 'foot');
      bet.run('maison', null);
    });
    assert.deepEqual(db.prepare('SELECT id, validation_ends_at FROM bets ORDER BY id').all().map((b) => [b.id, b.validation_ends_at]),
      [['maison', 9000], ['source', 1000]]);
    db.close();
  });
});

describe('v12 : une course de F1 annulée annule le pari tout de suite', () => {
  it('les paris de F1 déjà ouverts ne parlent plus d’attendre 30 jours ; les autres textes ne bougent pas', () => {
    const old = 'Résultat : vainqueur officiel de la course (classement Jolpica / FIA). Course annulée : pari annulé au bout de 30 jours.';
    const db = reopenFrom(11, 'f1-annulee', (base) => {
      base.prepare("INSERT INTO groups (id, name, emoji, invite_token, settings, created_at) VALUES ('g1', 'Les Potes', '🍻', 'jeton', '{}', 1)").run();
      const bet = base.prepare(`INSERT INTO bets (id, group_id, category, question, details, kind, status, closes_at, created_at, updated_at, source)
        VALUES (?, 'g1', 'sport', 'Qui gagne le Mexico City Grand Prix ?', ?, 'multi', 'open', 1, 1, 1, ?)`);
      bet.run('f1', old, 'f1');
      bet.run('maison', 'Course annulée : pari annulé au bout de 30 jours.', null);
    });
    assert.deepEqual(db.prepare('SELECT id, details FROM bets ORDER BY id').all().map((b) => [b.id, b.details]), [
      ['f1', 'Résultat : vainqueur officiel de la course (classement Jolpica / FIA). Course annulée : pari annulé dès qu’elle sort du calendrier officiel ; course repoussée : le pari suit sa nouvelle date.'],
      ['maison', 'Course annulée : pari annulé au bout de 30 jours.'],
    ]);
    db.close();
  });
});

describe('v13 : les paris de sport s’appellent « sport · compétition · rencontre »', () => {
  it('plus de « qui gagne ? » : foot, tennis, MMA, padel, moto, F1 ; les paris maison ne bougent pas', () => {
    const titles = [
      ['foot', 'Lille – Lens : qui gagne ?', 'Ligue 1 · Lille – Lens'],
      ['tennis', 'Rolex Paris Masters, 1er tour : Quentin Halys – Arthur Fery, qui gagne ?', 'ATP · Rolex Paris Masters · Quentin Halys – Arthur Fery'],
      ['mma', 'UFC Fight Night: Moicano vs. Nolan : Renato Moicano – Tom Nolan, qui gagne ?', 'UFC · Renato Moicano – Tom Nolan'],
      ['padel', 'Kuwait Major, finale : Coello / Tapia – Tello / Arce, qui gagne ?', 'Premier Padel · Kuwait Major · Coello / Tapia – Tello / Arce'],
      ['moto', 'Qui gagne le Grand Prix du Qatar en MotoGP ?', 'MotoGP · Grand Prix du Qatar'],
      ['moto', 'Qui gagne le sprint Moto2 du Grand Prix du Qatar ?', 'Moto2 · Grand Prix du Qatar'],
      ['f1', 'Qui gagne le Mexico City Grand Prix ?', 'F1 · Mexico City Grand Prix'],
      ['f1', 'São Paulo · Autódromo José Carlos Pace', 'F1 · Brazilian Grand Prix'],
      [null, 'Qui gagne le tournoi de Mario Kart ?', ''],
    ];
    const db = reopenFrom(12, 'titres-sport', (base) => {
      base.prepare("INSERT INTO groups (id, name, emoji, invite_token, settings, created_at) VALUES ('g1', 'Les Potes', '🍻', 'jeton', '{}', 1)").run();
      const bet = base.prepare(`INSERT INTO bets (id, group_id, category, question, kind, status, closes_at, created_at, updated_at, source, source_ref)
        VALUES (?, 'g1', 'sport', ?, 'multi', 'open', 1, 1, 1, ?, ?)`);
      titles.forEach(([source, question, label], i) => bet.run(`b${i}`, question, source, source ? JSON.stringify({ label }) : null));
    });
    assert.deepEqual(db.prepare('SELECT question FROM bets ORDER BY id').all().map((b) => b.question), [
      'Football · Ligue 1 · Lille – Lens',
      'Tennis · Rolex Paris Masters, 1er tour · Quentin Halys – Arthur Fery',
      'MMA · UFC Fight Night: Moicano vs. Nolan · Renato Moicano – Tom Nolan',
      'Padel · Kuwait Major, finale · Coello / Tapia – Tello / Arce',
      'Moto · MotoGP · Grand Prix du Qatar',
      'Moto · Moto2 · Grand Prix du Qatar, sprint',
      'Formule 1 · Mexico City Grand Prix',
      'Formule 1 · São Paulo · Autódromo José Carlos Pace',
      'Qui gagne le tournoi de Mario Kart ?',
    ]);
    db.close();
  });
});

describe('v14 : l’adresse du groupe remplace le lien d’invitation', () => {
  it('chaque groupe garde l’adresse qu’il a déjà (son id) ; les anciens liens d’invitation ne mènent plus à rien', () => {
    const db = reopenFrom(13, 'adresse-du-groupe', (base) => {
      const add = base.prepare("INSERT INTO groups (id, name, emoji, invite_token, settings, created_at) VALUES (?, 'Les Potes', '🍻', ?, '{}', 1)");
      add.run('a1b2c3d4e5f60718', 'ancien-jeton-1');
      add.run('0123456789abcdef', 'ancien-jeton-2');
    });
    assert.deepEqual(db.prepare('SELECT id, address FROM groups ORDER BY id').all().map((g) => [g.id, g.address]),
      [['0123456789abcdef', '0123456789abcdef'], ['a1b2c3d4e5f60718', 'a1b2c3d4e5f60718']]);
    assert.ok(!db.prepare('PRAGMA table_info(groups)').all().some((c) => c.name === 'invite_token'), 'plus de colonne invite_token');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM groups WHERE address LIKE 'ancien-jeton%'").get().n, 0);
    db.close();
  });
});
