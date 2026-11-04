import { brand, credits } from '../brand.js';
import { h } from '../dom.js';
import { ctx } from '../state.js';
import { lastGroup } from '../store.js';

// Aide et règles du jeu : publique (/help[/<section>]), pour les nouveaux comme pour les habitués.
// Les noms des sections avant le 2026-11-03 (/aide/<section>), pour les liens déjà partagés.
const OLD_SECTIONS = { commencer: 'start', parier: 'betting', groupes: 'groups', classements: 'rankings', arbitre: 'referee', installer: 'install' };

const SECTIONS = [
  ['start', '🚀 Commencer', [
    ['p', `${brand.name} est un jeu de pronostics entre amis : on parie sur les matchs, les courses, la météo ou la vie du groupe. Parier est gratuit, on ne mise jamais d’argent et on ne perd jamais de points : un bon pronostic en rapporte, c’est tout.`],
    ['ul', [
      'Quelqu’un crée le groupe et partage son lien (WhatsApp, SMS…) : c’est l’adresse du groupe.',
      'Chacun ouvre le lien, choisit un pseudo, un avatar et un code PIN à 4 chiffres : c’est son compte. Pas d’e-mail.',
      'Ton compte vaut dans tous tes groupes : un seul pseudo (à toi sur toute l’app), un seul avatar, un seul PIN. Change-les dans « Moi » et c’est changé partout.',
      'Déjà connecté, tu entres dans un nouveau groupe d’un geste en ouvrant son lien, sans rien retaper.',
      'Sur un autre téléphone ou sur ton PC : ouvre le lien d’un de tes groupes, « J’ai déjà un compte », ton pseudo et ton PIN, et tu retrouves tous tes groupes. On ne se connecte que par le lien d’un groupe, jamais depuis l’accueil du site : sans lui, personne ne peut essayer de deviner ton PIN. Si le lien a fuité, un admin du groupe le change (Réglages du groupe → Changer le lien) : l’ancien ne mène plus à rien.',
      'PIN oublié ? Demande à un admin de ton groupe de le réinitialiser, puis rouvre le lien du groupe pour en choisir un nouveau. Si tu es dans plusieurs groupes, il faut un admin de chacun : un seul ne peut pas prendre ton compte.',
    ]],
  ]],
  ['betting', '🎯 Parier', [
    ['p', 'La liste des paris a 4 sections, pour voir d’un coup d’œil ce qui t’attend : « À parier » (tu n’as pas encore parié), « Pariés » (ton choix est fait, modifiable jusqu’à la clôture), « Clos » (plus rien ne change : en direct, résultat attendu, vote) et « Terminés ». Une section vide n’apparaît pas.'],
    ['p', 'Dans la liste des paris, touche une option : c’est parié, d’un geste. Sur la fiche d’un pari, touche une option puis « Je parie ! ». Tu peux changer d’avis jusqu’à la clôture (le coup d’envoi pour un match) ; ensuite, pari tenu.'],
    ['p', 'Tout le monde voit qui a parié quoi : c’est ce qui fait le sel des discussions.'],
    ['p', 'Les paris de sport se lisent d’un coup d’œil : les écussons des équipes, les photos des pilotes et des joueurs, le score en direct pendant le match puis le score final (ou le podium). Pendant le match, l’app te dit si ton prono passe. Sur la fiche d’un match, « Le match » raconte le reste : buteurs, passeurs et cartons, essais, touchdowns, pénalités au hockey, scores par quart-temps, statistiques, meilleurs joueurs, fin d’un combat, ou le classement complet d’une course.'],
    ['p', 'L’onglet « 📺 Direct » rassemble les matchs du jour (hier, aujourd’hui, demain) avec leurs scores et ton bilan de la journée : ton choix est entouré sur le match (« Ton choix », en vert s’il passe, en rouge sinon). Il se met à jour tout seul.'],
    ['p', 'Pour lancer ton propre pari (« Julien arrive en retard ? »), touche « ＋ Nouveau pari ». Ce bouton n’apparaît que si le groupe accepte les paris maison : un admin choisit dans quelles catégories, à part des compétitions.'],
  ]],
  ['points', '📈 Les points', [
    ['h3', 'Paris sportifs : la cote des bookmakers'],
    ['p', 'Chaque option a une cote fixe, affichée sous son nom avant de parier, comme chez les bookmakers (« 2,50 ») :'],
    ['formula', 'Bon pronostic = 100 × la cote'],
    ['ul', [
      'Foot, NFL, NBA, NHL, MLB… : la cote des bookmakers (DraftKings). Un favori à 1,40 rapporte 140 pts, un outsider à 4,50 en rapporte 450.',
      'Quand aucune cote n’est connue (rugby, tennis, MMA, F1, moto…) : barème fixe, 200 pts le bon pronostic (la cote 2,00 s’affiche alors en grisé).',
      'Ça ne dépend pas des autres : même seul à parier, ou si tout le monde a fait le même choix, un bon pronostic rapporte sa cote. Jamais de cote à 1.',
    ]],
    ['h3', 'Paris entre amis'],
    ['p', 'La cote vient du groupe : participants ÷ pronostics sur l’option. Plus tu as raison seul, plus ça rapporte.'],
    ['formula', 'Bon pronostic = 100 × (participants ÷ ceux qui ont choisi cette option)'],
    ['ul', [
      'À 4 participants, seul contre 3 : cote 4,00, 400 pts. À 2 contre 2 : cote 2,00, 200 pts.',
      'Moins de 2 participants, ou tout le monde du même avis : pari annulé, personne ne marque.',
      'L’arbitre (qui tranche) ne parie pas ; il gagne une prime de 20 pts si personne ne conteste son verdict.',
    ]],
    ['p', 'Un admin peut régler la base (100 pts) et un plafond de cote dans les réglages du groupe (l’engrenage ⚙️ à côté de son nom), y couper les commentaires sur les paris, ou supprimer le groupe (en retapant son nom : tout disparaît pour tout le monde, les comptes restent).'],
  ]],
  ['competitions', '🏟️ Compétitions et paris automatiques', [
    ['p', 'Un admin active des compétitions dans les réglages du groupe (l’engrenage ⚙️ à côté de son nom) → Réglages des paris : Ligue 1, Ligue des champions, Top 14, NFL, NBA, ATP, padel, UFC, F1, MotoGP… (rien n’est activé d’office). Tous leurs paris s’ouvrent alors tout seuls : un pari par match ou par course, sur son vainqueur, titré « sport · compétition · rencontre ».'],
    ['p', 'Chacun choisit ensuite les compétitions auxquelles il participe, l’admin qui les active compris : une nouvelle compétition s’annonce en haut de la page du groupe (« Je participe » ou « Non merci ») et dans l’Activité ; tu peux changer d’avis dans Moi → Mes compétitions. Les paris des compétitions que tu ne suis pas ne s’affichent pas chez toi ; en disant « Je participe », tu retrouves tes pronostics déjà faits sur les mêmes matchs dans tes autres groupes.'],
    ['p', 'Le résultat officiel arrive tout seul dès la fin de l’événement, et les points avec. Il ne se conteste pas : c’est le score officiel (si la source se trompe, un admin du groupe corrige le résultat). Match reporté ou annulé : pari annulé.'],
  ]],
  ['groups', '👥 Plusieurs groupes', [
    ['p', `Tu peux être dans plusieurs groupes (les potes, le foot du jeudi, le bureau…) : chacun s’ouvre par son lien. Pour en créer un, il faut un coupon : la personne qui gère ${brand.name} t’envoie son lien.`],
    ['p', 'Un pronostic sur un match compte dans tous tes groupes où ce même match est ouvert et dont tu suis la compétition : tu paries une fois, c’est pris partout.'],
    ['p', 'Les classements, eux, restent propres à chaque groupe.'],
  ]],
  ['rankings', '🏆 Classements et saisons', [
    ['p', 'Pas de classement général : un classement par compétition (Ligue 1, NFL…) et un par catégorie pour les paris entre amis, la météo, les cryptos…'],
    ['ul', [
      'Chaque classement suit la vraie saison : la saison officielle de la compétition (la Ligue 1 jusqu’en juin, la NFL jusqu’après le Super Bowl…), et printemps, été, automne, hiver pour les catégories.',
      'À la fin de la saison, quand ses derniers paris sont réglés, le meilleur score est sacré champion 🏆 et tout repart de zéro.',
      'Les saisons passées restent consultables : leur champion, leur classement final et tous leurs paris.',
    ]],
  ]],
  ['referee', '⚖️ Paris entre amis : trancher, contester', [
    ['ul', [
      'Le créateur choisit l’arbitre (lui-même par défaut). Après la clôture, l’arbitre désigne l’option gagnante.',
      'Pendant 24 h, un participant peut contester : tout le groupe vote pendant 48 h (majorité ; égalité = pari annulé).',
      'Arbitre absent depuis 7 jours : un admin sans pronostic peut trancher. Jamais tranché au bout de 30 jours : pari annulé.',
      'Un admin peut corriger un résultat après coup : les points sont repris et redistribués.',
    ]],
  ]],
  ['badges', '🎖️ Badges', [
    ['p', '🎯 Premier pari · 🦄 Seul contre tous (le seul à avoir raison, à 4 ou plus) · 🔥 Série de 5 · 🎤 Ambianceur (10 paris créés) · ⚖️ Juge de paix (10 arbitrages sans contestation) · 🏆 Champion d’une saison · 🐌 Lanterne rouge.'],
  ]],
  ['install', '📲 Installer l’app', [
    ['ul', [
      'Android (Chrome) : menu ⋮ → « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
      'iPhone (Safari) : bouton Partager → « Sur l’écran d’accueil ».',
      'PC : l’icône d’installation dans la barre d’adresse (Edge, Chrome), ou simplement un favori.',
    ]],
  ]],
];

function block([kind, content]) {
  switch (kind) {
    case 'h3': return h('h3', content);
    case 'ul': return h('ul', content.map((li) => h('li', li)));
    case 'formula': return h('p.formula', content);
    default: return h('p', content);
  }
}

export async function helpView(route) {
  const back = ctx.gid ?? lastGroup();
  const sections = SECTIONS.map(([id, title, blocks]) => h('section.card', { id: `help-${id}` }, h('h2', title), blocks.map(block)));
  const node = h('main.help',
    h('header.topbar',
      h('a.icon-btn', { href: back ? `/${back}` : '/', 'aria-label': 'Retour' }, '←'),
      h('h1', '❓ Aide et règles')),
    h('nav.help-toc', { 'aria-label': 'Sommaire' }, SECTIONS.map(([id, title]) => h('button.chip', {
      type: 'button', onclick: () => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth' }),
    }, title))),
    sections,
    h('p.muted.center', 'Une question ? Demande dans ton groupe : c’est fait pour ça.'),
    h('div.help-credits.muted.center', credits()));
  const section = route?.arg ? OLD_SECTIONS[route.arg] ?? route.arg : null;
  if (section) queueMicrotask(() => document.getElementById(`help-${section}`)?.scrollIntoView());
  return { node };
}
