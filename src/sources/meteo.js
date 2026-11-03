// 🌦️ Météo : prévisions et relevés d'Open-Meteo pour la ville du groupe (pluie, température maximale).
import { HOUR, MINUTE } from '../lib/util.js';
import { addDays, dayKey, frDay, parisDayAt } from '../lib/time.js';
import { clip, frNumber, PENDING, YES_NO } from './http.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const DAILY = 'daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FParis';
const RAIN_MM = 1; // « il pleut » : au moins 1 mm sur la journée

const at = (place) => `latitude=${place.lat}&longitude=${place.lon}`;

export default {
  id: 'meteo',
  category: 'meteo',
  emoji: '🌦️',
  name: 'Météo',
  provider: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
  about: 'Pluie et température des 7 prochains jours dans ta ville ; le relevé arrive tout seul le lendemain.',
  params: [{ key: 'place', type: 'place', label: 'Ville', default: { name: 'Paris', lat: 48.8534, lon: 2.3488, country: 'France' } }],

  async events({ place }, { fetchJson, now }) {
    const data = await fetchJson(`${FORECAST}?${at(place)}&${DAILY}&forecast_days=8`, { ttl: HOUR });
    const d = data.daily ?? {};
    const city = clip(place.name, 40);
    const today = dayKey(now);
    const events = [];
    (d.time ?? []).forEach((date, i) => {
      const tmax = d.temperature_2m_max?.[i];
      const rain = d.precipitation_sum?.[i];
      // Pronostics clos la veille à minuit : on parie sur la journée entière.
      const closesAt = parisDayAt(date, 0);
      if (date <= today || closesAt < now + 30 * MINUTE || tmax == null || rain == null) return;
      const label = frDay(parisDayAt(date, 12));
      const threshold = Math.round(tmax);
      const ref = { lat: place.lat, lon: place.lon, city, date, label: `Météo · ${city}, ${label}`, url: 'https://open-meteo.com/', closesMax: closesAt };
      const list = [
        { id: 'rain', question: `Il pleut à ${city} ${label} ?`, details: `Il pleut si Open-Meteo relève au moins ${RAIN_MM} mm sur la journée à ${city}. Prévision au lancement : ${frNumber(rain)} mm.` },
        { id: 'temp', question: `Au moins ${threshold} °C à ${city} ${label} ?`, details: `Température maximale de la journée à ${city}, relevée par Open-Meteo. Prévision au lancement : ${frNumber(tmax)} °C.` },
      ];
      events.push({
        id: date,
        title: label[0].toUpperCase() + label.slice(1),
        subtitle: `${city} · max ${frNumber(tmax)} °C · pluie ${frNumber(rain)} mm`,
        startsAt: closesAt,
        url: ref.url,
        markets: list.map((m) => ({
          ...m, kind: 'yesno', options: YES_NO, closesAt, expectedAt: parisDayAt(addDays(date, 1), 6),
          ref: { ...ref, market: m.id, threshold, key: `meteo:${place.lat},${place.lon}:${date}:${m.id}` },
        })),
      });
    });
    return events;
  },

  async result(ref, { fetchJson, now }) {
    if (now < parisDayAt(addDays(ref.date, 1), 3)) return PENDING; // la journée doit être finie
    const data = await fetchJson(`${FORECAST}?${at(ref)}&${DAILY}&start_date=${ref.date}&end_date=${ref.date}`);
    const value = (ref.market === 'rain' ? data.daily?.precipitation_sum : data.daily?.temperature_2m_max)?.[0];
    if (value == null) return PENDING;
    if (ref.market === 'rain') {
      return { state: 'final', key: value >= RAIN_MM ? 'yes' : 'no', note: `Open-Meteo : ${frNumber(value)} mm de pluie à ${ref.city}` };
    }
    return { state: 'final', key: value >= ref.threshold ? 'yes' : 'no', note: `Open-Meteo : ${frNumber(value)} °C au plus chaud à ${ref.city}` };
  },

  /** Recherche de ville pour les réglages du groupe. */
  async places(query, { fetchJson }) {
    const data = await fetchJson(`${GEOCODING}?name=${encodeURIComponent(query)}&count=6&language=fr&format=json`, { ttl: HOUR });
    return (data.results ?? []).map((r) => ({
      name: clip(r.name, 60), lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4,
      country: clip([r.admin1, r.country].filter(Boolean).join(', '), 60),
    }));
  },
};
