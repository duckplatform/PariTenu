// Sources de données : chacune ouvre toute seule des paris dans une catégorie et rapporte leur résultat.
//
// Une source :
//   id, category (catégorie du groupe), emoji, name, provider { name, url }, about
//   competitions      sources sportives : [{ id, label, fallbackMonth }] — chacune a son classement et ses saisons ;
//                     absent : la source s'active d'un bloc et ses paris comptent dans le classement de la catégorie
//   params            réglages du groupe : [{ key, type: 'multi' | 'text' | 'place', label, default, … }]
//   events(params, io) → événements à venir : [{ id, title, subtitle, startsAt, url, markets }] ;
//       params.competitions : les compétitions choisies par le groupe
//       un marché = un pari prêt à ouvrir : { id, kind, question, options: [{ key, label }], closesAt, expectedAt, details,
//                   ref, competition, season }  (ref : de quoi retrouver le résultat ; ref.key unique ;
//                   season : saison officielle { label, startsAt, endsAt } pour les sources sportives)
//   result(ref, io)    → { state: 'pending' } | { state: 'final', key, note } | { state: 'void', note }
//   competitionOf(ref) → compétition d'un pari d'avant les classements par compétition (sources sportives)
//   live(refs, io)     → Map(ref.key → { media, live }) : score en direct des rencontres commencées (facultatif)
//   needsKey           → la source demande une clé personnelle (io.keys[needsKey]) ; sans elle, elle n'est pas proposée
//   io = { fetchJson, now, keys }
import { badRequest } from '../lib/errors.js';
import crypto from './crypto.js';
import f1 from './f1.js';
import foot from './foot.js';
import manifold from './manifold.js';
import meteo from './meteo.js';
import mma from './mma.js';
import moto from './moto.js';
import padel from './padel.js';
import { afl, baseball, basket, hockey, rugby, usfoot } from './sports.js';
import tennis from './tennis.js';

export const SOURCES = [foot, usfoot, rugby, basket, hockey, baseball, tennis, padel, mma, f1, moto, afl, crypto, meteo, manifold];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) ?? null;

export const defaultParams = (source) => Object.fromEntries(source.params.map((p) => [p.key, structuredClone(p.default)]));

/** Ce qu'un groupe peut activer dans une source : ses compétitions, ou la source entière (une seule « compétition »). */
export const choicesOf = (source) => source.competitions?.map((c) => c.id) ?? [source.id];

/** Compétitions activées par un admin : connues, sans doublon (vide : rien d'activé). */
export function normalizeCompetitions(source, input = []) {
  const known = new Set(choicesOf(source));
  if (!Array.isArray(input) || input.some((x) => !known.has(x))) throw badRequest(`${source.name} : compétition inconnue.`);
  return [...new Set(input)];
}

/** Réglages d'une source envoyés par un admin : vérifiés et complétés par les valeurs par défaut. */
export function normalizeParams(source, input = {}) {
  const out = defaultParams(source);
  for (const p of source.params) {
    const v = input?.[p.key];
    if (v === undefined) continue;
    if (p.type === 'multi') {
      const ids = new Set(p.choices.map((c) => c.id));
      if (!Array.isArray(v) || v.some((x) => !ids.has(x))) throw badRequest(`${source.name} : choix inconnu dans « ${p.label} ».`);
      if (!v.length) throw badRequest(`${source.name} : choisis au moins une option dans « ${p.label} ».`);
      out[p.key] = [...new Set(v)];
    } else if (p.type === 'text') {
      if (typeof v !== 'string' || v.trim().length > p.max) throw badRequest(`${source.name} : « ${p.label} » fait au plus ${p.max} caractères.`);
      out[p.key] = v.trim();
    } else if (p.type === 'place') {
      const ok = v && typeof v.name === 'string' && v.name.trim().length >= 1 && v.name.length <= 60
        && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90 && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180
        && (v.country === undefined || (typeof v.country === 'string' && v.country.length <= 60));
      if (!ok) throw badRequest(`${source.name} : choisis une ville dans la liste.`);
      out[p.key] = { name: v.name.trim(), lat: v.lat, lon: v.lon, country: v.country ?? '' };
    }
  }
  return out;
}
