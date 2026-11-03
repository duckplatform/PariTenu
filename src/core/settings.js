// Réglages d'un groupe (cahier des charges § 7.6 et § 7.9), stockés en JSON dans groups.settings.

export const DEFAULT_CATEGORIES = [
  { id: 'groupe', emoji: '👥', label: 'Vie du groupe' },
  { id: 'defis', emoji: '💪', label: 'Défis perso' },
  { id: 'jeux', emoji: '🎲', label: 'Jeux entre amis' },
  { id: 'sport', emoji: '⚽', label: 'Sport' },
  { id: 'jeuxvideo', emoji: '🎮', label: 'Jeux vidéo et e-sport' },
  { id: 'tele', emoji: '📺', label: 'Télé et télé-réalité' },
  { id: 'cine', emoji: '🎬', label: 'Ciné et séries' },
  { id: 'musique', emoji: '🎤', label: 'Musique et cérémonies' },
  { id: 'actu', emoji: '🗳️', label: 'Actu et politique' },
  { id: 'eco', emoji: '💶', label: 'Éco et crypto' },
  { id: 'meteo', emoji: '🌦️', label: 'Météo' },
  { id: 'insolite', emoji: '🤪', label: 'Insolite' },
].map((c) => ({ ...c, hidden: false }));

/** Types des paris maison : Oui / Non et choix multiples, activables un par un (aucun : pas de paris maison). */
export const BET_KINDS = ['yesno', 'multi'];
export const DEFAULT_KINDS = Object.freeze({ yesno: true, multi: true });

/**
 * Réglages d'un groupe qu'on vient de créer : rien n'est activé (ni type, ni catégorie de paris maison, ni compétition),
 * l'admin choisit dans « Réglages des paris ». Les groupes d'avant (réglages absents) gardent les valeurs par défaut.
 */
export const newGroupSettings = () => ({
  kinds: Object.fromEntries(BET_KINDS.map((k) => [k, false])),
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, hidden: true })),
  sources: {},
});

export const DEFAULT_SETTINGS = Object.freeze({
  basePoints: 100,
  oddsCap: null, // null : pas de plafond
  arbiterBonus: 20,
  validationHours: 24,
  voteHours: 48,
  comments: true, // commentaires sur les paris (désactivés : ni commentaire, ni affichage)
});

/**
 * kinds et categories[].hidden ne règlent que les paris maison (bouton « Nouveau pari ») : un type ou une catégorie
 * désactivé disparaît du formulaire, ses paris en cours continuent ; aucun type ou aucune catégorie : pas de bouton.
 * sources : { [id]: { competitions, params } } ; une source est active dès qu'une compétition est choisie, que sa
 * catégorie accepte ou non les paris maison.
 */
export function readSettings(json) {
  let stored = {};
  try { stored = JSON.parse(json || '{}'); } catch { /* réglages illisibles : on repart des valeurs par défaut */ }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    categories: Array.isArray(stored.categories) && stored.categories.length ? stored.categories : DEFAULT_CATEGORIES,
    kinds: { ...DEFAULT_KINDS, ...stored.kinds },
    sources: stored.sources && typeof stored.sources === 'object' ? stored.sources : {},
  };
}
