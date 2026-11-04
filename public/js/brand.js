import { h } from './dom.js';

// L'identité de l'installation : nom, adresse publique, textes de l'accueil, hébergeur et icône. Réglée dans l'admin du
// site (page Configuration) et posée par le serveur dans la balise <meta name="instance"> de la page (src/app.js :
// renderShell). Valeurs de PariTenu par défaut.
const DEFAULTS = {
  name: 'Pari tenu !',
  shortName: 'Pari tenu',
  publicUrl: '',
  tagline: 'Pronostique. Chambre tes potes. Sans miser un centime.',
  intro: 'Le jeu de pronostics entre amis : foot, rugby, NBA, F1, tennis… et tous vos paris maison. Les bons pronos rapportent des points, le meilleur de la saison est sacré champion.',
  footerNote: '',
  hostName: '',
  hostUrl: '',
  icon: '/icons/icon.svg',
  renamed: false,
  version: '', // la version du logiciel (package.json), posée par le serveur
};

function read() {
  try {
    return { ...DEFAULTS, ...JSON.parse(document.querySelector('meta[name="instance"]')?.content || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Modifiable en place : la page Configuration de l'admin y recopie ce qu'elle vient d'enregistrer. */
export const brand = read();

// Le dépôt du logiciel libre : vide tant qu'il n'est pas publié (le crédit s'affiche alors sans lien).
export const PROJECT_URL = '';

/** Une adresse à partager (groupe, coupon, pari) : sur l'adresse publique si elle est réglée, sinon sur celle de la page. */
export const appUrl = (path) => `${brand.publicUrl || location.origin}${path}`;

/** Le logo de la marque, pour les en-têtes. */
export const brandLogo = (size) => h('img', { src: brand.icon, alt: '', width: size, height: size });

/**
 * L'accroche en titre : sa dernière phrase en valeur (« Pronostique. Chambre tes potes. *Sans miser un centime.* »).
 * Une seule phrase : tout en valeur.
 */
export function taglineParts(text = brand.tagline) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  if (sentences.length < 2) return [h('em', text)];
  return [sentences.slice(0, -1).join(''), h('em', sentences.at(-1).trim())];
}

/** « PariTenu v1.2.0 » : le logiciel et sa version (sans version connue, son nom seul). */
export const softwareLabel = () => (brand.version ? `PariTenu v${brand.version}` : 'PariTenu');

/**
 * Le crédit en pied de page : le logiciel et sa version (« PariTenu v1.2.0, logiciel libre » ; une installation renommée
 * dit « Propulsé par … »), puis l'hébergeur s'il est renseigné.
 */
export function credits() {
  const parts = [];
  if (brand.renamed || brand.version) {
    const software = PROJECT_URL ? h('a', { href: PROJECT_URL, target: '_blank', rel: 'noopener' }, softwareLabel()) : h('b', softwareLabel());
    parts.push(h('span', brand.renamed ? 'Propulsé par ' : '', software, ', logiciel libre'));
  }
  if (brand.hostName) {
    parts.push(h('span', 'Hébergé par ', brand.hostUrl ? h('a', { href: brand.hostUrl, target: '_blank', rel: 'noopener' }, brand.hostName) : h('b', brand.hostName)));
  }
  return parts.length ? h('p.credits', parts.flatMap((p, i) => (i ? [' · ', p] : [p]))) : null;
}
