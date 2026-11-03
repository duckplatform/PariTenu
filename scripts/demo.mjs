// Démo : un groupe « Les Potes » rempli de paris dans tous les états, puis le serveur.
//   npm run demo            (re)crée data/demo.db et lance l'app sur http://localhost:5190
//   npm run demo -- --keep  relance sans recréer la base
// Tous les membres de la démo ont le PIN DEMO_PIN ci-dessous.
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { buildConfig, loadDotEnv } from '../src/config.js';
import { createClock } from '../src/lib/clock.js';

export const DEMO_PIN = '1234';
const DB = 'data/demo.db';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

loadDotEnv();
const config = buildConfig({ ...process.env, PT_DB_PATH: DB });
const keep = process.argv.includes('--keep') && fs.existsSync(DB);
if (!keep) for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });

const clock = createClock();
const { app, deps, close } = createApp(config, { clock });

async function seed() {
  const { groups, bets } = deps;
  const start = Date.now() - 40 * DAY;
  clock.set(start);
  const at = (ts) => clock.set(ts);
  const me = (id) => groups.member(id);

  const { groupId, memberId: lea } = await groups.createGroup({ name: 'Les Potes', emoji: '🏆', pseudo: 'Léa', avatar: 'j:3:1:10', pin: DEMO_PIN });
  // Un groupe neuf n'a rien d'activé : Léa ouvre les paris maison (les deux types, toutes les catégories).
  groups.updateSettings(groups.member(lea), { kinds: { yesno: true, multi: true }, categories: groups.settings(groupId).categories.map((c) => ({ ...c, hidden: false })) });
  const token = groups.find(groupId).invite_token;
  const join = async (pseudo, avatar) => (await groups.join(token, { pseudo, avatar, pin: DEMO_PIN })).memberId;
  const max = await join('Max', 'f:fr');
  const tom = await join('Tom', '⚽');
  const ines = await join('Inès', 'j:2:1:7');
  const sam = await join('Sam', '🏉');
  const julien = await join('Julien', 'f:br');
  const P = { lea, max, tom, ines, sam, julien };

  const create = (creator, input) => bets.create(me(creator), { details: '', ...input });
  const opt = (betId, label) => bets.options(betId).find((o) => o.label === label).id;
  const picks = (betId, map) => { for (const [who, label] of Object.entries(map)) bets.pick(me(P[who]), betId, opt(betId, label)); };
  const sweep = () => bets.sweep(groupId);

  // 1. Mario Kart (il y a 39 jours) : réglé, prime d'arbitre pour Julien
  at(start + HOUR);
  const mk = create(julien, { question: 'Qui gagne le tournoi de Mario Kart ?', category: 'jeux', kind: 'multi', options: ['Max', 'Tom', 'Inès', 'Sam'], closesAt: start + DAY });
  picks(mk, { lea: 'Tom', max: 'Max', tom: 'Tom', ines: 'Inès', sam: 'Tom' });
  at(start + DAY + HOUR); sweep();
  bets.resolve(me(julien), mk, { optionId: opt(mk, 'Tom'), note: 'Tom a gagné les 4 coupes, rageant.' });
  at(start + 2 * DAY + 2 * HOUR); sweep();

  // 2. Barbecue : contesté puis confirmé par le vote
  at(start + 3 * DAY);
  const bbq = create(lea, { question: 'Il pleut samedi pour le barbecue ?', category: 'meteo', kind: 'yesno', closesAt: start + 5 * DAY });
  picks(bbq, { max: 'Oui', tom: 'Non', ines: 'Oui', sam: 'Non', julien: 'Non' });
  at(start + 6 * DAY); sweep();
  bets.resolve(me(lea), bbq, { optionId: opt(bbq, 'Oui'), note: 'Averse à 15 h, tout le monde sous le parasol.' });
  at(start + 6 * DAY + 2 * HOUR);
  bets.contest(me(tom), bbq, 'Il a plu deux minutes, ça ne compte pas !');
  for (const [who, choice] of [[max, 'Oui'], [ines, 'Oui'], [sam, 'Non'], [julien, 'Oui'], [tom, 'Non']]) {
    bets.vote(me(who), bbq, opt(bbq, choice));
  }
  bets.comment(me(tom), bbq, 'Scandale 😤');

  // 3. Semi-marathon d'Inès : réglé, prime pour Sam
  at(start + 8 * DAY);
  const semi = create(sam, { question: 'Inès court le semi-marathon en moins de 2 h ?', category: 'defis', kind: 'yesno', closesAt: start + 10 * DAY, expectedAt: start + 11 * DAY });
  picks(semi, { lea: 'Oui', max: 'Non', tom: 'Non', ines: 'Oui', julien: 'Oui' });
  at(start + 11 * DAY + 3 * HOUR); sweep();
  bets.resolve(me(sam), semi, { optionId: opt(semi, 'Oui'), note: '1 h 56 min 12 s, chrono officiel.' });
  at(start + 12 * DAY + 4 * HOUR); sweep();
  bets.comment(me(ines), semi, '👏');

  // 4. Pari unanime : annulé d'office
  at(start + 20 * DAY);
  const sun = create(max, { question: 'Le soleil se lève demain ?', category: 'insolite', kind: 'yesno', closesAt: start + 21 * DAY });
  picks(sun, { lea: 'Oui', tom: 'Oui', ines: 'Oui', sam: 'Oui' });
  at(start + 21 * DAY + HOUR); sweep();

  // 5. Resto : clos, Sam doit trancher
  const now = Date.now();
  at(now - 4 * DAY);
  const resto = create(tom, { question: 'Qui paie l’addition au resto vendredi ?', category: 'groupe', kind: 'multi', options: ['Léa', 'Max', 'Tom', 'Julien'], closesAt: now - 2 * DAY, arbiterId: sam });
  picks(resto, { lea: 'Max', max: 'Tom', tom: 'Max', ines: 'Julien', julien: 'Max' });

  // 6. Sans sucre : clos, Léa doit trancher (avec du retard)
  at(now - 6 * DAY);
  const sugar = create(lea, { question: 'Max tient 30 jours sans sucre ?', category: 'defis', kind: 'yesno', closesAt: now - 3 * DAY, expectedAt: now - 2 * DAY,
    details: 'Le dessert du resto compte. Le sucre dans le café aussi.' });
  picks(sugar, { max: 'Oui', tom: 'Non', ines: 'Non', sam: 'Non', julien: 'Oui' });

  // 7. Match : résultat en validation, Léa peut contester
  at(now - 3 * DAY);
  const match = create(julien, { question: 'Plus de 2,5 buts pendant PSG - OM ?', category: 'sport', kind: 'yesno', closesAt: now - DAY });
  picks(match, { lea: 'Oui', max: 'Non', tom: 'Oui', ines: 'Non', sam: 'Oui' });
  at(now - 5 * HOUR); sweep();
  bets.resolve(me(julien), match, { optionId: opt(match, 'Oui'), note: '3 - 1, score final.' });

  // 8. Koh-Lanta : ouvert
  at(now - 2 * DAY);
  const kl = create(max, { question: 'Qui gagne Koh-Lanta ?', category: 'tele', kind: 'multi', options: ['Clémence', 'Bastien', 'Teddy', 'Laura'], closesAt: now + 3 * DAY });
  picks(kl, { lea: 'Laura', tom: 'Bastien', ines: 'Laura', julien: 'Teddy' });

  // 9. Julien en retard : ouvert, arbitre Inès, commentaires
  at(now - 20 * HOUR);
  const late = create(lea, { question: 'Julien arrive après 20 h 15 samedi ?', category: 'groupe', kind: 'yesno', closesAt: now + 2 * DAY, expectedAt: now + 2 * DAY + 3 * HOUR,
    arbiterId: ines, details: 'Heure d’arrivée au bar, celle du téléphone d’Inès fait foi.' });
  picks(late, { max: 'Oui', tom: 'Non', sam: 'Oui' });
  bets.comment(me(julien), late, 'Vous allez voir, je serai en avance 😤');
  bets.comment(me(max), late, '😂');
  bets.comment(me(sam), late, 'Il n’a jamais été à l’heure de sa vie.');

  // 10. Bitcoin : ouvert longtemps
  at(now - 3 * HOUR);
  const btc = create(tom, { question: 'Le Bitcoin vaut plus de 100 000 € au 1er janvier ?', category: 'eco', kind: 'yesno', closesAt: now + 30 * DAY });
  picks(btc, { max: 'Oui', julien: 'Non' });

  clock.reset();
  sweep();
  return token;
}

const token = keep ? deps.db.prepare('SELECT invite_token FROM groups LIMIT 1').get().invite_token : await seed();
const server = app.listen(config.port, config.host, () => {
  console.log('\n  🎲 Démo de Pari tenu ! prête');
  console.log(`     http://localhost:${config.port}/invite/${token}`);
  console.log('     Membres : Léa (admin), Max, Tom, Inès, Sam, Julien — PIN : voir DEMO_PIN dans scripts/demo.mjs\n');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
