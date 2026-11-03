import { FIXED_ODDS } from '../core/scoring.js';
import { readSettings } from '../core/settings.js';
import { forbidden, HttpError, notFound } from '../lib/errors.js';
import { DAY, HOUR, MINUTE } from '../lib/util.js';
import { createFetchJson, SourceError } from '../sources/http.js';
import { choicesOf, defaultParams, normalizeCompetitions, normalizeParams, SOURCES, sourceById } from '../sources/index.js';
import { MIN_CLOSE_DELAY } from './bets.js';
import { addEvent } from './events.js';

const RECHECK = 10 * MINUTE; // résultat attendu : on revient voir toutes les 10 minutes…
const RECHECK_LATE = HOUR; // … puis toutes les heures quand la source tarde (plus de 24 h)
const MANUAL_GAP = MINUTE; // le bouton « Vérifier le résultat » ne relance pas la source plus d'une fois par minute
const LIVE_EVERY = 50_000; // direct : relu chaque minute pendant le match (le minuteur passe toutes les 60 s)…
const LIVE_LATE = 15 * MINUTE; // … puis tous les quarts d'heure si le score final tarde
const LIVE_WINDOW = 3 * DAY; // au-delà, on ne cherche plus le score d'une rencontre
const FACTS = ['events', 'periods', 'stats', 'leaders', 'finish']; // faits de match du direct (src/sources/facts.js)
// Version des faits de match : une rencontre finie lue avec une version plus ancienne (ou jamais lue) est relue une fois.
// 2 : passeurs au foot, actions qui marquent en football américain, buts et pénalités au hockey (2026-11-01).
const FACTS_READ = 2;

/**
 * Score final connu : on ne relit plus la rencontre. « Terminé » sans score (le padel donne parfois les sets après
 * coup) n'en est pas un, tant que le pari attend son résultat ; une fois réglé, le direct est le meilleur qu'on aura.
 */
const finalScore = (live, status) => live?.state === 'post'
  && (live.scores != null || live.podium?.length > 0 || live.winner != null || !['open', 'closed'].includes(status));

/**
 * Sources de données : paris ouverts automatiquement et résultats automatiques.
 * Un admin active des compétitions (Ligue 1, NFL…) ou une source entière (météo…) : tous leurs paris disponibles
 * s'ouvrent tout seuls (autoOpen, appelé régulièrement et après chaque réglage). Indépendant des catégories, qui ne
 * règlent que les paris maison (bouton « Nouveau pari »).
 */
export class SourceService {
  constructor(db, clock, groups, bets, { fetch, logger, sources = SOURCES, live, keys = {} } = {}) {
    this.db = db;
    this.clock = clock;
    this.groups = groups;
    this.bets = bets;
    this.live = live; // LiveStore : équipes, pilotes et score de chaque rencontre
    this.logger = logger ?? { warn() {}, error() {} };
    // Une source qui demande une clé personnelle (padel) n'est proposée que si la clé est configurée.
    this.keys = keys;
    this.all = sources;
    this.available = sources.filter((s) => !s.needsKey || keys[s.needsKey]);
    // Coupées par l'admin du site, pour tous les groupes : plus proposées ni ouvertes (les paris joués vont au bout).
    const row = db.prepare("SELECT value FROM instance_settings WHERE key = 'disabled_sources'").get();
    this.disabled = new Set(row ? JSON.parse(row.value) : []);
    this.fetchJson = createFetchJson({ fetch, clock });
    this.memo = new Map(); // ce que les sources gardent d'une relecture à l'autre (résumé d'un match en cours)
    // Admin du site : dernière lecture réussie de chaque source, et depuis quand elle ne répond plus (en mémoire).
    this.health = new Map(); // source id → { okAt, failingSince, error }
  }

  /** Une lecture d'une source (paris à ouvrir, direct, résultat) : sa réussite ou son échec est noté pour l'admin. */
  async #read(source, fn) {
    const health = this.health.get(source.id) ?? { okAt: null, failingSince: null, error: null };
    try {
      const out = await fn();
      this.health.set(source.id, { okAt: this.clock.now(), failingSince: null, error: null });
      return out;
    } catch (err) {
      this.health.set(source.id, { ...health, failingSince: health.failingSince ?? this.clock.now(), error: err.message });
      throw err;
    }
  }

  /** Les sources proposées aux groupes : disponibles (clé configurée) et pas coupées par l'admin du site. */
  get sources() {
    return this.available.filter((s) => !this.disabled.has(s.id));
  }

  /**
   * Admin du site : couper une source (ses paris encore sans pronostic disparaissent de tous les groupes, les autres
   * vont jusqu'à leur résultat) ou la rallumer (ses paris se rouvrent là où elle était réglée). Les réglages des groupes
   * restent : rallumée, la source reprend dans chaque groupe comme avant. Rend le nombre de paris retirés.
   */
  setEnabled(sourceId, enabled) {
    if (!this.all.some((s) => s.id === sourceId)) throw notFound('Source de données inconnue.');
    if (enabled) this.disabled.delete(sourceId);
    else this.disabled.add(sourceId);
    this.db.prepare(`INSERT INTO instance_settings (key, value) VALUES ('disabled_sources', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify([...this.disabled].sort()));
    let removed = 0;
    if (!enabled) for (const { id } of this.db.prepare('SELECT id FROM groups').all()) removed += this.prune(id);
    return removed;
  }

  /** Admin du site : chaque source, son état et son usage (groupes qui l'ont réglée, paris ouverts). */
  overview() {
    const groups = this.db.prepare('SELECT id, settings FROM groups').all().map((g) => ({ id: g.id, sources: readSettings(g.settings).sources }));
    const open = new Map(this.db.prepare("SELECT source, COUNT(*) AS n FROM bets WHERE source IS NOT NULL AND status IN ('open', 'closed') GROUP BY source").all()
      .map((r) => [r.source, r.n]));
    return this.all.map((s) => ({
      id: s.id, category: s.category, emoji: s.emoji, name: s.name, about: s.about, provider: s.provider?.name ?? null,
      competitions: s.competitions?.length ?? 0,
      key: s.needsKey ? (this.keys[s.needsKey] ? 'ok' : 'missing') : null,
      keyName: s.needsKey ? `PT_${s.needsKey.toUpperCase()}_TOKEN` : null, // la variable de .env (src/config.js)
      enabled: !this.disabled.has(s.id),
      readAt: this.health.get(s.id)?.okAt ?? null,
      failingSince: this.health.get(s.id)?.failingSince ?? null,
      error: this.health.get(s.id)?.error ?? null,
      groups: groups.filter((g) => g.sources[s.id]?.competitions?.length > 0).length,
      openBets: open.get(s.id) ?? 0,
    }));
  }

  #io() {
    return { fetchJson: this.fetchJson, now: this.clock.now(), keys: this.keys, memo: this.memo };
  }

  #source(id) {
    const source = this.sources.find((s) => s.id === id);
    if (!source) throw notFound('Source de données inconnue.');
    return source;
  }

  /** Ce que l'instance sait proposer (page d'accueil) : les sources disponibles et leurs compétitions. */
  catalog() {
    return this.sources.map((s) => ({
      id: s.id, category: s.category, emoji: s.emoji, name: s.name, about: s.about,
      competitions: s.competitions?.map((c) => c.label) ?? [],
    }));
  }

  /** Les sources telles que le groupe les a réglées (page « Réglages des paris »). Rien n'est activé d'office. */
  forGroup(groupId) {
    const settings = this.groups.settings(groupId);
    return this.sources.map((s) => {
      const cfg = settings.sources[s.id] ?? {};
      const known = new Set(choicesOf(s));
      const selected = Array.isArray(cfg.competitions) ? cfg.competitions.filter((c) => known.has(c)) : [];
      const category = settings.categories.find((c) => c.id === s.category);
      return {
        id: s.id, category: s.category, emoji: s.emoji, name: s.name, provider: s.provider, about: s.about,
        competitions: s.competitions?.map(({ id, label }) => ({ id, label })) ?? null,
        params: s.params, values: { ...defaultParams(s), ...cfg.params },
        selected, active: selected.length > 0 && !!category,
      };
    });
  }

  /**
   * Les compétitions (et sources hors sport) que le groupe propose : [{ key, emoji, label, sport }]. Chaque membre choisit
   * d'y participer ou non (FollowService) ; key = le « fil » de leurs paris (feedOf).
   */
  offered(groupId) {
    return this.forGroup(groupId).filter((v) => v.active).flatMap((v) => (v.competitions
      ? v.competitions.filter((c) => v.selected.includes(c.id)).map((c) => ({ key: `${v.id}:${c.id}`, emoji: v.emoji, label: c.label, sport: v.name }))
      : [{ key: v.id, emoji: v.emoji, label: v.name, sport: null }]));
  }

  /** Réglages des sources envoyés par un admin : { [id]: { competitions, params } }, vérifiés source par source. */
  normalizeConfig(input) {
    return Object.fromEntries(Object.entries(input).map(([id, cfg]) => {
      const source = this.#source(id);
      return [id, { competitions: normalizeCompetitions(source, cfg.competitions), params: normalizeParams(source, cfg.params) }];
    }));
  }

  /** Paris déjà ouverts dans le groupe depuis cette source (même annulés : on ne les rouvre pas) : clé du marché → id. */
  /**
   * Une rencontre à deux (source.matchup : tennis, MMA, padel) dont les deux côtés ont changé depuis l'ouverture du pari :
   * { gone, added } (noms des options du pari disparues, de celles arrivées), ou null si c'est la même affiche.
   */
  #lineupChange(betId, options) {
    const sides = (list) => list.filter((o) => o.key !== 'draw').map((o) => `${o.key}|${o.label}`);
    const before = sides(this.bets.options(betId).map((o) => ({ key: o.source_key, label: o.label })));
    const now = sides(options);
    const gone = before.filter((x) => !now.includes(x));
    if (!gone.length) return null;
    const label = (x) => x.slice(x.indexOf('|') + 1);
    return { gone: gone.map(label), added: now.filter((x) => !before.includes(x)).map(label) };
  }

  /**
   * Paris réglés ou annulés d'une rencontre à deux dont le visuel montre un autre joueur que le pari (affiche changée
   * avant le 2026-11-03, ou relue pendant le match) : on remet l'affiche du pari. Appelé avec l'ouverture automatique.
   */
  repairMatchups() {
    let count = 0;
    for (const source of this.all.filter((s) => s.matchup)) {
      for (const row of this.db.prepare("SELECT id, source_ref FROM bets WHERE source = ? AND status IN ('settled', 'cancelled')").all(source.id)) {
        const key = JSON.parse(row.source_ref).key;
        const shown = new Set((this.live?.get(key)?.media?.competitors ?? []).map((c) => `${c.key}|${c.name}`));
        if (!shown.size) continue;
        const options = this.bets.options(row.id).filter((o) => o.source_key != null && o.source_key !== 'draw');
        if (options.every((o) => shown.has(`${o.source_key}|${o.label}`))) continue;
        this.#restoreMedia(row.id, key);
        count++;
      }
    }
    return count;
  }

  /** Le visuel d'un pari annulé pour changement d'affiche : ses options d'origine (photos gardées quand elles y sont). */
  #restoreMedia(betId, key) {
    const media = this.live?.get(key)?.media;
    if (!media?.competitors) return;
    const byKey = new Map(media.competitors.map((c) => [c.key, c]));
    const competitors = this.bets.options(betId).filter((o) => o.source_key != null && o.source_key !== 'draw').map((o) => {
      const c = byKey.get(o.source_key);
      return c && c.name === o.label ? c : { key: o.source_key, name: o.label };
    });
    this.live.saveMedia(key, { ...media, competitors });
  }

  #linked(groupId, sourceId) {
    const rows = this.db.prepare('SELECT id, source_ref FROM bets WHERE group_id = ? AND source = ?').all(groupId, sourceId);
    return new Map(rows.map((r) => [JSON.parse(r.source_ref).key, r.id]));
  }

  /**
   * Ouvre tous les paris disponibles des sources actives (d'un groupe, ou de tous), quels que soient les types de paris
   * maison activés ; une source injoignable n'empêche pas les autres. Le fil du groupe reçoit un résumé par compétition.
   */
  async autoOpen(groupId = null) {
    const ids = groupId ? [groupId] : this.db.prepare('SELECT id FROM groups').all().map((r) => r.id);
    let total = 0;
    for (const gid of ids) {
      const opened = new Map();
      const names = new Map();
      for (const view of this.forGroup(gid).filter((v) => v.active)) {
        const source = this.#source(view.id);
        let events;
        try {
          events = await this.#read(source, () => source.events({ ...view.values, competitions: view.selected }, this.#io()));
        } catch (err) {
          if (!(err instanceof SourceError) && !(err instanceof TypeError)) throw err;
          this.logger.warn({ source: source.id, err: err.message }, 'Ouverture automatique : source injoignable');
          continue;
        }
        const linked = this.#linked(gid, source.id);
        const now = this.clock.now();
        for (const market of events.flatMap((e) => e.markets)) {
          // Barème d'un pari sportif : la cote des bookmakers si la source la donne pour chaque option, sinon le barème fixe.
          const bookmaker = !!source.competitions && market.options.every((o) => o.odds > 1);
          if (linked.has(market.ref.key)) {
            const betId = linked.get(market.ref.key);
            // Un joueur (ou une paire) a déclaré forfait et un autre le remplace, sous le même numéro de match : le pari
            // portait sur l'ancienne affiche, il est annulé ; son visuel garde l'affiche d'origine.
            const change = source.matchup ? this.#lineupChange(betId, market.options) : null;
            if (change) {
              const note = `Forfait avant le match : ${change.gone.join(' et ')} remplacé${change.gone.length > 1 ? 's' : ''} par ${change.added.join(' et ')}`;
              if (this.bets.cancelForSource(betId, note)) this.#restoreMedia(betId, market.ref.key);
              continue;
            }
            if (market.media) this.live?.saveMedia(market.ref.key, market.media);
            if (bookmaker) this.bets.setBookmakerOdds(betId, Object.fromEntries(market.options.map((o) => [o.key, o.odds])));
            continue;
          }
          if (market.media) this.live?.saveMedia(market.ref.key, market.media);
          if (market.closesAt < now + MIN_CLOSE_DELAY) continue;
          if (source.competitions && !view.selected.includes(market.competition)) continue;
          const ranking = source.competitions ? `${source.id}:${market.competition}` : `cat:${source.category}`;
          const comp = source.competitions?.find((c) => c.id === market.competition);
          names.set(ranking, `${comp?.emoji ?? source.emoji} ${comp?.label ?? source.name}`);
          const scoring = !source.competitions ? 'group' : bookmaker ? 'bookmaker' : 'fixed';
          const options = market.options.map((o) => ({ ...o, odds: scoring === 'bookmaker' ? o.odds : scoring === 'fixed' ? FIXED_ODDS : null }));
          try {
            const id = this.bets.createAuto(gid, {
              question: market.question, details: market.details, category: source.category, kind: market.kind,
              closesAt: market.closesAt, expectedAt: market.expectedAt,
            }, { source: source.id, ref: market.ref, options, ranking, season: source.competitions ? market.season : null, scoring });
            linked.set(market.ref.key, id);
            opened.set(ranking, (opened.get(ranking) ?? 0) + 1);
          } catch (err) {
            this.logger.warn({ source: source.id, market: market.ref.key, err: err.message }, 'Ouverture automatique : pari refusé');
          }
        }
      }
      const count = [...opened.values()].reduce((a, b) => a + b, 0);
      if (count) {
        addEvent(this.db, this.clock.now(), {
          groupId: gid, type: 'auto_opened',
          data: { count, rankings: [...opened].map(([ranking, n]) => ({ ranking, n })), labels: [...opened].map(([ranking, n]) => `${names.get(ranking)} (${n})`).join(', ') },
        });
      }
      total += count;
    }
    return total;
  }

  /**
   * Après un changement de réglages (et au démarrage) : les paris ouverts automatiquement d'une compétition désactivée, ou qu'une source ne propose plus, disparaissent tant qu'ils n'ont pas de pronostic. Ceux qui ont
   * des pronostics vont jusqu'au bout.
   */
  prune(groupId) {
    const views = new Map(this.forGroup(groupId).map((v) => [v.id, v]));
    const rows = this.db.prepare(`SELECT id, source, source_ref, ranking, kind FROM bets b WHERE group_id = ? AND creator_id IS NULL AND source IS NOT NULL
        AND status = 'open' AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.bet_id = b.id)`).all(groupId);
    let removed = 0;
    for (const r of rows) {
      const view = views.get(r.source);
      const competition = view?.competitions ? (r.ranking ?? '').slice(r.source.length + 1) : r.source;
      const offered = sourceById(r.source)?.offers?.(JSON.parse(r.source_ref)) ?? true;
      if (offered && view?.active && view.selected.includes(competition)) continue;
      this.db.prepare('DELETE FROM bets WHERE id = ?').run(r.id);
      removed++;
    }
    return removed;
  }

  /** Demande le résultat d'un pari à sa source et l'applique s'il est connu. Rend { state }. */
  async check(betId) {
    const bet = this.bets.get(betId);
    if (!bet.source || bet.status !== 'closed') return { state: bet.status };
    const source = sourceById(bet.source);
    if (!source) return { state: 'error' };
    this.bets.markChecked(bet.id);
    let outcome;
    try {
      outcome = await this.#read(source, () => source.result(JSON.parse(bet.source_ref), this.#io()));
    } catch (err) {
      this.logger.warn({ source: source.id, bet: bet.id, err: err.message }, 'Résultat : source injoignable');
      return { state: 'error' };
    }
    if (outcome.state === 'pending') return outcome;
    const ref = JSON.parse(bet.source_ref);
    // Un joueur du pari n'a pas joué (forfait remplacé trop tard pour que l'ouverture automatique le voie) : annulé.
    let replaced = false;
    if (source.matchup && outcome.state === 'final') {
      const played = new Set(Object.keys(outcome.live?.scores ?? {}).map(String));
      const options = this.bets.options(bet.id).filter((o) => o.source_key != null && o.source_key !== 'draw');
      const missing = options.filter((o) => played.size && !played.has(String(o.source_key)));
      if (missing.length || !options.some((o) => String(o.source_key) === String(outcome.key))) {
        const note = missing.length
          ? `Forfait avant le match : ${missing.map((o) => o.label).join(' et ')} ${missing.length > 1 ? 'n’ont' : 'n’a'} pas joué`
          : 'Forfait avant le match : le vainqueur n’était pas dans ce pari';
        outcome = { state: 'void', note, live: outcome.live };
        replaced = true;
      }
    }
    if (outcome.live && this.live) this.live.saveLive(ref.key, await this.#withFacts(source, ref, outcome.live));
    this.bets.applySourceResult(bet.id, outcome, source.provider.name);
    if (replaced) this.#restoreMedia(bet.id, ref.key);
    return { state: outcome.state, note: outcome.note };
  }

  /**
   * Le direct d'un résultat garde les faits du match lus pendant la rencontre dans le tableau du jour (buts, cartons,
   * statistiques…) : le résumé que lit result() n'en a pas, ou moins. Si on les a lus avant la fin du match, on relit le
   * direct une dernière fois.
   */
  async #withFacts(source, ref, live) {
    let before = this.live.get(ref.key)?.live ?? null;
    if (before && before.state !== 'post' && FACTS.some((k) => before[k] != null) && source.live) {
      try {
        before = (await source.live([ref], this.#io())).get(ref.key)?.live ?? before;
      } catch { /* le dernier état connu suffit */ }
    }
    const kept = FACTS.filter((k) => before?.[k] != null);
    // Déjà lue finie avec les faits d'aujourd'hui (refreshLive) : on ne la relira pas pour eux.
    const read = before?.factsRead ? { factsRead: before.factsRead } : {};
    return { ...live, ...Object.fromEntries(kept.map((k) => [k, before[k]])), ...read };
  }

  /** Bouton « Vérifier le résultat » sur la fiche d'un pari. */
  async checkNow(me, betId) {
    const bet = this.bets.get(betId);
    if (bet.group_id !== me.group_id) throw notFound("Ce pari n'existe pas (ou plus).");
    if (!bet.source) throw forbidden('Ce pari est tranché par son arbitre.');
    if (bet.status !== 'closed') return { state: bet.status };
    if (bet.source_checked_at && this.clock.now() - bet.source_checked_at < MANUAL_GAP) return { state: 'pending' };
    return this.check(bet.id);
  }

  /** Tous les paris dont le résultat est attendu (appelé toutes les 5 minutes). */
  async checkDue() {
    const now = this.clock.now();
    const due = this.db.prepare(`SELECT id, closes_at, expected_at, source_checked_at FROM bets
      WHERE source IS NOT NULL AND status = 'closed' AND MAX(closes_at, COALESCE(expected_at, 0)) <= ?`).all(now)
      .filter((b) => {
        const late = now - Math.max(b.closes_at, b.expected_at ?? 0) > DAY;
        return !b.source_checked_at || now - b.source_checked_at >= (late ? RECHECK_LATE : RECHECK);
      });
    for (const { id } of due) {
      try {
        await this.check(id);
      } catch (err) {
        this.logger.error({ bet: id, err: err.stack }, 'Résultat : échec');
      }
    }
    return due.length;
  }

  /**
   * Scores en direct (appelé chaque minute) : les rencontres commencées depuis moins de 3 jours dont on n'a pas le score
   * final, chaque minute pendant le match, puis tous les quarts d'heure. Une requête par compétition et par jour, quel
   * que soit le nombre de groupes ; rien quand aucun match ne se joue. Une rencontre finie avant qu'on lise ses faits
   * (buts, cartons, passeurs…), ou lue avec une version plus ancienne de ceux-ci (FACTS_READ), est relue une fois. Rend
   * le nombre de rencontres relues.
   */
  async refreshLive() {
    if (!this.live) return 0;
    const now = this.clock.now();
    const rows = this.db.prepare(`SELECT b.source, b.source_ref, b.status, b.closes_at, b.expected_at, e.live, e.live_at FROM bets b
        LEFT JOIN source_events e ON e.key = json_extract(b.source_ref, '$.key')
        WHERE b.source IS NOT NULL AND b.status != 'cancelled' AND b.closes_at <= ? AND b.closes_at > ?`).all(now, now - LIVE_WINDOW);
    const due = new Map(); // source → Map(ref.key → ref)
    const late = new Map(); // ref.key → direct final relu seulement pour ses faits
    for (const r of rows) {
      // Une source coupée garde son direct pour les paris en cours (joués avant).
      const source = this.available.find((s) => s.id === r.source);
      const live = r.live ? JSON.parse(r.live) : null;
      const missing = finalScore(live, r.status) && source?.facts && (live.factsRead ?? 0) < FACTS_READ;
      if (!source?.live || (finalScore(live, r.status) && !missing)) continue;
      const playing = now <= Math.max(r.closes_at, r.expected_at ?? 0) + 2 * HOUR;
      if (r.live_at && now - r.live_at < (playing ? LIVE_EVERY : LIVE_LATE)) continue;
      const ref = JSON.parse(r.source_ref);
      if (!due.has(source)) due.set(source, new Map());
      due.get(source).set(ref.key, ref);
      if (missing) late.set(ref.key, live);
    }
    let count = 0;
    const ended = []; // rencontres finies (score final connu) : leurs paris se règlent sans attendre l'heure prévue
    for (const [source, refs] of due) {
      let found;
      try {
        found = await this.#read(source, () => source.live([...refs.values()], this.#io()));
      } catch (err) {
        if (!(err instanceof SourceError) && !(err instanceof TypeError)) throw err;
        this.logger.warn({ source: source.id, err: err.message }, 'Direct : source injoignable');
        continue;
      }
      for (const key of refs.keys()) {
        const info = found.get(key);
        if (info?.media) this.live.saveMedia(key, info.media);
        let live = info?.live ?? null;
        // Relue après coup sans plus rien chez la source : on garde ce qu'on avait.
        const bare = (l) => l?.state === 'post' && !FACTS.some((k) => l[k] != null);
        if (late.has(key) && (live == null || bare(live))) live = late.get(key);
        // Une rencontre lue finie (avec ou sans faits) : c'est noté, elle n'est plus relue pour eux.
        if (source.facts && live?.state === 'post') live = { ...live, factsRead: FACTS_READ };
        this.live.saveLive(key, live);
        if (finalScore(info?.live, 'closed')) ended.push(key);
        count++;
      }
    }
    for (const key of ended) {
      for (const { id } of this.db.prepare("SELECT id FROM bets WHERE status = 'closed' AND json_extract(source_ref, '$.key') = ?").all(key)) {
        await this.check(id).catch((err) => this.logger.error({ bet: id, err: err.stack }, 'Résultat : échec'));
      }
    }
    return count;
  }

  /**
   * Liens des paris déjà ouverts qu'une source sait mieux faire (source.relink : la page d'un Grand Prix de F1 chez ESPN
   * plutôt que sur Wikipédia). Appelé avec l'ouverture automatique ; rend le nombre de paris corrigés.
   */
  async relink() {
    let count = 0;
    for (const source of this.available.filter((s) => s.relink)) {
      for (const row of this.db.prepare('SELECT id, source_ref FROM bets WHERE source = ?').all(source.id)) {
        let ref;
        try {
          ref = await source.relink(JSON.parse(row.source_ref), this.#io());
        } catch (err) {
          if (!(err instanceof SourceError) && !(err instanceof TypeError)) throw err;
          this.logger.warn({ source: source.id, err: err.message }, 'Liens : source injoignable');
          break;
        }
        if (!ref) continue;
        this.db.prepare('UPDATE bets SET source_ref = ? WHERE id = ?').run(JSON.stringify(ref), row.id);
        count++;
      }
    }
    return count;
  }

  /** Recherche de ville pour la météo (réglages du groupe). */
  async places(query) {
    const meteo = this.#source('meteo');
    try {
      return await meteo.places(query, this.#io());
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      throw new HttpError(502, 'La recherche de ville ne répond pas pour le moment.', 'source_unavailable');
    }
  }
}
