// Mot de passe de l'admin de l'instance (/admin) : choisi ou changé ici, sur le serveur, jamais depuis le site.
// npm run admin  →  tape deux fois le mot de passe (rien ne s'affiche). Change aussi un mot de passe oublié, débloque
// l'admin après trop d'essais ratés et ferme ses sessions ouvertes. Le serveur peut tourner pendant ce temps.
import readline from 'node:readline';
import { openDatabase } from '../src/db.js';
import { buildConfig, loadDotEnv } from '../src/config.js';
import { createClock } from '../src/lib/clock.js';
import { AccountService } from '../src/services/accounts.js';
import { AdminService, MIN_PASSWORD } from '../src/services/admin.js';
import { CouponService } from '../src/services/coupons.js';
import { GroupService } from '../src/services/groups.js';

loadDotEnv();
const config = buildConfig();
const db = openDatabase(config.dbPath);
const clock = createClock();
const accounts = new AccountService(db, clock, { pinParams: config.pinParams });
const admin = new AdminService(db, clock, { accounts, groups: new GroupService(db, clock, accounts), coupons: new CouponService(db, clock), pinParams: config.pinParams });

// Sans terminal (script, test) : les réponses arrivent ligne par ligne sur l'entrée standard.
let piped = null;
async function pipedLine() {
  if (!piped) {
    piped = [];
    for await (const line of readline.createInterface({ input: process.stdin })) piped.push(line);
  }
  return piped.shift() ?? '';
}

/** Lit une réponse sans l'afficher (ni étoiles : sa longueur ne se voit pas non plus). */
function askHidden(question) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) return pipedLine().then((v) => { process.stdout.write('\n'); return v; });
  return new Promise((resolve) => {
    const { stdin } = process;
    let value = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') { process.stdout.write('\nAnnulé.\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    };
    stdin.on('data', onData);
  });
}

console.log(`\n  🔐 Admin de Pari tenu ! (${config.dbPath})`);
console.log(admin.hasPassword()
  ? '  Un mot de passe existe : le nouveau le remplace, débloque l’admin et ferme ses sessions.\n'
  : '  Pas encore de mot de passe : choisis-le pour ouvrir /admin.\n');
const password = await askHidden(`  Nouveau mot de passe (${MIN_PASSWORD} caractères au moins) : `);
if (password.length < MIN_PASSWORD) {
  console.log(`  ✗ Trop court : ${MIN_PASSWORD} caractères au moins. Rien n’a changé.`);
  process.exit(1);
}
const again = await askHidden('  Encore une fois : ');
if (again !== password) {
  console.log('  ✗ Les deux ne sont pas identiques. Rien n’a changé.');
  process.exit(1);
}
await admin.setPassword(password);
db.close();
console.log('  ✓ Mot de passe enregistré. Ouvre /admin sur le site pour te connecter.\n');
