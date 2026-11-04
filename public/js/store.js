// Mémoire de l'appareil (localStorage) : seulement des commodités. Si elle est vide ou bloquée,
// l'app marche quand même : on rouvre le lien du groupe et on se reconnecte avec son PIN.

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

/** Groupes connus sur cet appareil : [{ id, name, emoji, role }] (id : l'adresse du groupe). */
export const myGroups = () => read('pt:groups', []);

export function rememberGroup({ id, name, emoji, role }) {
  const previous = myGroups().find((g) => g.id === id);
  const list = myGroups().filter((g) => g.id !== id);
  list.unshift({ id, name, emoji, role: role ?? previous?.role ?? null });
  write('pt:groups', list.slice(0, 20));
}

/** Mes groupes, tels que mon compte les connaît (connecté) : remplacent ceux gardés sur l'appareil. */
export function setGroups(list) {
  write('pt:groups', list.map(({ id, name, emoji, role }) => ({ id, name, emoji, role: role ?? null })));
  if (lastGroup() && !list.some((g) => g.id === lastGroup())) write('pt:last', null);
}

export function forgetGroup(id) {
  write('pt:groups', myGroups().filter((g) => g.id !== id));
  if (lastGroup() === id) write('pt:last', null);
}

export const lastGroup = () => read('pt:last', null);
export const setLastGroup = (id) => write('pt:last', id);

// « Nouveau » : les paris créés depuis la visite précédente. La référence est figée pour tout l'onglet.
const baselines = new Map();
export function visitBaseline(groupId, now) {
  if (!baselines.has(groupId)) baselines.set(groupId, read(`pt:visit:${groupId}`, now));
  write(`pt:visit:${groupId}`, now);
  return baselines.get(groupId);
}

export const pref = (key, fallback) => read(`pt:pref:${key}`, fallback);
export const setPref = (key, value) => write(`pt:pref:${key}`, value);
