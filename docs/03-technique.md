# Technique

## Architecture

```
src/
  server.js            démarrage, adresses affichées, arrêt propre
  app.js               Express : helmet (CSP stricte), /api, fichiers statiques, erreurs, balayage des échéances
  config.js            variables d'environnement
  db.js                SQLite (node:sqlite), migrations versionnées, tx() réentrant
  core/scoring.js      barème pur : cotes, règlement, dépouillement des votes
  core/settings.js     réglages par défaut : catégories, types de paris, sources
  core/seasons.js      saisons : équinoxes et solstices (Meeus), saison officielle d'une source, saison à date fixe
  core/themes.js       les 6 habillages (Stade d'origine + 5 thèmes) : nom, style, polices, couleurs d'aperçu
  services/follows.js  compétitions suivies par chaque membre (feedOf : le « fil » d'un pari de source)
  services/accounts.js le compte d'un joueur : pseudo, avatar, PIN, sessions, connexion, réinitialisation du PIN
  services/groups.js   groupes, membres (le compte dans chaque groupe), invitations, administration (du groupe et du site)
  services/coupons.js  coupons de création de groupe : générés, vérifiés, consommés dans la transaction qui crée le groupe
  services/admin.js    admin du site : mot de passe, sessions, lectures (comptes, groupes, tableau de bord), actions, journal
  services/bets.js     cycle de vie d'un pari, permissions, échéances (sweep), paris ouverts automatiquement (createAuto)
  services/seasons.js  classements et saisons : rattachement des paris, classement, fin de saison, champions, historique
  services/stats.js    profil, badges, fil d'activité, export
  services/sources.js  ouverture automatique (autoOpen toutes les 30 min, prune), résultats (checkDue toutes les 5 min),
                       direct (refreshLive chaque minute)
  services/live.js     LiveStore : équipes ou pilotes (media) et score (live) de chaque pari de source, table source_events
  services/media.js    relais des images des sources (/media/…) : liste blanche, réduction, cache mémoire et disque
  lib/png.js           PNG sans dépendance : lire, recadrer, réduire, écrire (photos MotoGP de 4 Mo → 35 Ko)
  sources/*.js         une source par fichier : espn.js (moteur des sports collectifs d'ESPN) → foot, sports.js
                       (football américain, rugby, basket, hockey, baseball, football australien) ; tennis, mma (ESPN) ;
                       padel (Padel API, clé PT_PADEL_TOKEN : sans clé, la source n'est pas proposée — needsKey) ;
                       f1 (Jolpica), moto (MotoGP.com), crypto (Coinbase), meteo (Open-Meteo), manifold ;
                       facts.js : faits de match lus dans les tableaux d'ESPN (buts, cartons, essais, périodes,
                       statistiques, meneurs, situation de jeu, fin d'un combat) ;
                       http.js : appels avec délai, cache, erreurs lisibles
  routes/api.js        API JSON (validation zod, messages en français) ; routes/admin.js : /api/admin (session admin) ;
                       routes/inputs.js : schémas et cookies communs
public/
  index.html, manifest.webmanifest, sw.js, icons/   coquille installable (titre, description, icônes et manifeste
                       réécrits au nom de l'installation par le serveur : voir « Configuration de l'installation »)
  css/app.css          tout le style, réglé par des variables (couleurs, polices, bandeaux, cartes) ; Stade par défaut
  css/themes/<id>.css  un thème = ses polices (@font-face) + ses variables + quelques détails ; servi par /theme.css
  fonts/<id>/          polices des thèmes, hébergées par l'app (woff2 « latin » de Google Fonts, licence SIL OFL)
  img/themes/<id>.jpg  aperçus des thèmes (page Configuration) (scripts/theme-previews.mjs, d'après les captures des tests e2e)
  js/icons.js          icônes au trait (Lucide) de la navigation, des titres de section et des états des paris
  js/main.js           routeur (adresses en anglais : /, /groups, /groups/new[/<coupon>], /help, /invite/<jeton>,
                       /<groupe>/…, liens internes sans rechargement, anciennes adresses converties), mise en page,
                       rafraîchissement au retour dans l'app
  js/views/*.js        un écran par fichier (welcome : accueil du site, mes groupes, créer un groupe ; help : aide ; follow : mes compétitions ;
                       live : page Direct ; match.js : écussons, tableau de score, podium ; facts.js : bloc « Le match »
                       de la fiche et ligne courte de la page Direct)
  js/avatars.js        avatars sportifs : emoji, drapeaux SVG (f:fr), maillots (j:couleur:couleur:numéro), sélecteur
  js/dom.js            h() : construit le DOM sans jamais utiliser innerHTML
  js/brand.js          l'identité de l'installation (nom, adresse publique, textes, icône), lue dans <meta name="instance"> ;
                       appUrl() pour les liens partagés, credits() pour le pied de page
  admin.html, css/admin.css, js/admin/*.js   admin du site (/admin, /admin/users, /admin/groups…, sans #) : vue d’ensemble
                       (« à traiter »), comptes, groupes, coupons, sources, configuration, journal ; kit.js (en-têtes,
                       tableaux triables qui deviennent des listes sur téléphone, menus « ⋯ », filtres), search.js (Ctrl K)
scripts/admin.mjs      npm run admin : mot de passe de l'admin du site (saisi deux fois, rien d'affiché)
scripts/backup.mjs     npm run backup [-- étiquette] : copie cohérente de la base (VACUUM INTO) dans <dossier de la base>/backups/
app.cjs                démarrage sous Phusion Passenger (cPanel) : charge src/server.js ; voir docs/05-installation-cpanel.md
.cpanel.yml            déploiement par le Git de cPanel : copie dans ~/paritenu, npm install sans outils de test, redémarrage
scripts/demo.mjs       groupe de démonstration ; scripts/icons.mjs : icônes PNG depuis le SVG
scripts/theme-previews.mjs  aperçus des thèmes pour l'admin (après npm run test:e2e)
test/                  node:test (API réelle sur port libre) ; test/e2e/run.mjs : Edge headless
test/fake-upstream.js  faux fournisseurs de données (mêmes réponses que les vraies API) : aucun test n'appelle Internet
test/fixtures/sources  vraies réponses des API, capturées le 2026-10-30 et allégées
```

### Thèmes

L'admin du site choisit l'habillage de toute l'appli dans `/admin/configuration` (section Apparence) (`PUT /api/admin/theme`, journal
`theme_changed`) ; le choix est gardé dans `instance_settings` (clé `theme`, sans migration) et en mémoire dans
`AdminService`. Chaque page charge `/css/app.css` puis `/theme.css`, que le serveur remplit avec
`public/css/themes/<id>.css` (vide pour Stade) : pas de JavaScript, pas de flash de l'ancien thème. `/theme.css` part
sans date ni ETag (une même adresse, plusieurs fichiers : un 304 garderait l'ancien thème). Les polices sont servies par
l'app (CSP `font-src 'self'`, rien chez Google). Stade suit le mode clair ou sombre du téléphone ; Tribune, Récré et
Vestiaire sont clairs, Nocturne et Arène sombres. Maquettes et choix des styles (skill ui-ux-pro-max) : `docs/maquettes/`.

L'admin du site a son propre habillage (`css/admin.css`, chargé après `app.css` dont il remplace les variables) :
« Sobre » en mode clair (Inter) et « Cockpit » en mode sombre (Fira Sans, chiffres et codes en Fira Code), polices dans
`public/fonts/admin/`. Maquettes : `docs/maquettes/admin/`.

Variables principales d'`app.css` : `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--brand` (actions),
`--accent`, `--night` (blocs foncés), `--display` et `--body-font` (polices), `--display-style` et `--display-case`
(titres en italique et en capitales ou non), `--top-*`, `--nav-*`, `--side-*` (barre du haut, barre du bas, menu de
gauche), `--pick-*` (option choisie), `--gain` (la cote « 2,50 » sous chaque option), `--cta-*` (bouton « Parier »), `--card-line`, `--glass`.

### Configuration de l'installation

PariTenu est un logiciel libre : chaque installation se donne son nom et son allure dans `/admin/configuration`, sans
toucher au code (`services/branding.js`). Réglages gardés dans `instance_settings` (clé `branding`, JSON, sans
migration), en mémoire dans `BrandingService` :

* **Identité** : `name` (2 à 40 caractères ; onglet, en-têtes, messages partagés, erreurs du serveur), `shortName`
  (14 au plus, sous l'icône du téléphone), `publicUrl` (origine `https://…` sans chemin, ou vide).
* **Page d'accueil** : `tagline` (titre, dernière phrase en valeur), `intro` (paragraphe et meta description),
  `footerNote` (ligne de plus en pied de page). **Hébergement** : `hostName`, `hostUrl` (« Hébergé par … »).
* **Icône** : un PNG (2 Mo au plus, 192 px de côté au moins) recadré au carré par le centre et décliné en 32, 180, 192
  et 512 px, plus une version « maskable » 512 (l'icône à 80 % sur la couleur de son coin), dans `data/branding/`
  (en mémoire pour une base en mémoire). Servie par `/brand/<fichier>` (liste blanche) avec sa version (`?v=`) dans
  l'adresse : cache d'un an, `immutable`.

Le serveur réécrit `index.html` et `admin.html` à chaque envoi (`renderShell`, texte échappé, remplacements par
fonction) : `<title>`, meta description, `apple-mobile-web-app-title`, liens d'icône, et une balise
`<meta name="instance" content="{…}">` que lit `public/js/brand.js` (pas de script en ligne : la CSP ne change pas).
`/manifest.webmanifest` est servi de même (nom, nom court, description, icônes). Valeurs par défaut : celles de PariTenu
(« Pari tenu ! »). Une fois renommée, l'accueil et l'aide disent « Propulsé par PariTenu, logiciel libre »
(`PROJECT_URL` dans `brand.js` : le lien du dépôt, vide tant qu'il n'est pas publié).

L'adresse publique ne sert qu'aux **liens** (invitation, coupon, partage d'un pari : `appUrl()`) : rien n'est redirigé,
les autres adresses du site continuent de marcher. Derrière un proxy (hébergeur), ses requêtes passent le contrôle
d'origine et ses cookies restent `Secure` même si le proxy parle en http au serveur.

## Règles du jeu dans le code

* **Barème** (`core/scoring.js`) : bon pronostic = `round(basePoints × min(cote, plafond))`.
  `bets.scoring` : `group` (pari entre amis : cote = participants ÷ pronostics sur l'option ; moins de 2 participants
  ou unanimité : aucun point ; prime de l'arbitre si personne n'a contesté et au moins 3 participants), `bookmaker`
  (pari sportif : `bet_options.odds` = cote décimale DraftKings lue chez ESPN, `decimalOdds` convertit la cote
  américaine) ou `fixed` (pari sportif sans cote : `FIXED_ODDS` = 2). Cote fixe : jamais d'annulation `too_few` /
  `unanimous`, chaque bon pronostic marque, pas de prime ; `setBookmakerOdds` remplace le barème fixe tant que
  personne n'a parié.
* **Compte d'un joueur** (v8 : `players` avec pseudo unique, PIN et blocages ; `player_sessions`, cookie
  `pt_session` ; `pin_resets`) : `AccountService`. Un membre est le compte dans un groupe (`members.player_id`, pseudo
  et avatar recopiés). Comptes d'avant : une session de groupe (`pt_<groupe>`) devient une session de compte à la
  première visite ; un joueur à plusieurs PIN (`members.pin_hash`) se connecte avec n'importe lequel, qui devient celui
  du compte. `player_tokens` et `pt_player` ne servent plus (effacés à la déconnexion). `BetService`
  reprend un pronostic sur les pairs du pari (même `source_ref.key`) dans les autres groupes du joueur (`#sharePick`),
  et à l'ouverture d'un pari ceux déjà faits ailleurs (`#inheritPicks`), si la compétition y est suivie.
* **Compétitions suivies** (`follows`) : `SourceService.offered` liste ce que le groupe propose ; `BetService.list`
  ne montre un pari de source que si son fil est suivi (`in`) ou si j'y ai parié ; parier fait suivre le fil.
* **Cycle de vie** (`services/bets.js`) : `open → closed → validating → settled`, ou `validating → voting →
  settled | cancelled`, ou `open | closed → cancelled`. Les échéances (clôture, fin de validation, fin de vote,
  abandon à 30 jours) sont appliquées par `sweep()` avant chaque requête du groupe et toutes les minutes ; les
  écritures sont datées de l'échéance elle-même, pas du passage du balayage.
* **Journal des points** (`points`) : on n'y modifie ni n'y supprime jamais rien. Chaque règlement a un numéro
  (`round`) ; une correction ajoute des écritures inverses (`reversal`) puis un nouveau règlement. Le score d'un membre
  est la somme de son journal (vérifié par la simulation de `test/invariants.test.js`).
* **Classements et saisons** (`seasons`, `bets.ranking`, `bets.season_id`) : un classement par compétition
  (`foot:fra.1`, `usfoot:nfl`…) pour un pari de source sportive, sinon par catégorie (`cat:groupe`). La saison d'un
  pari de compétition vient de la source (ESPN : `leagues[0].season`, contrôlée par `officialSeason` avec une date
  fixe de secours ; F1 et MotoGP : du premier au lendemain du dernier Grand Prix) ; celle d'un pari de catégorie est la
  saison de l'année qui contient son heure de référence (`max(clôture, résultat attendu)`). Score de saison = somme du
  journal des paris de la saison. `SeasonService.closeDue()` (chaque minute et à chaque requête) clôt une saison finie
  dont tous les paris sont terminés (ou 35 jours après sa fin) : classement figé dans `seasons.standings`, champions,
  événement `season_closed`. Les paris d'avant la V2 sont rangés au démarrage (`backfill`).
* **Paris ouverts automatiquement** (`bets.source`, `bets.source_ref`, `bet_options.source_key`) : ni créateur
  (`creator_id` NULL) ni arbitre ; options, type, catégorie et clôture (début de l'événement) imposés par la source,
  personne ne les modifie. En sport, un seul marché par match ou par course (le résultat) ; `source.offers(ref)` dit si
  un ancien marché est encore proposé. `SourceService.autoOpen()` ouvre, pour chaque compétition activée, les marchés pas encore
  ouverts (clé `source_ref.key`, même annulés) et résume l'ouverture dans le fil (`auto_opened`) ; `prune()` (après un réglage et au
  démarrage) retire ceux d'une compétition coupée ou d'un marché plus proposé tant qu'ils n'ont pas de pronostic ; à la clôture, un pari sans pronostic est supprimé. Une source rend `{ state: 'pending' | 'final' | 'void' }` ; `final` le règle aussitôt
  (`resolved_by` NULL, pas de prime ; pas de contestation : `contest` refuse un pari de source, l'admin du groupe a
  `correct`), `void` l'annule (`cancel_reason = 'source'`). Si la source se
  tait 24 h après l'heure prévue, un admin sans pronostic peut trancher. Sources coupées par l'admin du site
  (`instance_settings.disabled_sources`, migration v11) : `sources` (proposées) les exclut, `available` (clé
  configurée) les garde pour le direct et les résultats des paris déjà joués ; `setEnabled` les coupe puis appelle
  `prune` dans chaque groupe. `refreshLive()` demande le résultat (`check`)
  dès que le direct d'une rencontre passe à « post » avec son score final, sans attendre `expected_at`. Migration v10 :
  les paris de source encore en validation sont réglés au premier balayage, datés de leur résultat.
* **Visuels et direct** (2026-10-31) : chaque source sportive joint à ses marchés un `media`
  (`{ layout: 'versus' | 'field', competitors: [{ key, name, abbr, logo | img, flag, color, number, team }] }`, la clé
  d'un compétiteur = celle de son option : `home`/`away`, id d'un joueur ou d'un pilote), enregistré par `autoOpen`
  dans `source_events` (une ligne par `source_ref.key`, commune à tous les groupes). `source.live(refs, io)` (sports
  d'ESPN, tennis, MMA) relit les tableaux du jour d'ESPN (cache 30 s, une requête par compétition et par jour quel que
  soit le nombre de groupes) : `{ state: 'pre' | 'in' | 'post', clock, scores, sets, winner }`, chrono en français
  (`clockText`). `SourceService.refreshLive()` (chaque minute) ne relit que les rencontres commencées depuis moins de
  3 jours sans score final, chaque minute pendant le match puis tous les quarts d'heure (« Terminé » sans score n'est
  pas un score final tant que le pari attend son résultat : le padel donne les sets après coup). `result()` rend aussi le score
  final ou le podium (`live`), enregistré avec le résultat. `BetService.summary` expose `event` (images en
  `/media/…`) et la clé de chaque option. Images : `MediaService` n'accepte que a.espncdn.com, photos.motogp.com et
  media.formula1.com (https, chemins attendus, pas de redirection), réduit les PNG trop lourds (les photos MotoGP sont
  recadrées sur le visage) et les garde dans `data/media/` ; la CSP reste `img-src 'self'`. Le service worker laisse
  `/media` au cache du navigateur (une semaine).
* **Faits de match** (2026-11-01, lot 1) : `teamSource({ facts })` (soccer, rugby, nfl, basket, hockey, baseball, afl)
  ajoute au direct, depuis le même tableau du jour (aucune requête de plus), `events` (`[{ t, side, kind, who, note }]` :
  goal, miss, yellow, red, try, conv, pen, drop), `periods` (`{ head, home, away, extra }`), `stats`
  (`[{ label, home, away, pct }]`), `leaders` (`[{ label, side, who, value }]`) et, pendant le match, `situation`
  (NFL, MLB) : voir `src/sources/facts.js`. MMA : `finish` (`fightFinish` : méthode d'après les détails « Unofficial
  Winner … », le chrono tranche quand ESPN annonce aussi une décision) et `record` des combattants dans `media`.
  F1 et moto : `ranking` (`[{ pos, name, team, gap, grid, out }]`) et `fastest` dans le direct du résultat. Le résumé
  que lit `result()` n'a pas ces faits : `SourceService.check` garde ceux du tableau du jour (`#withFacts`) et relit le
  direct une dernière fois s'il datait d'avant la fin du match. Une rencontre lue finie est marquée `factsRead` (version
  des faits, `FACTS_READ` dans `src/services/sources.js` ; marque interne du direct, jamais envoyée à l'app) ; une
  rencontre finie sans cette marque ou avec une version plus ancienne (réglée avant d'être lue, finie avant la mise en
  ligne) est relue une fois par `refreshLive` (sources qui déclarent `facts`). Captures réelles allégées :
  `test/fixtures/sources/*-facts.json`, `jolpica-results-2026-18.json`, `motogp-classification-mal-motogp-rac.json`
  (test/facts.test.js).
* **Faits du résumé** (2026-11-01, lot 2 ; `FACTS_READ` = 2) : pour soccer, nfl et hockey (`SUMMARY_FACTS`), `live()`
  lit aussi `summary?event=` de chaque match commencé : `summaryFacts` en tire les passeurs (`keyEvents`, « Assisted
  by », posés sur les buts du tableau du jour : `assists`), les actions qui marquent du football américain
  (`scoringPlays`, texte traduit : td, fg, safety, d2p) ou les buts et pénalités du hockey (`plays` : puck avec
  `assists` et `note` pp, sh, en ; penalty, d'après `type.penaltyMinutes` ; pas les tirs au but). `summaryOf` (dans
  `teamSource`) garde le résultat dans `io.memo` (une Map de `SourceService`) : relu quand l'état, le score ou le nombre
  d'actions du tableau du jour change, sinon toutes les 5 minutes ; une erreur garde le dernier. `result()` applique
  aussi `summaryFacts` au résumé qu'il lit déjà. Captures : `espn-summary-{fra1-401876414,nfl-401873023,
  nhl-401892614,nhl-401892616,nhl-401892617,nhl-401892619}-facts.json`.
* **F1 : retrouver sa course** (2026-11-01) : `f1.result` reconnaît le Grand Prix du pari à sa page Wikipédia
  (`ref.url`), sinon à son jour (`ref.closesMax`). Pas de résultat, ou un autre GP sous ce numéro (une course annulée
  décale les suivantes) : il cherche la course dans le calendrier `/<saison>.json` ; absente, le pari est annulé tout
  de suite (« Course annulée ») ; repoussée ou renumérotée, il lit le résultat à son nouveau numéro. Migration v12 : le
  texte des paris de F1 déjà ouverts ne parle plus d'attendre 30 jours. Capture : `jolpica-2026.json`.
* **Page Activité** (2026-11-03) : `GET /api/groups/:id/activity` (`ActivityService`, src/services/activity.js) rend
  `{ highlights, items }`. Éléments : `result` (pari réglé : rencontre `event`, `winning`, `odds`, `gains`, `missed`,
  `prime`), `results` (3 résultats ou plus d'un même classement le même jour : `players` = bilan de chacun), `picks` (les
  pronostics d'une personne, même jour, moins de 3 h d'écart ; `changed` pour un changement d'avis), `opened` (ouvertures
  automatiques du jour, par classement), `comment`, `season`, `line` (le reste, raconté par `eventLine`). Cachés : votes,
  retouches, clôture automatique, résultat officiel (sa carte le dit). `highlights` (null si rien en 24 h) : `settled`,
  `gains`, `flair` (cote ≥ 2,5), `leaders` (`change` : il double quelqu'un), `champions`. `/feed` (événements bruts)
  reste pour la colonne de droite de l'accueil.
* **Liens des paris** (2026-11-03) : « Voir sur … » nomme le site du lien (`siteName`, `bet.source.site`). F1 : le lien
  (`ref.url`) est la page du Grand Prix chez ESPN, trouvée dans `racing/f1/scoreboard` (`leagues[0].calendar`, jour de
  la course entre `startDate` et `endDate`) ; la page Wikipédia de Jolpica est gardée dans `ref.page` pour reconnaître
  la course. `source.relink(ref, io)` (F1) corrige les paris déjà ouverts ; `SourceService.relink()` l'appelle après
  chaque ouverture automatique. Capture : `espn-f1-scoreboard-2026.json`. Padel : `url` du match (sinon du tournoi)
  donné par Padel API, page de Fantasy Padel Tour passée en français (`frenchPage` : « fr.fantasypadeltour.com »).
  Captures : `padelapi-tournaments.json`, `padelapi-tournament-748-matches-men.json`, `padelapi-match-14249.json`.
* **Joueur** : pseudo et avatar dans `players` (migration v6), recopiés dans `members` de tous ses groupes actifs
  (`#claimIdentity` à la création, à l'entrée et dans « Moi » : pseudo libre partout ou refus ; `#syncIdentity` quand
  un membre est rattaché à un joueur). Avatar maillot vérifié par le serveur (numéro à deux chiffres au plus).
* **Réglages** (`groups.settings`, JSON) : `kinds` (types des paris maison ; un groupe neuf n'a rien d'activé :
  `newGroupSettings()`), `categories[].hidden` (pas de paris maison
  dans cette catégorie ; toutes masquées : `BetService` refuse les paris maison et l'interface cache « Nouveau pari »),
  `sources[id] = { competitions, params }` (compétitions activées ; pour une source hors sport, `[id]` ou rien),
  indépendantes des catégories depuis la migration v5 (fonction `separateManualCategories` : une catégorie activée
  seulement pour ses compétitions, sans pari maison, perd ses paris maison ; une compétition choisie dans une catégorie
  coupée reste coupée). Une migration est du SQL ou `{ run(db) }` pour réécrire des données. Rien n'est activé d'office ; les réglages d'avant la V2 (`enabled`) sont ignorés. Un pari déjà lancé garde son type et
  sa catégorie même s'ils sont désactivés ensuite.
* **Permissions** : calculées côté serveur (`BetService.permissions`) et renvoyées dans `can` ; l'interface n'affiche
  que les boutons autorisés, le serveur revérifie tout.

## API

Toutes les réponses sont en JSON ; les erreurs ont la forme `{ error, code }` avec un message prêt à afficher.

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/instance` | Mon compte, sports et compétitions proposés (`catalog`), thème, identité de l'installation (`brand`) |
| GET · PATCH | `/api/account` | Mon compte et mes groupes · changer pseudo et avatar (partout) |
| POST | `/api/account/login` · `logout` · `pin` | Se connecter (pseudo, PIN ; `inviteToken` + `newPin` après une réinitialisation) · se déconnecter de l'appareil · changer de PIN |
| POST | `/api/groups` | Créer un groupe avec un `coupon` (connecté : nom et emoji ; sinon aussi pseudo, avatar, PIN : crée le compte) |
| GET | `/api/invite/:token` | Infos du lien : groupe, membres, mon compte, déjà dedans ? |
| POST | `/api/invite/:token/join` | Rejoindre (connecté : d'un geste ; sinon pseudo, avatar, PIN : crée le compte) |
| GET · PATCH | `/api/groups/:g` | Groupe, réglages, moi, membres · renommer (admin) |
| PATCH | `/api/groups/:g/settings` | Points, plafond, prime, délais, types de paris, catégories, sources (admin) |
| GET | `/api/groups/:g/sources` | Sources du groupe : compétitions, compétitions activées, active ou non |
| POST | `…/bets/:id/check` | Demander le résultat à la source (une fois par minute au plus) |
| GET | `/api/groups/:g/places?q=` | Recherche de ville pour la météo (admin) |
| POST | `/api/groups/:g/invite/regenerate` | Nouveau lien (admin) |
| GET · POST | `/api/groups/:g/bets` | Liste (`?all=1` : tout l'historique) · créer |
| GET · PATCH · DELETE | `/api/groups/:g/bets/:id` | Fiche · modifier · supprimer (créateur, sans pronostic) |
| POST | `…/bets/:id/pick` · `details` · `postpone` · `arbiter` · `withdraw` | Parier (ou changer d'avis jusqu'à la clôture) · préciser · repousser · changer d'arbitre · se désister |
| POST | `…/bets/:id/close` · `cancel` · `resolve` · `contest` · `vote` · `correct` | Clôturer · annuler · trancher · contester · voter · corriger |
| POST · DELETE | `…/bets/:id/comments[/:cid]` | Commenter · supprimer |
| GET · POST | `/api/groups/:g/feeds` | Compétitions proposées et mon choix · `{ key, choice: 'in' \| 'out' }` |
| GET | `/api/groups/:g/rankings` | Les classements du groupe, avec la saison à montrer et ma place |
| GET | `/api/groups/:g/rankings/:classement?season=` | Une saison d'un classement (en cours par défaut) et la liste de ses saisons |
| GET | `/api/groups/:g/seasons/:s/bets` | Les paris d'une saison (historique) |
| GET | `/api/groups/:g/feed` · `members/:m` · `export` | Activité · profil · export (admin) |
| POST | `…/members/:m/role` · `reset-pin` · `remove` | Administration des membres (`reset-pin` rend `{ done, waiting }`) |
| POST | `…/me/leave` | Quitter le groupe |
| POST | `/api/_test/clock` | Avancer l'horloge (uniquement avec `PT_TEST_HOOKS=1`) |

**Admin du site** (`/api/admin`, session admin obligatoire sauf les trois premières) :

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/admin/session` | `{ signedIn, hasPassword }` |
| POST | `/api/admin/login` · `logout` | Se connecter (`{ password }`) · se déconnecter |
| GET | `/api/admin/overview` · `nav` · `log` | Vue d’ensemble (chiffres, tendances, `picksByDay`, `attention` : ce qui demande une action) · compteurs du menu · journal (200 dernières lignes) et sessions admin ouvertes |
| GET · POST | `/api/admin/players` | Comptes · créer (`{ pseudo, avatar, groupId, role }`, sans PIN) |
| GET · PATCH · DELETE | `/api/admin/players/:id` | Fiche · pseudo, avatar · supprimer (`{ confirm: pseudo }`) |
| POST | `…/players/:id/unlock` · `reset-pin` · `logout` | Débloquer · PIN à choisir · déconnecter partout (`{ devices }`) |
| GET · POST | `/api/admin/groups` | Groupes · créer pour un compte (`{ name, emoji, playerId }`, sans coupon) |
| GET · PATCH · DELETE | `/api/admin/groups/:id` | Fiche (avec réglages et compétitions) · nom, emoji et réglages (`{ name, emoji, settings? }` → `{ removed }`, tout ou rien) · supprimer (`{ confirm: nom }`) |
| GET | `…/groups/:id/settings` · `/api/admin/places?q=` | Réglages du groupe, ses sources telles qu'il les a réglées, sources coupées (`off`) · chercher une ville (météo) |
| POST | `…/groups/:id/invite` · `members` | Nouveau lien · ajouter un compte (`{ playerId, role }`) |
| GET | `…/groups/:id/rankings[/:classement?season=]` | Classements du groupe · une saison d'un classement (comme `/api/groups/:g/rankings`) |
| GET · PATCH | `/api/admin/sources[/:id]` | Sources (état, clé et sa variable `keyName`, groupes, paris en cours, dernière lecture réussie `readAt`, `failingSince` et `error` si elle ne répond plus) · couper ou rallumer pour tout le site (`{ enabled }` → `{ removed }`) |
| PATCH · DELETE | `/api/admin/members/:id` | Rôle (`{ role }`) · retirer du groupe |
| GET · POST | `/api/admin/coupons` | Coupons · créer (`{ note, days: 7 \| 30 \| 90 \| null }` → `{ id, code, expiresAt }`, seule fois où le code est rendu) |
| POST | `…/coupons/:id/revoke` | Annuler un coupon disponible |
| GET | `/api/admin/configuration` | Identité de l'installation (`branding`), icône (`icons` : onglet, téléphone, logo, ou `null`), thème et thèmes |
| PATCH | `/api/admin/branding` | Nom, nom court, adresse publique, textes de l'accueil, hébergeur (seuls les champs changés → `{ branding, brand, changed }`) |
| PUT · DELETE | `/api/admin/icon` | Nouvelle icône (`{ png }` en base64 ; 3 Mo de JSON acceptés sur ce seul chemin) · retour à l'icône de PariTenu |
| GET · PUT | `/api/admin/appearance` · `theme` | Thème actuel et thèmes · changer de thème (`{ theme }`) |

## Sécurité

* **Accès** : le jeton du lien (128 bits) est le secret du groupe ; la session est celle du compte (cookie
  `pt_session`), `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS et sur `*.ts.net`, valable un an et prolongée à
  chaque visite ; elle n'ouvre que les groupes dont le compte est membre (`403 not_member` sinon).
* **PIN** : scrypt (N = 2^14, r = 8, p = 5 : 16 MiB ; les hachages Argon2id d'avant restent acceptés là où Node le permet). Un PIN à 4 chiffres reste devinable : `POST /api/account/login` exige le lien
  d'un groupe (`inviteToken` ; sans : `403 group_link_required`, lien inconnu : `404`), contrôlé aussi par
  `AccountService.login` ; l'accueil n'a plus de formulaire de connexion (2026-11-03), l'adresse d'un groupe non plus
  (un `401` y ouvre `/invite/<lien>` si l'appareil le garde, sinon `reconnectView()` de `welcome.js`, sur place). 5 erreurs (connexion ou
  changement de PIN) bloquent le compte 15 minutes, chaque blocage suivant dure deux fois plus (24 h
  au plus ; on repart de 15 minutes un jour après le dernier), plus la limite de 30 tentatives par adresse toutes les
  5 minutes. Après une réinitialisation, le nouveau PIN ne se choisit que depuis le lien d'un de ses groupes ; la
  réinitialisation n'aboutit que si un admin de chacun de ses groupes l'a demandée (dans les 7 jours).
* **Admin du site** : mot de passe (12 caractères au moins) haché en scrypt, choisi uniquement sur le serveur
  (`npm run admin`, aucune route pour le faire depuis le site) ; 5 erreurs bloquent 15 min, puis deux fois plus (24 h au
  plus), en plus de la limite par adresse ; `npm run admin` débloque et ferme toutes les sessions. Session : cookie
  `pt_admin` (`HttpOnly`, `SameSite=Strict`, `Path=/api/admin`, `Secure` en HTTPS), fermée après 2 h sans activité et
  12 h au plus ; une session de joueur n'ouvre rien. Page `/admin` en `no-store` et `noindex`, hors du service worker.
  Suppressions confirmées en retapant le nom ; journal `admin_log` (action, phrase lisible, adresse), jamais modifié.
* **Coupons** : 60 bits (12 caractères sur 32), seule l'empreinte SHA-256 est gardée ; vérifiés avant de hacher le PIN,
  puis consommés par un `UPDATE … WHERE used_at IS NULL` dans la transaction qui crée le groupe (deux créations
  simultanées : une seule passe, l'autre ne crée ni groupe ni compte). Limite de 30 essais par adresse en 5 minutes.
* **CSRF** : écritures en JSON uniquement (`415` sinon) et refus des requêtes portant une `Origin` étrangère (seules
  passent celle de la page et l'adresse publique réglée dans la page Configuration). Corps JSON limité à 32 ko, 3 Mo
  pour la seule icône (`/api/admin/icon`, admin du site).
* **XSS** : CSP sans `unsafe-inline` ; l'interface ne construit le DOM qu'avec `textContent` et des attributs
  (`h()` refuse les URL non sûres et les styles en ligne).
* **Moteurs de recherche** : seul l'accueil (`/`) peut être indexé. Toutes les autres réponses (groupes, invitations,
  mes groupes, aide, admin, API, images, redirections) portent `X-Robots-Tag: noindex, nofollow`, et `/robots.txt`
  (écrit dans `src/app.js`) n'autorise que `/` (`Allow: /$`) et ce qu'il faut pour l'afficher (css, js, polices, icônes,
  `/api/instance`) : les robots polis ne chargent même pas un lien d'invitation (qui montre le nom du groupe et les
  pseudos des membres).
* **Données** : ni e-mail, ni téléphone, ni vrai nom. L'export JSON exclut PIN, sessions et lien d'invitation.
* **Sources de données** : appelées par le serveur seulement (la CSP du navigateur reste `'self'`), avec un délai de
  10 s et un cache (5 min à 1 h). Le client choisit un événement et un marché ; le serveur les retrouve chez la source
  et n'accepte du client ni options ni référence. Les textes venus des sources sont coupés à la bonne longueur et
  affichés comme du texte ; seuls les liens `https` sont gardés. Les API d'ESPN et de MotoGP.com sont publiques mais non
  documentées : elles peuvent changer sans préavis (le pari passe alors en « résultat attendu », puis un admin tranche).
* **Horaires MotoGP** : l'API de résultats donne l'heure locale du circuit marquée « +00:00 » (15 h à Sepang devient
  15 h UTC, soit 7 h de trop). Les heures de départ viennent donc du calendrier officiel (`/motogp/v1/events/{id}`,
  fuseau du circuit), relié par `toad_api_uuid` ; l'API de résultats ne sert qu'aux classements et aux annulations.

## Tests

GitHub Actions (`.github/workflows/tests.yml`) : `npm test` sous Linux (ubuntu-latest, Node 24) et `npm run test:e2e`
sous Windows (windows-latest, Edge déjà installé), à chaque envoi sur `main`, à chaque pull request et à la demande ;
les captures du parcours sont jointes au résultat. Les deux passent aussi en UTC et sur un clone neuf (sans `data/` ni
`.env`).

| Fichier | Ce qu'il couvre |
|---|---|
| `scoring.test.js` | Barème, arrondis, plafond, unanimité, prime, dépouillement des votes |
| `bets.test.js` | Création et validations, pronostics, clôtures, validation, contestation, votes, arbitre absent ou désisté, corrections, commentaires |
| `members.test.js` | Comptes : créer, rejoindre d'un geste, se connecter ailleurs, blocages croissants, réinitialisation à plusieurs admins, comptes d'avant ; administration, réglages, export |
| `sources.test.js` | Chaque source sur de vraies réponses capturées : événements, questions, clôtures, résultats, reports, pannes, cache |
| `migrations.test.js` | Migrations v5 et v6 rejouées sur une base remise à la version d'avant : catégories et compétitions séparées ; pseudo et avatar par joueur |
| `admin.test.js` | Configuration de l'installation (nom, adresse publique, textes, hébergeur : coquille, manifeste, API, messages ; texte échappé ; adresses refusées ; origine publique et cookie Secure ; icône recadrée et déclinée, refus, retour à l'origine) ; admin du site : pas de mot de passe sans le serveur, cookie (HttpOnly, Strict, chemin), autre origine refusée, blocages croissants, sessions (2 h, 12 h), `npm run admin` ; coupons (création, suivi, annulation) ; comptes (fiche, débloquer, créer sans PIN, modifier, réinitialiser, déconnecter, supprimer) ; groupes (renommer, lien, ajouter, rôle, retirer, créer pour un compte, supprimer un groupe rempli) ; tableau de bord et journal |
| `live.test.js` | Équipes et logos d'un match, photos des pilotes (recadrées en 160 px), direct minute par minute (une requête pour tous les groupes), mi-temps, score final, podium, F1 et tennis, relais d'images (liste blanche) |
| `config.test.js` | Réglages (types, catégories, compétitions, paris maison et compétitions à part, groupe sans paris maison), ouverture automatique (doublons, types coupés, compétition coupée, pari jamais joué, source en panne), NFL, Top 14, NBA, tennis, UFC, résultats automatiques, contestation, source muette, bouton « Vérifier » |
| `seasons.test.js` | Équinoxes et solstices (à la minute), saisons de l'année, saisons officielles et de secours, libellés |
| `security.test.js` | En-têtes (CSP…), CSRF, JSON invalide, cloisonnement des groupes, coupons (obligatoire, faux, recopié en minuscules, déjà servi, annulé, expiré, deux créations simultanées), limitation, cookie Secure |
| `scoring.test.js` (V3) | Cotes américaines → décimales, règlement à cote fixe (seul, unanime, plafond) |
| `stats.test.js` | Classement d'une saison, fin de saison (champion, classement figé, remise à zéro, historique), saison qui attend ses derniers résultats, profil, séries, badges, fil d'activité |
| `time.test.js` | Débuts de mois à Paris, changements d'heure |
| `invariants.test.js` | 3 simulations de 120 paris au hasard : barème respecté, corrections exactement compensées, score de saison = journal, somme des saisons = journal |
| `e2e/run.mjs` | 22 scénarios dans Edge sur 4 téléphones, des invitations au mode sombre, avec captures (dont la page Réglages des paris, les compétitions proposées, les paris ouverts tout seuls, un match à cote des bookmakers, le classement de la Ligue 1 et un parcours sur PC : barre latérale, site, aide) |
