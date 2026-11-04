// npm run backup [-- <étiquette>] : copie cohérente de la base (VACUUM INTO), même pendant que l'app tourne, dans
// <dossier de la base>/backups/. Sert avant une mise à jour, pour déménager l'app sur un autre serveur et en tâche planifiée.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildConfig, loadDotEnv } from '../src/config.js';

loadDotEnv();
const { dbPath } = buildConfig();
const label = (process.argv[2] ?? 'manuelle').replace(/[^\w-]+/g, '-');
const out = path.join(path.dirname(dbPath), 'backups', `paritenu-${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.db`);

fs.mkdirSync(path.dirname(out), { recursive: true });
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
db.close();
const copy = new DatabaseSync(out, { readOnly: true });
const count = (table) => copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.log(`Sauvegarde : ${out}`);
console.log(`  ${count('groups')} groupes · ${count('players')} comptes · ${count('bets')} paris · ${count('picks')} pronostics`);
copy.close();
