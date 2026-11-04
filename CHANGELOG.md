# Journal des modifications

Les évolutions notables de PariTenu, de la plus récente à la plus ancienne. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et les numéros de version le
[versionnage sémantique](https://semver.org/lang/fr/) : correctif (1.0.**1**), nouveauté compatible (1.**1**.0),
changement qui demande une action à l'installation (**2**.0.0).

La version fait foi dans `package.json` ; elle est recopiée dans `package-lock.json`, `public/manifest.webmanifest` et
ce fichier, et affichée en pied de page de l'app. Pas de tag Git ni de « release » GitHub : ce journal est la référence.
Pour publier une version, voir [Publier une version](README.md#publier-une-version).

## [Non publié]

## [1.0.1] - 2026-11-04

### Ajouté

- Le crédit du pied de page (« PariTenu v… ») renvoie au dépôt GitHub du projet ; adresse du dépôt dans `package.json`.
- **Réinitialiser le site** (`/admin/configuration/reset`) : repart de zéro en effaçant tous les comptes, groupes,
  paris, pronostics, points, classements, l'historique des joueurs, les coupons et le journal de l'admin. Seuls
  restent la configuration (nom, adresse, textes, icône, thème, sources coupées) et le mot de passe de l'admin. On
  retape « réinitialiser » ; une copie de la base est faite juste avant dans `backups/`.

## [1.0.0] - 2026-11-04

Première version publique.

### Ajouté

- **Groupes sans inscription** : un lien, un pseudo et un PIN ; un même compte vaut dans tous ses groupes. Créer un
  groupe demande un coupon à usage unique, généré par l'admin du site.
- **Paris maison** Oui/Non et à choix multiples (2 à 8 options), catégories, arbitre, précisions datées ; pronostic en
  deux touches.
- **Cotes du groupe** : plus on a raison seul contre le groupe, plus ça rapporte. Verdict, délai de validation,
  contestation et vote, corrections par un admin avec écritures inverses.
- **Paris automatiques** sur des sources gratuites : football, rugby, football américain, basket, hockey, baseball,
  tennis, MMA, F1, MotoGP, padel (clé Padel API), météo, cryptos, actualité. Les paris s'ouvrent seuls pour les
  compétitions activées, les résultats et les scores en direct arrivent seuls ; les paris sportifs rapportent selon la
  cote des bookmakers.
- **Classements et saisons** : un classement par compétition ou par catégorie, sur les vraies saisons ; un champion en
  fin de saison, historique consultable.
- **Profils et activité** : statistiques, séries, badges, fil d'activité, commentaires et réactions.
- **Admin du site** (`/admin`) : comptes, groupes, coupons, sources, journal, recherche ; page Configuration (nom de
  l'installation, adresse publique, textes de l'accueil, hébergeur, icône, six thèmes).
- **Application installable** (PWA) sur téléphone, tablette et PC, mode sombre automatique, aide intégrée (`/help`).
- **Exploitation** : base SQLite intégrée à Node, migrations automatiques au démarrage ; `npm run admin` (mot de passe
  de l'admin du site), `npm run backup` (sauvegarde à chaud), `npm run demo` (groupe de démonstration) ; `app.cjs` pour
  les hébergeurs qui démarrent l'app avec Phusion Passenger.
- **Sécurité** : PIN hachés en scrypt, essais limités, CSP stricte, cookies `HttpOnly` et `SameSite`, contrôle
  d'origine, seul l'accueil est indexable par les moteurs de recherche.
- Version affichée en pied de page (accueil, aide, page « Moi », admin du site).
- Fichier `.env.example`, licence MIT, ce journal des modifications.
- Tests : `node:test` sur l'API réelle (sources de données simulées) et parcours de bout en bout dans Microsoft Edge.
