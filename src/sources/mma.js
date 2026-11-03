// 🥊 MMA : les combats des soirées UFC et PFL des 7 prochains jours (ESPN).
import { frDateTime } from '../lib/time.js';
import { HOUR, MINUTE } from '../lib/util.js';
import { athleteMedia, daysAround, duelLive, ESPN, ESPN_PROVIDER, liveFromBoards, scoreboards, seasonOf, voidNote, ymd } from './espn.js';
import { fightFinish } from './facts.js';
import { clip, httpsUrl, PENDING, sportTitle } from './http.js';

const COMPETITIONS = [
  { id: 'ufc', label: 'UFC', path: 'mma/ufc' },
  { id: 'pfl', label: 'PFL', path: 'mma/pfl' },
];
const FIGHT_LENGTH = 2 * HOUR;
const DETAILS = 'Résultat : vainqueur officiel (KO, soumission ou décision). Combat annulé, nul ou sans décision : pari annulé.';

const fighter = (c) => clip(c.athlete?.displayName || c.athlete?.shortName || '', 30);
// Bilan du combattant (victoires-défaites-nuls), affiché sur la fiche du combat.
const record = (c) => (/^\d+-\d+-\d+$/.test(c.records?.[0]?.summary ?? '') ? c.records[0].summary : null);
const duel = (fight) => ({ layout: 'versus', competitors: (fight.competitors ?? []).slice(0, 2).map((c) => ({ ...athleteMedia(c, 'mma', fighter(c)), record: record(c) })) });
/** Round en cours, vainqueur, et comment le combat s'est fini (KO, soumission, décision). */
const fightLive = (fight) => {
  const live = duelLive(fight, 'round');
  const finish = fightFinish(fight);
  return finish ? { ...live, finish } : live;
};

export default {
  id: 'mma',
  category: 'sport',
  emoji: '🥊',
  name: 'MMA',
  provider: ESPN_PROVIDER,
  about: 'Tous les combats des soirées des 7 prochains jours ; le vainqueur arrive tout seul après le combat.',
  competitions: COMPETITIONS.map(({ id, label }) => ({ id, label, fallbackMonth: 1 })),
  params: [],
  competitionOf: (ref) => (COMPETITIONS.some((c) => c.path === ref.path) ? ref.path.split('/')[1] : null),
  matchup: true, // deux combattants : un adversaire remplacé annule le pari (SourceService)
  facts: 'mma', // fin du combat dans le direct : un combat fini sans elle est relu une fois

  async events({ competitions: selected = [] }, io) {
    const comps = COMPETITIONS.filter((c) => selected.includes(c.id));
    if (!comps.length) return [];
    const seen = new Set();
    const events = [];
    for (const { comp, data } of await scoreboards(comps, 7, io)) {
      for (const card of data.events ?? []) {
        const name = clip(card.name, 50);
        const url = httpsUrl(card.links?.[0]?.href);
        for (const fight of card.competitions ?? []) {
          const startsAt = Date.parse(fight.date ?? card.date);
          const [a, b] = fight.competitors ?? [];
          if (seen.has(fight.id) || fight.status?.type?.state !== 'pre' || !(startsAt > io.now + 10 * MINUTE) || !a || !b || !fighter(a) || !fighter(b)) continue;
          seen.add(fight.id);
          const title = `${fighter(a)} – ${fighter(b)}`;
          events.push({
            id: String(fight.id),
            title,
            subtitle: `${name} · ${frDateTime(startsAt)}`,
            startsAt,
            url,
            markets: [{
              id: 'winner', kind: 'multi', question: sportTitle('MMA', name, title),
              options: [{ key: String(a.id), label: fighter(a) }, { key: String(b.id), label: fighter(b) }],
              closesAt: startsAt, expectedAt: startsAt + FIGHT_LENGTH, details: DETAILS, competition: comp.id, season: seasonOf(data, startsAt, comp),
              media: duel(fight),
              ref: {
                path: comp.path, cardId: String(card.id), fightId: String(fight.id), day: ymd(Date.parse(card.date)), market: 'winner',
                label: `${comp.label} · ${title}`, url, closesMax: startsAt, key: `mma:${fight.id}:winner`,
              },
            }],
          });
        }
      }
    }
    return events.sort((x, y) => x.startsAt - y.startsAt);
  },

  /** Combats commencés : round en cours, vainqueur, fin du combat ; drapeaux, photos et bilans des combattants. */
  live(refs, io) {
    const boards = new Map();
    for (const ref of refs) {
      for (const day of daysAround(ref.day)) {
        const url = `${ESPN}/${ref.path}/scoreboard?dates=${day}`;
        boards.set(url, [...(boards.get(url) ?? []), ref]);
      }
    }
    return liveFromBoards([...boards].map(([url, list]) => ({ url, refs: list })), (data, ref) => {
      const fight = (data.events ?? []).flatMap((card) => card.competitions ?? []).find((f) => String(f.id) === ref.fightId);
      return fight ? { media: duel(fight), live: fightLive(fight) } : null;
    }, io);
  },

  async result(ref, { fetchJson }) {
    let fight = null;
    for (const day of daysAround(ref.day)) {
      const data = await fetchJson(`${ESPN}/${ref.path}/scoreboard?dates=${day}`, { ttl: 5 * MINUTE });
      fight = (data.events ?? []).flatMap((card) => card.competitions ?? []).find((f) => String(f.id) === ref.fightId);
      if (fight) break;
    }
    if (!fight) return PENDING;
    const type = fight.status?.type ?? {};
    const winner = fight.competitors?.find((c) => c.winner);
    if (type.completed && winner) return { state: 'final', key: String(winner.id), note: `Vainqueur : ${fighter(winner)}`, live: fightLive(fight) };
    const voided = voidNote(type);
    if (voided || (type.state === 'post' && !winner)) return { state: 'void', note: voided ? 'Combat annulé' : 'Combat sans vainqueur (nul ou sans décision)' };
    return PENDING;
  },
};
