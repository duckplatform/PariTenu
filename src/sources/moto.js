// 🏍️ Grands Prix moto : MotoGP, Moto2 et Moto3 (course et sprint), par les API du site officiel (non documentées).
// Les horaires viennent du calendrier (fuseau du circuit) : l'API de résultats donne l'heure locale marquée « +00:00 ».
import { fixedSeason, scheduleSeason } from '../core/seasons.js';
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { frDateTime } from '../lib/time.js';
import { clip, gather, PENDING, sportTitle } from './http.js';

const API = 'https://api.motogp.pulselive.com/motogp/v1';
const RESULTS = `${API}/results`;
const GP_AHEAD = 2; // les deux prochains Grands Prix
const FAVOURITES = 7; // + « Un autre pilote » : 8 options au plus
const LENGTH = { RAC: HOUR + 30 * MINUTE, SPR: HOUR }; // le classement est attendu un peu après l'arrivée

export const CLASSES = [
  { id: 'motogp', label: 'MotoGP' },
  { id: 'moto2', label: 'Moto2' },
  { id: 'moto3', label: 'Moto3' },
];

// Noms des Grands Prix en français (code court de l'API) ; à défaut, le pays.
const GP_NAMES = {
  AME: 'des Amériques', ARA: 'd’Aragon', ARG: 'd’Argentine', AUS: 'd’Australie', AUT: 'd’Autriche', BRA: 'du Brésil',
  CAT: 'de Catalogne', CZE: 'de Tchéquie', EMI: 'd’Émilie-Romagne', FRA: 'de France', GBR: 'de Grande-Bretagne',
  GER: 'd’Allemagne', HUN: 'de Hongrie', INA: 'd’Indonésie', IND: 'd’Inde', ITA: 'd’Italie', JPN: 'du Japon',
  KAZ: 'du Kazakhstan', MAL: 'de Malaisie', NED: 'des Pays-Bas', POR: 'du Portugal', QAT: 'du Qatar',
  RSM: 'de Saint-Marin', SPA: 'd’Espagne', THA: 'de Thaïlande', USA: 'des États-Unis', VAL: 'de Valence',
};
const regions = new Intl.DisplayNames(['fr'], { type: 'region' });

function gpName(gp) {
  if (GP_NAMES[gp.short_name]) return `Grand Prix ${GP_NAMES[gp.short_name]}`;
  try {
    return clip(`Grand Prix · ${regions.of(gp.country?.iso)}`, 60);
  } catch {
    return clip(gp.name, 60);
  }
}

const DETAILS = 'Résultat : vainqueur officiel (classement de MotoGP.com). Course annulée (pluie, sécurité…) : pari annulé.';

/** « MotoGP™ » (résultats) ou « MotoGP » (calendrier) → la catégorie motogp */
const classOf = (category) => CLASSES.find((c) => c.id === String(category?.name).replace(/[^a-z0-9]/gi, '').toLowerCase());
const riderName = (r) => clip(r?.full_name ?? '?', 40);
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

/** « 30 oct. – 1er nov. », « 6 – 8 nov. » : les jours du Grand Prix (dates du circuit). */
function weekend(gp) {
  const [a, b] = [gp.date_start, gp.date_end].map((d) => new Date(`${d}T12:00:00Z`));
  if (!(a <= b)) return null;
  const day = (d) => (d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate()));
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${day(a)} – ${day(b)} ${monthFmt.format(b)}`
    : `${day(a)} ${monthFmt.format(a)} – ${day(b)} ${monthFmt.format(b)}`;
}
const hexColor = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c.toLowerCase() : null);

/**
 * Les pilotes d'une course, pour l'affichage : photo officielle (recadrée sur le visage par /media), numéro, couleur
 * de l'équipe. profiles : fiches de la saison (liste des pilotes de MotoGP.com), par riders_api_uuid.
 */
function field(riders, profiles, ranked) {
  const teams = new Map(ranked.map((c) => [c.rider?.id, c.team?.name]));
  return {
    layout: 'field',
    competitors: riders.map((r) => {
      const step = profiles.get(r.riders_api_uuid)?.current_career_step;
      const surname = String(r.full_name ?? '').split(' ').at(-1) ?? '';
      return {
        key: r.id, name: riderName(r), number: Number.isInteger(r.number) ? r.number : null, abbr: surname.slice(0, 3).toUpperCase(),
        img: step?.pictures?.profile?.main ?? null, color: hexColor(step?.team?.color), team: clip(step?.sponsored_team ?? teams.get(r.id) ?? '', 40),
        country: r.country?.iso ?? null,
      };
    }),
  };
}

const resultsUrl = (year, gp, cls, type) => `https://www.motogp.com/fr/gp-results/${year}/${gp.short_name}/${cls.label}/${type}/Classification`;

function classMarkets({ gp, name, year, cls, category, standings, broadcasts, now, season, profiles }) {
  const ranked = standings?.classification ?? [];
  const top = ranked.slice(0, FAVOURITES).map((c) => c.rider).filter((r) => r?.id);
  if (top.length < 2) return [];
  const leader = top[0];
  /** Départ (calendrier officiel) de la course ou du sprint de cette catégorie, s'il est encore à venir. */
  const start = (type) => {
    const b = broadcasts.find((x) => x.kind === 'RACE' && x.shortname === type && x.status !== 'CANCELLED' && classOf(x.category) === cls);
    const at = Date.parse(b?.date_start);
    return at > now + 10 * MINUTE ? at : null;
  };
  const winnerOptions = [...top.map((r) => ({ key: r.id, label: riderName(r) })), { key: 'other', label: 'Un autre pilote' }];
  const media = field(top, profiles, ranked);
  const list = [];
  const race = start('RAC');
  if (race) {
    list.push({ at: race, type: 'RAC', market: 'race', kind: 'multi', question: sportTitle('Moto', cls.label, name), options: winnerOptions });
  }
  const sprint = start('SPR');
  if (sprint) list.push({ at: sprint, type: 'SPR', market: 'sprint', kind: 'multi', question: sportTitle('Moto', cls.label, `${name}, sprint`), options: winnerOptions });
  return list.map(({ at, type, market, ...m }) => {
    const url = resultsUrl(year, gp, cls, type);
    return {
      ...m, id: `${cls.id}-${market}`, closesAt: at, expectedAt: at + LENGTH[type], competition: cls.id, season: season ?? fixedSeason(at),
      details: DETAILS, media,
      ref: {
        event: gp.id, category: category.id, type, market, url, closesMax: at,
        label: `${cls.label} · ${name}${type === 'SPR' ? ' (sprint)' : ''}`,
        riders: top.map((r) => r.id), leader: leader.id, key: `moto:${gp.id}:${cls.id}:${market}`,
      },
    };
  });
}

export default {
  id: 'moto',
  category: 'sport',
  emoji: '🏍️',
  name: 'Grands Prix moto',
  provider: { name: 'MotoGP.com', url: 'https://www.motogp.com/fr' },
  about: 'Les deux prochains Grands Prix (course et sprint) ; le vainqueur arrive tout seul après l’arrivée.',
  competitions: CLASSES.map((c) => ({ ...c, fallbackMonth: 1 })),
  params: [],
  /** « moto:<GP>:motogp:race » → motogp */
  competitionOf: (ref) => String(ref.key ?? '').split(':')[2] ?? null,
  /** Ce pari est-il encore proposé ? Le vainqueur de la course et du sprint (une course à part) ; le reste est retiré. */
  offers: (ref) => ['race', 'sprint'].includes(ref.market),

  async events({ competitions: classes = [] }, { fetchJson, now }) {
    if (!classes.length) return [];
    const season = (await fetchJson(`${RESULTS}/seasons`, { ttl: DAY })).find((s) => s.current);
    if (!season) return [];
    const [upcoming, started, categories] = await Promise.all([
      fetchJson(`${RESULTS}/events?seasonUuid=${season.id}&isFinished=false`, { ttl: HOUR }),
      // Le Grand Prix du week-end en cours est déjà rangé parmi les « terminés » (statut CURRENT).
      fetchJson(`${RESULTS}/events?seasonUuid=${season.id}&isFinished=true`, { ttl: HOUR }),
      fetchJson(`${RESULTS}/categories?seasonUuid=${season.id}`, { ttl: DAY }),
    ]);
    const today = new Date(now).toISOString().slice(0, 10);
    const gps = [...started, ...upcoming]
      .filter((e) => !e.test && e.status !== 'FINISHED' && e.date_end >= today && e.toad_api_uuid)
      .sort((a, b) => a.date_start.localeCompare(b.date_start))
      .slice(0, GP_AHEAD);
    const wanted = CLASSES.filter((cls) => classes.includes(cls.id))
      .map((cls) => ({ cls, category: categories.find((c) => classOf(c) === cls) }))
      .filter((x) => x.category);
    if (!gps.length || !wanted.length) return [];
    // La saison : du premier au dernier Grand Prix du calendrier (essais privés exclus).
    const races = [...started, ...upcoming].filter((e) => !e.test && e.date_start && e.date_end);
    const day = (d) => Date.parse(`${d}T12:00:00Z`);
    const season2 = races.length
      ? scheduleSeason(season.year, Math.min(...races.map((e) => day(e.date_start))), Math.max(...races.map((e) => day(e.date_end))))
      : null;

    const [standings, calendars, [riders]] = await Promise.all([
      gather(wanted.map(({ category }) => () => fetchJson(`${RESULTS}/standings?seasonUuid=${season.id}&categoryUuid=${category.id}`, { ttl: HOUR }))),
      gather(gps.map((gp) => () => fetchJson(`${API}/events/${encodeURIComponent(gp.toad_api_uuid)}`, { ttl: HOUR }))),
      // Les fiches des pilotes (photos, couleurs d'équipe) : facultatives, les paris s'ouvrent sans.
      gather([() => fetchJson(`${API}/riders?seasonYear=${encodeURIComponent(season.year)}`, { ttl: DAY })]),
    ]);
    const profiles = new Map((riders.ok && Array.isArray(riders.value) ? riders.value : []).map((p) => [p.id, p]));
    if (calendars.every((r) => !r.ok)) throw calendars[0].error;
    if (standings.every((r) => !r.ok)) throw standings[0].error;

    return gps.map((gp, g) => {
      const broadcasts = calendars[g].ok ? calendars[g].value?.broadcasts ?? [] : [];
      const name = gpName(gp);
      const markets = wanted.flatMap(({ cls, category }, i) => (standings[i].ok
        ? classMarkets({ gp, name, year: season.year, cls, category, standings: standings[i].value, broadcasts, now, season: season2, profiles })
        : []));
      if (!markets.length) return null;
      const main = markets.find((m) => m.ref.type === 'RAC') ?? markets[0];
      return {
        id: gp.id,
        title: name,
        subtitle: `${clip(gp.circuit?.place || gp.circuit?.name || 'Moto', 30)} · ${weekend(gp) ?? frDateTime(main.closesAt)}`,
        startsAt: Math.min(...markets.map((m) => m.closesAt)),
        url: main.ref.url,
        markets,
      };
    }).filter(Boolean);
  },

  async result(ref, { fetchJson }) {
    const sessions = await fetchJson(`${RESULTS}/sessions?eventUuid=${encodeURIComponent(ref.event)}&categoryUuid=${encodeURIComponent(ref.category)}`);
    const session = Array.isArray(sessions) ? sessions.filter((s) => s.type === ref.type).at(-1) : null;
    if (session?.status === 'CANCELLED') return { state: 'void', note: ref.type === 'SPR' ? 'Sprint annulé' : 'Course annulée' };
    if (session?.status !== 'FINISHED') return PENDING;
    const data = await fetchJson(`${RESULTS}/session/${encodeURIComponent(session.id)}/classification?test=false`);
    const ranked = (data.classification ?? []).filter((c) => Number.isInteger(c.position) && c.rider?.id).sort((a, b) => a.position - b.position);
    const winner = ranked[0]?.position === 1 ? ranked[0].rider : null;
    if (!winner) return PENDING;
    // « Un Français sur le podium ? » et « le leader gagne ? » : paris ouverts avant le 30 octobre 2026, gardés pour régler
    // ceux qui ont des pronostics.
    if (ref.market === 'fr') {
      const podium = ranked.filter((c) => c.position <= 3);
      return {
        state: 'final', key: podium.some((c) => c.rider.country?.iso === 'FR') ? 'yes' : 'no',
        note: `Podium : ${podium.map((c) => riderName(c.rider)).join(', ')}`,
      };
    }
    const note = `Vainqueur : ${riderName(winner)}`;
    if (ref.market === 'leader') return { state: 'final', key: winner.id === ref.leader ? 'yes' : 'no', note };
    // Le podium, pour l'affichage (photos des pilotes connus du pari).
    const live = {
      state: 'post', clock: 'Arrivée', podium: ranked.filter((c) => c.position <= 3).map((c) => ({ key: c.rider.id, name: riderName(c.rider), number: c.rider.number ?? null })),
      ...raceFacts(data),
    };
    return { state: 'final', key: ref.riders.includes(winner.id) ? winner.id : 'other', note, live };
  },
};

/** « 01:59.261 » → « 1:59.261 ». */
const lapTime = (t) => String(t ?? '').replace(/^0(\d:)/, '$1');

/**
 * Le classement complet (fiche du pari) : place, pilote, équipe, écart (temps du vainqueur, « +4.172 », « +1 tour »),
 * non-classés (« Abandon », tours bouclés) ; et le meilleur tour de la course.
 */
function raceFacts(data) {
  const ranking = (data.classification ?? []).filter((c) => c.rider).map((c) => {
    const classified = Number.isInteger(c.position);
    const lapsDown = Number(c.gap?.lap) || 0;
    const gap = !classified ? null : c.position === 1 ? lapTime(c.time) : lapsDown > 0 ? `+${lapsDown} tour${lapsDown > 1 ? 's' : ''}` : c.gap?.first ? `+${c.gap.first}` : null;
    return {
      pos: classified ? c.position : null, name: riderName(c.rider), team: clip(c.team?.name ?? '', 40) || null, gap,
      grid: null, out: classified ? null : `Abandon${Number.isFinite(c.total_laps) ? ` (${c.total_laps} tour${c.total_laps > 1 ? 's' : ''})` : ''}`,
    };
  });
  const best = (data.records ?? []).find((r) => r.type === 'fastestLap');
  const fastest = best?.rider ? { name: riderName(best.rider), time: lapTime(best.bestLap?.time), lap: Number(best.bestLap?.number) || null } : null;
  return ranking.length ? { ranking, ...(fastest ? { fastest } : {}) } : {};
}
