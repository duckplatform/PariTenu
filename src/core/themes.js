// Habillages de l'appli, choisis par l'admin du site pour tout le monde (instance_settings, clé « theme »).
// « stade » est l'habillage d'origine (public/css/app.css seule) ; chaque autre thème ajoute public/css/themes/<id>.css,
// servi à l'adresse /theme.css (polices hébergées par l'app, dans public/fonts/<id>/).
// Styles, palettes et polices viennent de la base du skill ui-ux-pro-max.

export const DEFAULT_THEME = 'stade';

/** swatches : fond, carte, texte, couleur d'action, accent (aperçu dans l'admin). scheme : clair, sombre ou selon l'appareil. */
export const THEMES = [
  {
    id: 'stade', name: 'Stade', scheme: 'auto',
    tagline: 'L’habillage d’origine : bandeau de tableau d’affichage, vert pelouse et jaune fluo. Clair ou sombre selon le téléphone.',
    style: 'Habillage d’origine', fonts: 'Polices du système',
    swatches: ['#eef1f5', '#ffffff', '#0b1426', '#00a651', '#c8f31d'],
  },
  {
    id: 'tribune', name: 'Tribune', scheme: 'light',
    tagline: 'Le programme de match : blocs francs, rouge club et or du trophée.',
    style: 'Vibrant & Block-based', fonts: 'Bebas Neue / Source Sans 3',
    swatches: ['#fef2f2', '#ffffff', '#2b1111', '#dc2626', '#fbbf24'],
  },
  {
    id: 'nocturne', name: 'Nocturne', scheme: 'dark',
    tagline: 'Match en nocturne : noir profond, chiffres de tableau d’affichage, vert « ça passe ».',
    style: 'Dark Mode (OLED)', fonts: 'Barlow Condensed / Barlow',
    swatches: ['#050506', '#111114', '#f4f4f5', '#22c55e', '#f59e0b'],
  },
  {
    id: 'recre', name: 'Récré', scheme: 'light',
    tagline: 'Entre potes, sans prise de tête : traits noirs, ombres franches et couleurs pop.',
    style: 'Neubrutalism', fonts: 'Space Grotesk / DM Sans',
    swatches: ['#fff4d6', '#ffffff', '#111111', '#ff6b6b', '#ffdb58'],
  },
  {
    id: 'arene', name: 'Arène', scheme: 'dark',
    tagline: 'Soirée e-sport : verre dépoli sur fond néon, typo de jeu vidéo, or du classement.',
    style: 'Glassmorphism', fonts: 'Russo One / Chakra Petch',
    swatches: ['#0f0f23', '#23234a', '#e2e8f0', '#7c3aed', '#f59e0b'],
  },
  {
    id: 'vestiaire', name: 'Vestiaire', scheme: 'light',
    tagline: 'Sobre et lisible : noir et blanc, un seul vert pour ce qui rapporte.',
    style: 'Minimalism & Swiss Style', fonts: 'Outfit / Work Sans',
    swatches: ['#ffffff', '#f5f5f4', '#0a0a0a', '#0a0a0a', '#16a34a'],
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const themeOf = (id) => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME);
