// Réglages des paris (types, catégories, compétitions), paris ouverts automatiquement et leurs résultats, par l'API.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays, dayKey } from '../src/lib/time.js';
import { betUrl, coupon, createBet, DAY, HOUR, MINUTE, setupGroup, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const settingsUrl = (g) => `/api/groups/${g.gid}/settings`;
const sourcesUrl = (g) => `/api/groups/${g.gid}/sources`;
const LIGUE_1 = { foot: { competitions: ['fra.1'] } };

/** Un admin active des compétitions, puis le serveur ouvre leurs paris (il le fait tout seul toutes les 30 minutes). */
async function enable(s, g, sources) {
  await g.c.lea.ok('PATCH', settingsUrl(g), { sources });
  return s.deps.sources.autoOpen(g.gid);
}

const listBets = async (g, who = 'lea') => (await g.c[who].ok('GET', `/api/groups/${g.gid}/bets`)).bets;

/** Le pari ouvert automatiquement pour cette question : { betId, bet, opt: { label: id } }. */
async function openBet(g, question, who = 'lea') {
  const found = (await listBets(g, who)).find((b) => (question instanceof RegExp ? question.test(b.question) : b.question === question));
  assert.ok(found, `pari « ${question} » ouvert`);
  const { bet } = await g.c[who].ok('GET', betUrl(g, found.id));
  return { betId: bet.id, bet, opt: Object.fromEntries(bet.options.map((o) => [o.label, o.id])) };
}

/** Avance l'horloge, applique les échéances puis demande les résultats aux sources (ce que fait le serveur toutes les 5 min). */
async function later(s, ms) {
  s.clock.advance(ms);
  s.deps.bets.sweepAll();
  await s.deps.sources.checkDue();
  s.deps.seasons.closeDue();
}

/** Les scénarios qui avancent l'horloge ont chacun leur serveur (et leurs matchs). */
async function fresh(fn) {
  const s = await startServer();
  try {
    await fn(s);
  } finally {
    await s.stop();
  }
}

const pickAll = async (g, betId, opt, picks) => {
  for (const [who, label] of Object.entries(picks)) await g.c[who].ok('POST', betUrl(g, betId, 'pick'), { optionId: opt[label] });
};
const untilAfter = (s, at, extra) => at - s.clock.now() + extra;
const plain = (text) => text.replace(/[  ]/g, ' '); // espaces insécables des montants en euros

describe('réglages des paris : types, catégories, compétitions', () => {
  it('désactiver un type de pari : refusé à la création, gardé sur les paris existants', async () => {
    const g = await setupGroup(srv, ['max']);
    const multi = await createBet(srv, g, { question: 'Qui gagne le tournoi ?', kind: 'multi', options: ['Léa', 'Max'] });
    const { settings } = await g.c.lea.ok('PATCH', settingsUrl(g), { kinds: { multi: false } });
    assert.deepEqual(settings.kinds, { yesno: true, multi: false });
    const refused = await g.c.lea.post(`/api/groups/${g.gid}/bets`, { question: 'Qui paie le resto ?', category: 'groupe', kind: 'multi', options: ['A', 'B'], closesAt: srv.clock.now() + HOUR });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Les paris à choix multiples sont désactivés dans ce groupe.');
    await createBet(srv, g, { question: 'Max arrive à l’heure ?' });
    const edit = await g.c.lea.patch(betUrl(g, multi.betId), { question: 'Qui gagne la finale ?', category: 'groupe', kind: 'multi', options: ['Léa', 'Max', 'Tom'], closesAt: srv.clock.now() + HOUR });
    assert.equal(edit.status, 200, 'un pari déjà lancé garde son type');
    // Plus aucun type : plus de paris maison.
    await g.c.lea.ok('PATCH', settingsUrl(g), { kinds: { yesno: false } });
    const none = await g.c.lea.post(`/api/groups/${g.gid}/bets`, { question: 'Max arrive en retard ?', category: 'groupe', kind: 'yesno', closesAt: srv.clock.now() + HOUR });
    assert.equal(none.body.error, 'Les paris maison sont désactivés dans ce groupe.');
  });

  it('un groupe neuf n’a rien d’activé : ni type, ni catégorie de paris maison, ni compétition', async () => {
    const g = await setupGroup(srv, ['max'], { house: false });
    const { settings } = await g.c.lea.ok('GET', `/api/groups/${g.gid}`);
    assert.deepEqual(settings.kinds, { yesno: false, multi: false });
    assert.ok(settings.categories.length === 12 && settings.categories.every((c) => c.hidden), 'catégories toutes coupées');
    assert.deepEqual(settings.sources, {});
    const refused = await g.c.lea.post(`/api/groups/${g.gid}/bets`, { question: 'Max arrive en retard ?', category: 'groupe', kind: 'yesno', closesAt: srv.clock.now() + HOUR });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Les paris maison sont désactivés dans ce groupe.');
  });

  it('rien n’est activé d’office ; compétitions vérifiées, gardées, réservées aux admins', async () => {
    const g = await setupGroup(srv, ['max']);
    let { sources } = await g.c.max.ok('GET', sourcesUrl(g));
    assert.deepEqual(sources.map((s) => s.id), ['foot', 'usfoot', 'rugby', 'basket', 'hockey', 'baseball', 'tennis', 'padel', 'mma', 'f1', 'moto', 'afl', 'crypto', 'meteo', 'manifold']);
    assert.ok(sources.every((s) => !s.active && !s.selected.length), 'rien d’activé');
    const foot = sources.find((s) => s.id === 'foot');
    assert.deepEqual(foot.competitions.slice(0, 2), [{ id: 'fra.1', label: 'Ligue 1' }, { id: 'fra.2', label: 'Ligue 2' }]);
    assert.equal(sources.find((s) => s.id === 'meteo').competitions, null, 'source hors sport : un interrupteur');

    assert.equal((await g.c.max.patch(settingsUrl(g), { sources: LIGUE_1 })).status, 403);
    const bad = await g.c.lea.patch(settingsUrl(g), { sources: { foot: { competitions: ['nope'] } } });
    assert.deepEqual([bad.status, bad.body.error], [400, 'Football : compétition inconnue.']);
    assert.equal((await g.c.lea.patch(settingsUrl(g), { sources: { inconnue: { competitions: [] } } })).status, 404);
    const lyon = { name: 'Lyon', lat: 45.7491, lon: 4.8479, country: 'France' };
    await g.c.lea.ok('PATCH', settingsUrl(g), { sources: { foot: { competitions: ['eng.1', 'fra.1', 'fra.1'] }, meteo: { competitions: ['meteo'], params: { place: lyon } } } });
    await g.c.lea.ok('PATCH', settingsUrl(g), { sources: { usfoot: { competitions: ['nfl'] } } });
    ({ sources } = await g.c.lea.ok('GET', sourcesUrl(g)));
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
    assert.deepEqual(byId.foot.selected, ['eng.1', 'fra.1'], 'gardé, sans doublon');
    assert.deepEqual([byId.usfoot.active, byId.meteo.active, byId.meteo.values.place.name, byId.crypto.active], [true, true, 'Lyon', false]);
  });

  it('paris maison et compétitions se règlent à part ; sans catégorie activée, pas de paris maison', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    const { settings } = await g.c.lea.ok('GET', `/api/groups/${g.gid}`);
    // Couper la catégorie Sport ne coupe que les paris maison de sport : la Ligue 1 s'ouvre quand même.
    await g.c.lea.ok('PATCH', settingsUrl(g), { categories: settings.categories.map((c) => ({ ...c, hidden: c.id === 'sport' })) });
    assert.equal(await enable(s, g, LIGUE_1), 2);
    const { sources } = await g.c.max.ok('GET', sourcesUrl(g));
    assert.deepEqual(sources.filter((v) => v.selected.length).map((v) => [v.id, v.active]), [['foot', true]]);
    const marathon = await g.c.max.post(`/api/groups/${g.gid}/bets`, { question: 'Julien finit le marathon ?', category: 'sport', kind: 'yesno', closesAt: s.clock.now() + HOUR });
    assert.deepEqual([marathon.status, marathon.body.error], [400, 'Choisis une catégorie de la liste.']);
    // Toutes coupées : le groupe ne vit que de ses compétitions.
    await g.c.lea.ok('PATCH', settingsUrl(g), { categories: settings.categories.map((c) => ({ ...c, hidden: true })) });
    const late = await g.c.max.post(`/api/groups/${g.gid}/bets`, { question: 'Julien arrive en retard ?', category: 'groupe', kind: 'yesno', closesAt: s.clock.now() + HOUR });
    assert.deepEqual([late.status, late.body.error], [400, 'Les paris maison sont désactivés dans ce groupe.']);
    assert.equal((await listBets(g)).length, 2, 'les paris de la Ligue 1 restent');
  }));

  it('recherche de ville pour la météo (admins seulement)', async () => {
    const g = await setupGroup(srv, ['max']);
    const { places } = await g.c.lea.ok('GET', `/api/groups/${g.gid}/places?q=Lyon`);
    assert.equal(places[0].name, 'Lyon');
    assert.equal((await g.c.max.get(`/api/groups/${g.gid}/places?q=Lyon`)).status, 403);
    assert.equal((await g.c.lea.get(`/api/groups/${g.gid}/places?q=L`)).body.error, 'Tape au moins 2 lettres.');
  });
});

describe('paris ouverts automatiquement', () => {
  it('Ligue 1 activée : tous ses paris disponibles s’ouvrent, sans créateur ni arbitre, une seule fois', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    assert.equal(await enable(s, g, LIGUE_1), 2, 'un pari par match : le résultat');
    assert.deepEqual((await listBets(g)).map((b) => b.question).sort(), ['Football · Ligue 1 · Lille – Lens', 'Football · Ligue 1 · PSG – Marseille']);
    const { betId, bet, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    assert.deepEqual(Object.keys(opt), ['Victoire Lille', 'Match nul', 'Victoire Lens']);
    assert.deepEqual([bet.kind, bet.categoryId, bet.creatorId, bet.arbiterId, bet.auto], ['multi', 'sport', null, null, true]);
    assert.deepEqual(bet.ranking, { key: 'foot:fra.1', emoji: '⚽', label: 'Ligue 1', type: 'competition', sport: 'Football' });
    assert.equal(bet.closesAt, s.upstream.match('9001').at);
    assert.deepEqual(bet.source, { id: 'foot', emoji: '⚽', name: 'ESPN', label: 'Ligue 1 · Lille – Lens', url: 'https://www.espn.com/soccer/match/_/gameId/9001', site: 'ESPN', checkedAt: null });
    assert.match(bet.details, /score final officiel/);
    assert.deepEqual([bet.can.pick, bet.can.edit, bet.can.delete, bet.can.postpone, bet.can.setArbiter, bet.can.cancel], [true, false, false, false, false, true]);
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt['Victoire Lille'] });
    assert.equal((await g.c.lea.patch(betUrl(g, betId), { question: 'Autre question ?', category: 'sport', kind: 'yesno', closesAt: s.clock.now() + HOUR })).status, 403);

    assert.equal(await s.deps.sources.autoOpen(g.gid), 0, 'pas de doublon');
    const { events } = await g.c.max.ok('GET', `/api/groups/${g.gid}/feed`);
    const opened = events.filter((e) => e.type === 'auto_opened');
    assert.deepEqual(opened.map((e) => [e.data.count, e.data.labels]), [[2, '⚽ Ligue 1 (2)']], 'un résumé dans le fil');
    assert.ok(!events.some((e) => e.type === 'created'), 'pas une ligne par pari');
  }));

  it('les types ne règlent que les paris maison ; compétition coupée : ses paris sans pronostic disparaissent', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max'], { house: false });
    assert.equal(await enable(s, g, LIGUE_1), 2, 'le pari de chaque match s’ouvre sans aucun type de pari maison');
    assert.equal(s.deps.sources.prune(g.gid), 0);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt['Match nul'] });
    const { removed } = await g.c.lea.ok('PATCH', settingsUrl(g), { sources: { foot: { competitions: [] } } });
    assert.equal(removed, 1);
    assert.deepEqual((await listBets(g)).map((b) => b.id), [betId], 'le pari joué va jusqu’au bout');
  }));

  it('un pari qu’une source ne propose plus (« au moins 3 buts »…) est retiré s’il n’a pas de pronostic', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    // Deux paris ouverts avant le 30 octobre 2026, quand le foot proposait aussi « au moins 3 buts ».
    const old = (eventId, at) => s.deps.bets.createAuto(g.gid, {
      question: `Au moins 3 buts (${eventId}) ?`, details: '', category: 'sport', kind: 'yesno', closesAt: at, expectedAt: at + 3 * HOUR,
    }, {
      source: 'foot', ranking: 'foot:fra.1', season: { label: '2026-27', startsAt: at - DAY, endsAt: at + 200 * DAY },
      ref: { path: 'soccer/fra.1', league: 'fra.1', eventId, home: 'Lille', away: 'Lens', market: 'goals', key: `foot:${eventId}:goals` },
      options: [{ label: 'Oui', key: 'yes' }, { label: 'Non', key: 'no' }],
    });
    const at = s.upstream.match('9001').at;
    old('9001', at);
    const played = old('9002', at);
    await g.c.max.ok('POST', betUrl(g, played, 'pick'), { optionId: (await g.c.max.ok('GET', betUrl(g, played))).bet.options[0].id });
    assert.equal(s.deps.sources.prune(g.gid), 1, 'celui que personne n’a joué');
    assert.deepEqual((await listBets(g)).map((b) => b.question).sort(), ['Au moins 3 buts (9002) ?', 'Football · Ligue 1 · Lille – Lens', 'Football · Ligue 1 · PSG – Marseille']);
  }));

  it('à la clôture : un pari que personne n’a joué disparaît ; joué par un seul, il continue (cote fixe)', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.max.ok('POST', betUrl(g, betId, 'pick'), { optionId: opt['Match nul'] });
    await later(s, untilAfter(s, s.upstream.match('9001').at, MINUTE));
    const bets = await listBets(g);
    assert.deepEqual(bets.filter((b) => b.question.includes('Lille')).map((b) => [b.question, b.status]), [['Football · Ligue 1 · Lille – Lens', 'closed']]);
    assert.equal(bets.filter((b) => b.question.includes('PSG')).length, 1, 'le match suivant n’est pas encore clos');
  }));

  it('source injoignable : rien n’est ouvert, la prochaine tentative rattrape', () => fresh(async (s) => {
    const g = await setupGroup(s, []);
    s.upstream.down = true;
    assert.equal(await enable(s, g, LIGUE_1), 0);
    s.upstream.down = false;
    assert.equal(await s.deps.sources.autoOpen(g.gid), 2);
  }));

  it('tennis : un joueur remplacé avant le match (forfait) annule le pari ; son visuel garde l’affiche d’origine', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, { tennis: { competitions: ['atp'] } });
    const t = await openBet(g, 'Tennis · Rolex Paris Masters, quart de finale · Jannik Sinner – Carlos Alcaraz');
    await g.c.max.ok('POST', betUrl(g, t.betId, 'pick'), { optionId: t.opt['Jannik Sinner'] });
    // Sinner déclare forfait : un repêché prend sa place, sous le même numéro de match (comme Tsitsipas le 3 novembre).
    s.upstream.tennis.players[0] = ['5003', 'Ugo Humbert', 'fra'];
    s.clock.advance(31 * MINUTE); // la prochaine ouverture automatique (toutes les 30 min, après le cache des tableaux)
    await s.deps.sources.autoOpen();
    const { bet } = await g.c.max.ok('GET', betUrl(g, t.betId));
    assert.deepEqual([bet.status, bet.cancelReason, bet.cancelNote], ['cancelled', 'source', 'Forfait avant le match : Jannik Sinner remplacé par Ugo Humbert']);
    assert.deepEqual(bet.event.competitors.map((c) => c.name), ['Jannik Sinner', 'Carlos Alcaraz'], 'pas le nouveau joueur sous le pari d’origine');
    await s.deps.sources.autoOpen();
    assert.equal((await g.c.max.ok('GET', betUrl(g, t.betId))).bet.event.competitors[0].name, 'Jannik Sinner', 'les ouvertures suivantes n’y touchent plus');
  }));

  it('tennis : remplacé trop tard pour l’ouverture automatique, le pari est annulé au résultat (pas réglé sur un joueur absent)', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, { tennis: { competitions: ['atp'] } });
    const t = await openBet(g, 'Tennis · Rolex Paris Masters, quart de finale · Jannik Sinner – Carlos Alcaraz');
    await pickAll(g, t.betId, t.opt, { lea: 'Jannik Sinner', max: 'Carlos Alcaraz' });
    s.upstream.tennis.players[0] = ['5003', 'Ugo Humbert', 'fra'];
    s.upstream.winners['7001'] = '5003';
    await later(s, untilAfter(s, s.upstream.tennis.at, 4 * HOUR));
    const { bet } = await g.c.max.ok('GET', betUrl(g, t.betId));
    assert.deepEqual([bet.status, bet.cancelReason, bet.cancelNote], ['cancelled', 'source', 'Forfait avant le match : le vainqueur n’était pas dans ce pari']);
    assert.equal(bet.awards.length, 0, 'aucun point');
  }));

  it('un pari déjà réglé dont le visuel montre un autre joueur (affiche changée) retrouve son affiche', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, { tennis: { competitions: ['atp'] } });
    const t = await openBet(g, 'Tennis · Rolex Paris Masters, quart de finale · Jannik Sinner – Carlos Alcaraz');
    await pickAll(g, t.betId, t.opt, { lea: 'Jannik Sinner', max: 'Carlos Alcaraz' });
    s.upstream.winners['7001'] = '5002';
    await later(s, untilAfter(s, s.upstream.tennis.at, 4 * HOUR));
    const key = JSON.parse(s.deps.db.prepare('SELECT source_ref FROM bets WHERE id = ?').get(t.betId).source_ref).key;
    const media = s.deps.live.get(key).media;
    s.deps.live.saveMedia(key, { ...media, competitors: [{ key: '5003', name: 'Ugo Humbert' }, media.competitors[1]] });
    assert.equal(s.deps.sources.repairMatchups(), 1);
    assert.deepEqual((await g.c.max.ok('GET', betUrl(g, t.betId))).bet.event.competitors.map((c) => c.name), ['Jannik Sinner', 'Carlos Alcaraz']);
    assert.equal(s.deps.sources.repairMatchups(), 0, 'une seule fois');
  }));

  it('NFL, Top 14, NBA, tennis, UFC : ouverts aux heures officielles et réglés tout seuls', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    const opened = await enable(s, g, {
      usfoot: { competitions: ['nfl'] }, rugby: { competitions: ['270559'] }, basket: { competitions: ['nba'] },
      tennis: { competitions: ['atp'] }, mma: { competitions: ['ufc'] },
    });
    assert.equal(opened, 5, 'un pari par match ou par combat');
    const nfl = await openBet(g, 'Football américain · NFL · Bills – Ravens');
    assert.deepEqual(Object.keys(nfl.opt), ['Victoire Bills', 'Victoire Ravens'], 'pas de match nul en NFL');
    const top14 = await openBet(g, 'Rugby · Top 14 · Toulouse – Toulon');
    assert.deepEqual(Object.keys(top14.opt), ['Victoire Toulouse', 'Match nul', 'Victoire Toulon']);
    assert.equal(top14.bet.ranking.label, 'Top 14');
    const nba = await openBet(g, 'Basket · NBA · Lakers – Celtics');
    const tennis = await openBet(g, 'Tennis · Rolex Paris Masters, quart de finale · Jannik Sinner – Carlos Alcaraz');
    assert.equal(tennis.bet.ranking.label, 'ATP (simple messieurs)');
    const fight = await openBet(g, 'MMA · UFC Fight Night: Moicano vs. Nolan · Renato Moicano – Tom Nolan');
    assert.equal(fight.bet.closesAt, s.upstream.fight.at);

    await pickAll(g, nfl.betId, nfl.opt, { lea: 'Victoire Bills', max: 'Victoire Ravens' });
    await pickAll(g, top14.betId, top14.opt, { lea: 'Match nul', max: 'Victoire Toulouse' });
    await pickAll(g, nba.betId, nba.opt, { lea: 'Victoire Celtics', max: 'Victoire Lakers' });
    await pickAll(g, tennis.betId, tennis.opt, { lea: 'Jannik Sinner', max: 'Carlos Alcaraz' });
    await pickAll(g, fight.betId, fight.opt, { lea: 'Renato Moicano', max: 'Tom Nolan' });
    s.upstream.finish('9101', 27, 24);
    s.upstream.finish('9201', 21, 21);
    s.upstream.finish('9301', 110, 108);
    s.upstream.winners['7001'] = '5002';
    s.upstream.winners['8001'] = 'CANCELLED';
    await later(s, 3 * DAY);
    const result = async ({ betId }) => {
      const { bet } = await g.c.lea.ok('GET', betUrl(g, betId));
      return [bet.status, bet.options.find((o) => o.id === bet.winningOptionId)?.label ?? bet.cancelNote, plain(bet.resolutionNote)];
    };
    assert.deepEqual(await result(nfl), ['settled', 'Victoire Bills', 'Score final : Bills 27 – 24 Ravens']);
    assert.deepEqual(await result(top14), ['settled', 'Match nul', 'Score final : Toulouse 21 – 21 Toulon']);
    assert.deepEqual(await result(nba), ['settled', 'Victoire Lakers', 'Score final : Lakers 110 – 108 Celtics']);
    assert.deepEqual(await result(tennis), ['settled', 'Carlos Alcaraz', 'Vainqueur : Carlos Alcaraz']);
    assert.deepEqual(await result(fight), ['cancelled', 'Combat annulé', '']);
  }));
});

describe('barème des paris sportifs (cote fixe)', () => {
  it('cote des bookmakers affichée avant de parier, sinon barème fixe ; jamais de ×1, même seul ou tous d’accord', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const lille = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    assert.equal(lille.bet.scoring, 'bookmaker');
    assert.deepEqual(lille.bet.options.map((o) => [o.label, o.odds, o.points]), [['Victoire Lille', 2.5, 250], ['Match nul', 3.3, 330], ['Victoire Lens', 2.8, 280]]);
    const psg = await openBet(g, 'Football · Ligue 1 · PSG – Marseille');
    assert.equal(psg.bet.scoring, 'fixed', 'pas de cote chez la source : barème fixe');
    assert.deepEqual(psg.bet.options.map((o) => o.points), [200, 200, 200]);
    // Tout le monde d'accord : un pari entre amis serait annulé ; un pari sportif rapporte sa cote.
    await pickAll(g, lille.betId, lille.opt, { lea: 'Victoire Lens', max: 'Victoire Lens' });
    await pickAll(g, psg.betId, psg.opt, { max: 'Victoire PSG' });
    s.upstream.finish('9001', 0, 2);
    s.upstream.finish('9002', 3, 0);
    await later(s, 3 * DAY);
    await later(s, 25 * HOUR); // 24 h de validation
    const awards = async ({ betId }) => (await g.c.lea.ok('GET', betUrl(g, betId))).bet.awards.map((a) => [a.memberId, a.amount]);
    assert.deepEqual(await awards(lille), [[g.id.lea, 280], [g.id.max, 280]]);
    assert.deepEqual(await awards(psg), [[g.id.max, 200]], 'seul à parier : il marque quand même');
  }));

  it('une cote qui arrive plus tard remplace le barème fixe, tant que personne n’a parié', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const lille = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.max.ok('POST', betUrl(g, lille.betId, 'pick'), { optionId: lille.opt['Match nul'] });
    s.upstream.match('9001').ml = { home: '+400', draw: '+300', away: '-150' };
    s.upstream.match('9002').ml = { home: '-250', draw: '+350', away: '+600' };
    s.clock.advance(31 * MINUTE); // le cache des tableaux ESPN (30 min)
    assert.equal(await s.deps.sources.autoOpen(g.gid), 0);
    assert.deepEqual((await openBet(g, 'Football · Ligue 1 · PSG – Marseille')).bet.options.map((o) => o.points), [140, 450, 700]);
    assert.deepEqual((await openBet(g, 'Football · Ligue 1 · Lille – Lens')).bet.options.map((o) => o.points), [250, 330, 280], 'Max a parié : sa cote ne bouge plus');
  }));
});

describe('un joueur, plusieurs groupes', () => {
  it('un pronostic vaut dans tous mes groupes où le même pari est ouvert (et dont je suis la compétition)', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    // Léa crée un deuxième groupe depuis le même téléphone : c'est son compte, rien à retaper.
    const { groupId: g2 } = await g.c.lea.ok('POST', '/api/groups', { name: 'Le Foot du jeudi', emoji: '⚽', coupon: coupon(s) });
    const second = { gid: g2, c: { lea: g.c.lea } };
    await enable(s, g, LIGUE_1);
    await enable(s, second, LIGUE_1);
    const here = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await g.c.lea.ok('POST', betUrl(g, here.betId, 'pick'), { optionId: here.opt['Victoire Lille'] });
    const there = await openBet(second, 'Football · Ligue 1 · Lille – Lens');
    assert.equal(there.bet.options.find((o) => o.id === there.bet.myPick)?.label, 'Victoire Lille', 'repris dans l’autre groupe');
    assert.deepEqual(there.bet.events.filter((e) => e.type === 'picked').map((e) => e.data.shared), ['Les Potes']);
    // Elle change d'avis dans l'autre groupe : son pronostic change partout (un seul par match).
    await g.c.lea.ok('POST', betUrl(second, there.betId, 'pick'), { optionId: there.opt['Match nul'] });
    assert.equal((await openBet(g, 'Football · Ligue 1 · Lille – Lens')).bet.myPick, here.opt['Match nul']);
    assert.deepEqual((await openBet(g, 'Football · Ligue 1 · Lille – Lens')).bet.events.filter((e) => e.type === 'pick_changed').map((e) => [e.data.from, e.data.label, e.data.shared]),
      [['Victoire Lille', 'Match nul', 'Le Foot du jeudi']]);
    await g.c.lea.ok('POST', betUrl(g, here.betId, 'pick'), { optionId: here.opt['Victoire Lille'] });
    await g.c.max.ok('POST', betUrl(g, here.betId, 'pick'), { optionId: here.opt['Match nul'] });
    assert.equal((await openBet(second, 'Football · Ligue 1 · Lille – Lens')).bet.participants, 1, 'Max n’est pas dans ce groupe');

    // Un troisième groupe ouvre la Ligue 1 plus tard : Léa y retrouve son pronostic.
    const { groupId: g3 } = await g.c.lea.ok('POST', '/api/groups', { name: 'Bureau', emoji: '💼', coupon: coupon(s) });
    await enable(s, { gid: g3, c: { lea: g.c.lea } }, LIGUE_1);
    assert.equal((await openBet({ gid: g3, c: { lea: g.c.lea } }, 'Football · Ligue 1 · Lille – Lens')).bet.myPick != null, true);

    // Dans un groupe où elle ne suit pas la Ligue 1, rien n'est repris.
    await g.c.lea.ok('POST', `/api/groups/${g2}/feeds`, { key: 'foot:fra.1', choice: 'out' });
    const psg = await openBet(g, 'Football · Ligue 1 · PSG – Marseille');
    await g.c.lea.ok('POST', betUrl(g, psg.betId, 'pick'), { optionId: psg.opt['Victoire PSG'] });
    const { bet } = await g.c.lea.ok('GET', betUrl(second, (await s.deps.db.prepare("SELECT id FROM bets WHERE group_id = ? AND question = 'Football · Ligue 1 · PSG – Marseille'").get(g2)).id));
    assert.equal(bet.myPick, null);
  }));
});

describe('compétitions suivies', () => {
  it('le groupe propose, chacun choisit : sans réponse les paris restent cachés', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max', 'tom']);
    await enable(s, g, { ...LIGUE_1, usfoot: { competitions: ['nfl'] } });
    assert.equal((await listBets(g, 'lea')).length, 3, 'Léa a activé la Ligue 1 et la NFL : elle y participe');
    const { feeds } = await g.c.max.ok('GET', `/api/groups/${g.gid}/feeds`);
    assert.deepEqual(feeds.map((f) => [f.key, `${f.emoji} ${f.label}`, f.choice, f.open]), [['foot:fra.1', '⚽ Ligue 1', null, 2], ['usfoot:nfl', '🏈 NFL', null, 1]]);
    assert.equal((await listBets(g, 'max')).length, 0, 'Max n’a pas encore répondu : rien ne l’envahit');
    await g.c.max.ok('POST', `/api/groups/${g.gid}/feeds`, { key: 'foot:fra.1', choice: 'in' });
    await g.c.tom.ok('POST', `/api/groups/${g.gid}/feeds`, { key: 'foot:fra.1', choice: 'out' });
    assert.deepEqual((await listBets(g, 'max')).map((b) => b.ranking.label), ['Ligue 1', 'Ligue 1']);
    assert.equal((await listBets(g, 'tom')).length, 0);
    assert.equal((await g.c.tom.post(`/api/groups/${g.gid}/feeds`, { key: 'basket:nba', choice: 'in' })).status, 404, 'pas proposée par le groupe');
    // Un pari joué reste visible, même après « non merci ».
    const nfl = await openBet(g, 'Football américain · NFL · Bills – Ravens');
    await g.c.tom.ok('POST', betUrl(g, nfl.betId, 'pick'), { optionId: nfl.opt['Victoire Bills'] });
    await g.c.tom.ok('POST', `/api/groups/${g.gid}/feeds`, { key: 'usfoot:nfl', choice: 'out' });
    assert.deepEqual((await listBets(g, 'tom')).map((b) => b.question), ['Football américain · NFL · Bills – Ravens']);
  }));
});

describe('résultats automatiques', () => {
  it('match fini : résultat officiel, points aussitôt (sans validation), dans le classement de la Ligue 1', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max', 'tom']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { lea: 'Victoire Lille', max: 'Match nul', tom: 'Victoire Lens' });

    await later(s, untilAfter(s, s.upstream.match('9001').at, 3 * HOUR));
    let { bet } = await g.c.max.ok('GET', betUrl(g, betId));
    assert.equal(bet.status, 'closed', 'match pas encore fini chez la source');
    assert.equal(bet.can.check, true);
    assert.ok(bet.source.checkedAt, 'la source a été interrogée');
    assert.equal(bet.can.resolve, false);

    s.upstream.finish('9001', 2, 1);
    await later(s, 15 * MINUTE);
    ({ bet } = await g.c.max.ok('GET', betUrl(g, betId)));
    assert.equal(bet.status, 'settled', 'pas de 24 h d’attente : c’est le score officiel');
    assert.equal(bet.winningOptionId, opt['Victoire Lille']);
    assert.equal(bet.resolvedBy, null);
    assert.equal(bet.resolutionNote, 'Score final : Lille 2 – 1 Lens');
    assert.equal(bet.can.contest, false);
    const resolved = bet.events.find((e) => e.type === 'resolved');
    assert.deepEqual([resolved.memberId, resolved.data.auto, resolved.data.source], [null, true, 'ESPN']);
    assert.deepEqual(bet.awards, [{ memberId: g.id.lea, kind: 'gain', amount: 250 }], 'cote des bookmakers ×2,5 (+150), pas de prime');
    const ranking = await g.c.max.ok('GET', `/api/groups/${g.gid}/rankings/${encodeURIComponent('foot:fra.1')}`);
    assert.deepEqual(ranking.season.standings.map((r) => [r.member.pseudo, r.score, r.rank, r.played, r.correct]),
      [['Léa', 250, 1, 1, 1], ['Max', 0, 2, 1, 0], ['Tom', 0, 2, 1, 0]]);
  }));

  it('match reporté : pari annulé, aucun point', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · PSG – Marseille');
    await pickAll(g, betId, opt, { lea: 'Victoire PSG', max: 'Match nul' });
    s.upstream.postpone('9002');
    await later(s, untilAfter(s, s.upstream.match('9002').at, 3 * HOUR));
    const { bet } = await g.c.lea.ok('GET', betUrl(g, betId));
    assert.deepEqual([bet.status, bet.cancelReason, bet.cancelNote], ['cancelled', 'source', 'Match reporté']);
    assert.deepEqual(bet.awards, []);
  }));

  it('résultat officiel : pas de contestation ni de vote ; une erreur de la source, un admin la corrige', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max', 'tom', 'ines']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { lea: 'Victoire Lens', max: 'Victoire Lille', tom: 'Victoire Lille' });
    s.upstream.finish('9001', 1, 0);
    await later(s, untilAfter(s, s.upstream.match('9001').at, 3 * HOUR));
    // Les perdants ne peuvent pas renverser le score officiel à la majorité.
    const r = await g.c.lea.post(betUrl(g, betId, 'contest'), { reason: 'Le but de Lens a été refusé à tort, il y avait 2-1 !' });
    assert.deepEqual([r.status, r.body.code], [409, 'conflict']);
    assert.match(r.body.error, /résultat officiel/);
    let { bet } = await g.c.ines.ok('GET', betUrl(g, betId));
    assert.deepEqual([bet.status, bet.winningOptionId, bet.can.contest], ['settled', opt['Victoire Lille'], false]);
    // La source s'est trompée : un admin du groupe corrige, avec un motif visible ; les points suivent.
    assert.equal((await g.c.max.post(betUrl(g, betId, 'correct'), { optionId: opt['Victoire Lens'], reason: 'Erreur' })).status, 403, 'pas admin');
    await g.c.lea.ok('POST', betUrl(g, betId, 'correct'), { optionId: opt['Victoire Lens'], reason: 'ESPN a corrigé : 1-2 sur tapis vert' });
    ({ bet } = await g.c.ines.ok('GET', betUrl(g, betId)));
    assert.deepEqual([bet.status, bet.winningOptionId], ['settled', opt['Victoire Lens']]);
    assert.ok(bet.events.some((e) => e.type === 'corrected' && /tapis vert/.test(e.data.reason)));
  }));

  it('le direct annonce la fin du match : résultat et points tout de suite, sans attendre l’heure prévue', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { lea: 'Victoire Lille', max: 'Victoire Lens' });
    s.clock.advance(s.upstream.match('9001').at + 100 * MINUTE - s.clock.now());
    s.deps.bets.sweepAll();
    s.upstream.finish('9001', 2, 0);
    await s.deps.sources.refreshLive();
    const { bet } = await g.c.max.ok('GET', betUrl(g, betId));
    assert.ok(s.clock.now() < bet.expectedAt, 'bien avant l’heure prévue du résultat');
    assert.deepEqual([bet.status, bet.winningOptionId], ['settled', opt['Victoire Lille']]);
  }));

  it('source muette : un admin sans pronostic peut trancher 24 h après l’heure prévue', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max', 'tom']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { max: 'Victoire Lille', tom: 'Match nul' });
    await later(s, untilAfter(s, s.upstream.match('9001').at, 3 * HOUR));
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.can.resolve, false);
    assert.equal((await g.c.lea.post(betUrl(g, betId, 'resolve'), { optionId: opt['Match nul'] })).status, 403);
    await later(s, 24 * HOUR);
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.can.resolve, true, 'admin sans pronostic');
    assert.equal((await g.c.max.ok('GET', betUrl(g, betId))).bet.can.resolve, false, 'il a parié');
    await g.c.lea.ok('POST', betUrl(g, betId, 'resolve'), { optionId: opt['Match nul'], note: 'Vu à la télé : 1-1' });
    const { bet } = await g.c.tom.ok('GET', betUrl(g, betId));
    assert.deepEqual([bet.status, bet.resolvedBy], ['validating', g.id.lea], 'tranché à la main : 24 h pour contester, comme un arbitre');
    s.upstream.finish('9001', 1, 1);
    await later(s, HOUR);
    assert.equal((await g.c.tom.ok('GET', betUrl(g, betId))).bet.resolvedBy, g.id.lea, 'la source ne repasse pas derrière');
  }));

  it('bouton « Vérifier le résultat » : pas plus d’un appel à la source par minute', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { lea: 'Victoire Lille', max: 'Victoire Lens' });
    assert.deepEqual(await g.c.max.ok('POST', betUrl(g, betId, 'check')), { state: 'open' });
    s.clock.advance(untilAfter(s, s.upstream.match('9001').at, 30 * MINUTE));
    const summaries = () => s.upstream.calls.filter((u) => u.includes('/summary')).length;
    assert.deepEqual(await g.c.max.ok('POST', betUrl(g, betId, 'check')), { state: 'pending' });
    assert.equal(summaries(), 1);
    s.upstream.finish('9001', 0, 3);
    assert.deepEqual(await g.c.max.ok('POST', betUrl(g, betId, 'check')), { state: 'pending' }, 'trop tôt pour redemander');
    assert.equal(summaries(), 1);
    s.clock.advance(MINUTE);
    assert.deepEqual(await g.c.max.ok('POST', betUrl(g, betId, 'check')), { state: 'final', note: 'Score final : Lille 0 – 3 Lens' });
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.winningOptionId, opt['Victoire Lens']);
    const free = await createBet(s, g, { question: 'Max arrive à l’heure ?' });
    assert.equal((await g.c.max.post(betUrl(g, free.betId, 'check'))).status, 403);
  }));

  it('source injoignable au moment du résultat : on réessaie plus tard', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, LIGUE_1);
    const { betId, opt } = await openBet(g, 'Football · Ligue 1 · Lille – Lens');
    await pickAll(g, betId, opt, { lea: 'Victoire Lille', max: 'Victoire Lens' });
    s.upstream.finish('9001', 3, 0);
    s.upstream.down = true;
    await later(s, untilAfter(s, s.upstream.match('9001').at, 3 * HOUR));
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.status, 'closed');
    s.upstream.down = false;
    await later(s, 5 * MINUTE);
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.status, 'closed', 'pas avant 10 minutes');
    await later(s, 5 * MINUTE);
    assert.equal((await g.c.lea.ok('GET', betUrl(g, betId))).bet.status, 'settled');
  }));

  it('F1, moto, météo, crypto, actu : chaque source rapporte son résultat', () => fresh(async (s) => {
    const g = await setupGroup(s, ['max']);
    await enable(s, g, {
      f1: { competitions: ['f1'] }, moto: { competitions: ['motogp'] }, meteo: { competitions: ['meteo'] },
      crypto: { competitions: ['crypto'] }, manifold: { competitions: ['manifold'] },
    });
    const f1 = await openBet(g, 'Formule 1 · Mexico City · Autódromo Hermanos Rodríguez');
    assert.equal(f1.bet.ranking.label, 'Formule 1');
    assert.deepEqual([f1.bet.source.name, f1.bet.source.site, f1.bet.source.url], ['Jolpica F1', 'ESPN', 'https://www.espn.com/f1/race/_/id/600057447'], 'le lien : la page du Grand Prix chez ESPN');
    // Un pari ouvert avant (lien vers Wikipédia) : son lien est corrigé avec l'ouverture automatique, une seule fois.
    const old = { ...JSON.parse(s.deps.db.prepare('SELECT source_ref FROM bets WHERE id = ?').get(f1.betId).source_ref), url: 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix' };
    delete old.page;
    s.deps.db.prepare('UPDATE bets SET source_ref = ? WHERE id = ?').run(JSON.stringify(old), f1.betId);
    assert.equal(await s.deps.sources.relink(), 1);
    assert.equal((await openBet(g, 'Formule 1 · Mexico City · Autódromo Hermanos Rodríguez')).bet.source.url, 'https://www.espn.com/f1/race/_/id/600057447');
    assert.equal(await s.deps.sources.relink(), 0);
    await pickAll(g, f1.betId, f1.opt, { lea: 'Andrea Kimi Antonelli', max: 'Un autre pilote' });
    s.upstream.f1Winner = 'gasly';

    const motoRace = await openBet(g, 'Moto · MotoGP · Grand Prix de Malaisie');
    assert.equal(motoRace.bet.closesAt, s.upstream.gp.race);
    assert.equal(motoRace.bet.ranking.label, 'MotoGP');
    await pickAll(g, motoRace.betId, motoRace.opt, { lea: 'Marco Bezzecchi', max: 'Marc Marquez' });
    const sprint = await openBet(g, 'Moto · MotoGP · Grand Prix de Malaisie, sprint');
    assert.equal(sprint.bet.closesAt, s.upstream.gp.sprint);
    await pickAll(g, sprint.betId, sprint.opt, { lea: 'Marc Marquez', max: 'Jorge Martin' });
    s.upstream.motoResults.RAC = ['Marco Bezzecchi', 'Marc Marquez', 'Fabio Quartararo'].map(s.upstream.rider);
    s.upstream.motoResults.SPR = 'CANCELLED';

    // Météo, cryptos et actu comptent dans le classement de leur catégorie, sur la saison de l'année.
    const rains = (await listBets(g)).filter((b) => b.source?.id === 'meteo' && b.question.startsWith('Il pleut')).sort((a, b) => a.closesAt - b.closesAt);
    const rain = await openBet(g, rains[0].question);
    assert.deepEqual([rain.bet.ranking.key, rain.bet.ranking.label], ['cat:meteo', 'Météo']);
    await pickAll(g, rain.betId, rain.opt, { lea: 'Oui', max: 'Non' });
    for (let i = 0; i < 9; i++) s.upstream.weather[addDays(dayKey(s.clock.now()), i)] = { tmax: 12.1, rain: 3.4 };

    const btc = (await listBets(g)).filter((b) => b.source?.id === 'crypto' && b.question.startsWith('Le Bitcoin')).sort((a, b) => a.closesAt - b.closesAt);
    const coin = await openBet(g, btc[0].question);
    assert.match(plain(coin.bet.question), /^Le Bitcoin vaut plus de 69 000 € .* à 20 h \?$/);
    await pickAll(g, coin.betId, coin.opt, { lea: 'Non', max: 'Oui' });
    s.upstream.candles[coin.bet.closesAt + DAY] = 70250;

    const actu = await openBet(g, 'Will it snow in Paris before Christmas?');
    await pickAll(g, actu.betId, actu.opt, { lea: 'Oui', max: 'Non' });
    s.upstream.resolution = 'YES';

    await later(s, 11 * DAY);
    const result = async ({ betId }) => {
      const { bet } = await g.c.lea.ok('GET', betUrl(g, betId));
      return [bet.status, bet.options.find((o) => o.id === bet.winningOptionId)?.label, plain(bet.resolutionNote)];
    };
    assert.deepEqual(await result(f1), ['settled', 'Un autre pilote', 'Vainqueur : Pierre Gasly'], 'Gasly n’est pas dans les 7 favoris');
    assert.deepEqual(await result(motoRace), ['settled', 'Marco Bezzecchi', 'Vainqueur : Marco Bezzecchi']);
    const { bet: cancelled } = await g.c.lea.ok('GET', betUrl(g, sprint.betId));
    assert.deepEqual([cancelled.status, cancelled.cancelReason, cancelled.cancelNote], ['cancelled', 'source', 'Sprint annulé']);
    assert.deepEqual(await result(rain), ['settled', 'Oui', 'Open-Meteo : 3,4 mm de pluie à Paris']);
    assert.deepEqual(await result(coin), ['settled', 'Oui', 'Cours Coinbase à 20 h : 70 250 €']);
    assert.deepEqual(await result(actu), ['settled', 'Oui', 'Résolu « oui » sur Manifold']);
  }));
});
