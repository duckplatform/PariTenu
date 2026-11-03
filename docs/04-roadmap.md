# Feuille de route

✅ fait et vérifié par les tests · 🧪 fait, mais pas encore essayé en vrai · ⏳ à faire

## V1 — 2026-10-29

Tout le cahier des charges V1 (docs/01-cahier-des-charges.md) :

* ✅ Groupe créé depuis l'accueil, lien d'invitation (128 bits) partagé dans WhatsApp, entrée avec pseudo, avatar et
  PIN ; reconnexion sur un autre téléphone ; blocage 15 min après 5 PIN faux ; un téléphone peut être dans plusieurs
  groupes.
* ✅ Paris Oui/Non et à choix multiples (2 à 8 options), 12 catégories, idées de paris à compléter, raccourcis de
  clôture, arbitre au choix, précisions datées, clôture repoussée, modification et suppression avant le premier
  pronostic.
* ✅ Pronostic gratuit en 2 touches avec les points potentiels recalculés au moment de confirmer ; pari tenu (pas de
  changement) ; l'arbitre ne parie pas.
* ✅ Cotes du groupe et barème (100 × cote, plafond réglable), pari unanime ou à moins de 2 participants annulé,
  prime d'arbitre de 20 points.
* ✅ Verdict, validation de 24 h, contestation, vote de 48 h (majorité, égalité = annulation, moins de 3 votants =
  décision maintenue), arbitre absent (admin après 7 jours, annulation à 30 jours), correction par un admin avec
  écritures inverses.
* ✅ Classement général et du mois (heure de Paris), profil (stats, séries, meilleur coup, historique, relevé),
  7 badges, fil d'activité, commentaires et réactions.
* ✅ Administration : lien, nom et emoji, réglages des points et délais, catégories, rôles, réinitialisation de PIN,
  retrait d'un membre, export JSON ; quitter le groupe (pseudo anonymisé).
* ✅ Installable (manifeste, icônes, service worker), mode sombre automatique, téléphone d'abord.
* ✅ Tests : 76 tests `node:test` + 20 scénarios Edge (`npm run test:all`).
* ✅ Démo : `npm run demo` (groupe « Les Potes », 10 paris dans tous les états).

### 2026-11-01 : parier d'un geste depuis la liste

* ✅ Demande : « il faut pouvoir parier rapidement depuis la page liste des paris, en cliquant sur le choix ; pas de
  modale comme sur la page du pari ». Sur la liste, les options d'un pari ouvert sont des boutons : un toucher parie
  (message « Pari enregistré : « Victoire Lyon » »), sans fenêtre ; le reste de la carte mène toujours à la fiche.
* ✅ Règle changée (réponse à la question posée : « on peut changer de choix tant que ce n'est pas clôturé ») : on change
  d'avis jusqu'à la clôture, depuis la liste (un toucher) ou la fiche (fenêtre « Changer ton pari ») ; le fil le raconte
  (« a changé d'avis : … au lieu de … ») et un pronostic de match change aussi dans les autres groupes du joueur.
  Toujours pas de retrait, et plus rien après la clôture. 195 tests, 27 scénarios Edge (capture 54).
* ✅ **En ligne** le 2026-11-01 à 20 h 35 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`, pas de migration) : le site public sert la nouvelle version (cartes, pari d'un geste, passeurs).

### 2026-11-01 : titre d'un pari de F1

* ✅ Demande : « pour les courses F1, juste mettre le lieu/circuit dans le titre du pari, on s'en fout des phrases genre
  “qui gagne ?” ». Le pari d'un Grand Prix s'appelle maintenant « Mexico City · Autódromo Hermanos Rodríguez » (lieu et
  circuit donnés par Jolpica). Vaut pour les paris ouverts à partir de maintenant ; celui du GP de Mexico, ouvert avant
  et clos à 21 h le jour même, garde son ancien titre.
* ✅ Retour : « “pari annulé au bout de 30 jours” : certainement pas ». Une course de F1 annulée annule maintenant le
  pari dès qu'elle sort du calendrier officiel (Jolpica), sans attendre ; repoussée, le pari la suit. Au passage : une
  course annulée décale les numéros des suivantes, et le pari aurait pu être réglé sur le GP d'après ; il reconnaît
  maintenant sa course à sa page officielle. Migration v12 : les paris de F1 déjà ouverts ont le nouveau texte.
  Le délai général de 30 jours (un pari resté sans verdict est annulé) reste, en dernier recours, pour tous les paris.
  198 tests.
* ✅ **En ligne** le 2026-11-01 à 20 h 54 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : migration v12 appliquée à la vraie base (le pari du GP de Mexico a le nouveau texte, 187 paris et
  186 pronostics intacts) ; avec le vrai Jolpica, ce pari retrouve sa course dans le calendrier et attend son résultat.

### 2026-11-03 : « Voir sur … » nomme le bon site

* ✅ Retour : « le lien sur le pari du Grand Prix de Mexico renvoie vers Wikipédia, alors qu'il y a écrit “Voir sur
  Jolpica F1” ». Le lien d'un pari dit maintenant le site qu'il ouvre (« Voir sur Wikipédia ↗ »), plus la source du
  résultat (Jolpica reste nommé comme source du résultat). Vaut pour toutes les sources (ESPN, MotoGP.com, Fantasy Padel
  Tour, Manifold…) et pour les paris déjà ouverts. 199 tests, 27 scénarios Edge.
* ✅ Suite : « pourquoi tu renvoies vers Wikipédia ! on renvoie vers des pages de la compétition (… ESPN propose une
  page F1 …), même si tu utilises une autre source de données ». Le lien d'un pari de F1 est maintenant la page du
  Grand Prix chez ESPN (https://www.espn.com/f1/race/_/id/600057447 pour Mexico), trouvée dans le calendrier F1
  d'ESPN par le jour de la course ; ESPN injoignable : son calendrier F1, remplacé plus tard. Les paris déjà ouverts
  (São Paulo, et Mexico déjà réglé) sont corrigés tout seuls avec l'ouverture automatique (`SourceService.relink`). Les
  autres sources renvoyaient déjà vers la page de la compétition (ESPN, MotoGP.com, Fantasy Padel Tour, Manifold).
  200 tests, 27 scénarios Edge.
* ✅ **En ligne** le 2026-11-03 à 9 h 38 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`, pas de migration) : dès le démarrage, São Paulo (https://www.espn.com/f1/race/_/id/600057448) et
  Mexico (…/600057447) ont leur lien ESPN ; 227 paris et 186 pronostics intacts.
* ✅ Padel (« l'API que tu utilises propose un site qui donne les résultats et détails des matchs, exactement ce vers
  quoi on veut renvoyer ; vois si les réponses de l'API donnent ce type d'adresse ») : oui, Padel API donne la page de
  chaque match et de chaque tournoi chez Fantasy Padel Tour (son site), déjà utilisée par les paris de padel, mais en
  espagnol. Après validation : lien en français (« fr.fantasypadeltour.com », mêmes chemins, vérifié) et « Voir sur
  Fantasy Padel Tour ↗ ». Page du match, sinon celle du tournoi ; le calendrier n'est pas donné par l'API. Erreur
  corrigée : les liens de padel n'ont jamais ouvert Premier Padel (c'était l'adresse du faux service des tests). Vraies
  réponses capturées (`padelapi-*.json`, Kuwait Major 2026). 201 tests, 27 scénarios Edge.
  En ligne le 2026-11-03 à 9 h 51 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration ;
  227 paris et 186 pronostics intacts). Aucun pari de padel ouvert : les prochains (Mexico Major) auront le lien en français.

### 2026-11-03 : la connexion seulement par le lien d'un groupe

* ✅ Demande : « il y a un formulaire de connexion sur la page d'accueil, re-sécurisons tout ça. Les tentatives de login
  ne sont possibles que depuis les liens de groupe, sinon je vais me faire bruteforcer de partout car on n'utilise que
  des codes PIN ». Le serveur refuse toute connexion sans le lien (secret) d'un groupe (`403`, lien inconnu : `404`) ;
  l'accueil n'a plus de formulaire, il dit d'ouvrir le lien d'un de ses groupes ou de le demander à un ami. Le lien de
  n'importe quel groupe convient (on s'y connecte, puis on rejoint ce groupe). Au passage : les essais ratés pour
  changer de PIN (page « Moi ») comptent maintenant pour le blocage, comme à la connexion. Restent : 5 erreurs bloquent
  le compte 15 min puis deux fois plus (24 h au plus), et 30 essais par adresse toutes les 5 minutes (vraie adresse du
  visiteur derrière Funnel). Aide mise à jour. 203 tests, 27 scénarios Edge (capture 39 : connexion par le lien).
* ✅ **En ligne** le 2026-11-03 à 9 h 59 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration).
  Vérifié sur le vrai site : connexion sans lien refusée (403), lien inventé refusé (404), accueil sans champ PIN ;
  227 paris, 186 pronostics et les 5 appareils connectés intacts (personne n'a à retaper son PIN).

### 2026-11-03 : 5 thèmes au choix de l'admin et refonte de l'ergonomie

* ✅ Demande : « l'expérience utilisateur sur mobile comme sur PC est pas folle », maquettes de thèmes avec le skill
  ui-ux-pro-max (`docs/maquettes/`), puis « mets-les tous, et que ce soit configurable via l'admin UI ». Page
  **Apparence** dans `/admin` : 6 habillages avec aperçu et couleurs — **Stade** (celui d'origine, toujours par
  défaut), **Tribune** (rouge et or, Bebas Neue), **Nocturne** (noir OLED, Barlow), **Récré** (néo-brutalisme, Space
  Grotesk), **Arène** (verre dépoli néon, Russo One), **Vestiaire** (noir et blanc, Outfit). Le même pour tout le site,
  appliqué à la page suivante de chaque joueur ; polices hébergées par l'app.
* ✅ Ergonomie commune à tous les thèmes : barre du bas avec **Parier** au centre (plus de bouton flottant sur les
  cartes) et « Moi » sur l'avatar en haut quand l'onglet Direct est là ; nom du groupe en haut = changer de groupe ;
  cartes plus compactes (équipes en ligne, choix en grille) ; chaque choix montre **ce qu'il rapporte** (« +210 ») au
  lieu de la cote ; **« À toi de jouer »** en tête de carte au lieu de « Touche ton choix pour parier » sur chacune ;
  « Ton pari : Lyon · modifiable jusqu'à 20h55 » ; plus d'étiquette « Auto » ; compétitions à découvrir sous les
  paris ouverts ; icônes dessinées (SVG) au lieu des emoji pour la navigation, les sections et les états. Sur PC :
  paris en lignes (le match à gauche, les choix à droite) et, sur grand écran, une colonne avec le direct, le
  classement et l'activité du groupe.
* ✅ Tests : 204 `node:test` (thème : défaut, changement réservé à l'admin du site, feuille et polices servies, pas de
  304 vers l'ancien thème) + 28 scénarios Edge (Apparence, les 6 thèmes sur téléphone et sur PC : police chargée, fond,
  barre du bas, colonne de droite ; captures 60 et 61).
* ✅ **En ligne** le 2026-11-03 à 10 h 43 (redémarré avec l'accord de l'utilisateur, base sauvegardée avant, pas de
  migration). L'utilisateur a choisi **Vestiaire** dans la page Apparence aussitôt après. Vérifié sur le vrai site dans
  Edge : `/theme.css` sans date ni ETag, polices de Vestiaire chargées depuis l'app, aucune erreur.

### 2026-11-03 : « sport · compétition · rencontre », plus de « qui gagne ? »

* ✅ Demande : « pourquoi je vois encore “Rolex Paris Masters, 1er tour : Quentin Halys – Arthur Fery, qui gagne ?” ;
  tu mets le sport, la compétition, la rencontre et c'est tout ! ». Tous les paris de sport s'appellent maintenant
  « Tennis · Rolex Paris Masters, 1er tour · Quentin Halys – Arthur Fery », « Football · Ligue 1 · Lille – Lens »,
  « MMA · UFC Fight Night: … · A – B », « Padel · Kuwait Major, finale · … », « Moto · MotoGP · Grand Prix du Qatar »
  (« …, sprint »), « Formule 1 · São Paulo · Autódromo José Carlos Pace » (`sportTitle`, src/sources/http.js).
  Migration v13 : les 227 paris déjà là (ouverts et passés, donc aussi dans le fil et l'historique) renommés pareil,
  vérifié à blanc sur la vraie base (aucun « qui gagne » restant). Textes des réglages et de l'aide sans « qui gagne ».
  Les idées de paris maison (« Qui gagne le tournoi de Mario Kart ? ») restent. 205 tests, 28 scénarios Edge.
* ✅ Page Activité refaite (« les pages d'activités sont pas dingue, des pauvres listes ; tu proposes quoi de mieux ? »,
  proposition avec maquette validée : « Oui, lots A et B »). Lot A : le fil jour par jour (« Aujourd'hui », « Hier »,
  « Dimanche 1er novembre ») ; chaque résultat en carte (écussons et score final, réponse gagnante et cote, points de
  chacun, « raté », prime d'arbitre) ; plusieurs résultats d'une compétition le même jour en une seule carte avec le
  bilan de chacun (« Simon 8/19 · +1 479 pts ») et la liste dépliable ; les pronostics d'une même personne regroupés
  (« Simon a parié sur 11 paris », chaque pari et son choix, changements d'avis signalés) ; les nouveaux paris en une
  ligne (« 40 nouveaux paris · NBA 14, NHL 10… · Parier ») ; les commentaires en bulle ; plus de « pronostics clos » ni
  de résultat officiel en double. Lot B : « À la une » (depuis 24 h : paris réglés, gains de chacun, coup de flair à
  partir d'une cote ×2,5, leader de chaque classement qui a bougé et « passe en tête » s'il double quelqu'un,
  champions sacrés) ; filtres Tout / Résultats / Pronos / Discussions. Sur la vraie base (copie) : 18 éléments pour tout
  l'historique au lieu de 60 lignes pour quelques heures. 207 tests, 28 scénarios Edge (capture 14).
* ✅ **En ligne** le 2026-11-03 à 11 h 08, avec les titres « sport · compétition · rencontre » et les thèmes de la session
  « Maquettes UI/UX » (redémarré avec l'accord de l'utilisateur, base sauvegardée dans `data/backups/`). Migration v13
  appliquée à la vraie base : plus aucun « qui gagne » (226 paris renommés) ; 227 paris, 210 pronostics, 2 groupes intacts.

### 2026-11-03 : 4 sections, choix visible au direct, supprimer son groupe, commentaires désactivables

* ✅ « Ne mentionne pas MonPetitProno sur la page de /groups, on va m'accuser de plagiat » : plus aucune mention d'une
  autre app (page d'accueil du site, aide, README, docs, commentaires du code, noms des tests).
* ✅ Liste des paris en 4 sections, les vides cachées : « À parier » (pas encore parié, clôture la plus proche d'abord),
  « Pariés » (choix fait, modifiable jusqu'à la clôture ; aussi les paris que j'arbitre), « Clos » (plus rien ne change :
  d'abord ce qui m'attend, trancher ou voter, puis les matchs en direct, puis les résultats attendus) et « Terminés ».
  Une phrase sous chaque titre dit ce qu'on y trouve.
* ✅ Page Direct : mon choix se voit sur le match (l'équipe entourée, pastille « Ton choix », en vert s'il passe, en rouge
  sinon ; « Nul · ton choix » au centre) au lieu de la phrase « Ton prono : … ».
* ✅ Un admin du groupe le supprime (Réglages du groupe → « Supprimer le groupe », en retapant son nom, sans tenir compte
  des majuscules) : tout disparaît pour tous ses membres, leurs comptes et leurs autres groupes restent ; noté dans le
  journal de l'admin du site.
* ✅ Réglage « 💬 Commentaires sur les paris » (Points, délais et commentaires ; aussi dans l'admin du site) : désactivés,
  plus personne ne commente (403) et ils disparaissent de la fiche d'un pari, de la page Activité et de la colonne de
  l'accueil ; réactivés, ils reviennent (rien n'est effacé). 209 tests, 29 scénarios Edge (capture 55).
* ✅ **En ligne** le 2026-11-03 à 11 h 26 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration) :
  le site public sert la nouvelle version (plus aucune mention d'une autre app) ; 227 paris, 227 pronostics, 2 groupes intacts.

### 2026-11-03 : un joueur remplacé avant le match (forfait)

* ✅ Retour : « problème avec ce pari, pas les bons noms entre matchup et proposition » (Tsitsipas – Tien). Tsitsipas a
  déclaré forfait et un repêché (Vallejo) a pris sa place sous le même numéro de match chez ESPN : le pari proposait
  toujours Tsitsipas, mais son visuel était réécrit avec Vallejo. Maintenant, pour les rencontres à deux (tennis, MMA,
  padel : `matchup`) : l'ouverture automatique voit l'affiche changer et annule le pari (« Forfait avant le match :
  Stefanos Tsitsipas remplacé par Adolfo Daniel Vallejo », aucun point), son visuel garde l'affiche d'origine ; si le
  remplacement arrive trop tard, le résultat annule le pari au lieu de le régler sur un joueur absent (avant, il plantait
  ou donnait le joueur absent perdant) ; les paris déjà réglés retrouvent leur affiche (`repairMatchups`). Sur la vraie
  base : 4 paris concernés (Tsitsipas – Tien et Davidovich Fokina – Kouame à 12 h 30, Parsons – Henrique à l'UFC du
  7 novembre, et Merida – Blockx, déjà réglé le 2 novembre alors que Blockx n'a pas joué). 212 tests, 29 scénarios Edge.
* ✅ **En ligne** le 2026-11-03 à 11 h 39 (redémarré avec l'accord de l'utilisateur, base sauvegardée) : dès la première
  ouverture automatique, les 3 paris ouverts concernés sont annulés avec leur motif et les 4 retrouvent leur affiche ;
  aucun autre pari annulé. Merida – Blockx reste réglé (correction possible par un admin du groupe).

### 2026-11-03 : page Configuration (nom, adresse publique, textes, icône)

* ✅ Demande : le projet devient open source sous le nom **PariTenu** ; chaque installation se personnalise dans l'admin.
  Nouvelle page **⚙️ Configuration** de `/admin` (remplace Apparence, dont l'adresse y mène) : nom et nom court,
  adresse publique, accroche, présentation et note de pied de page de l'accueil, hébergeur, icône (PNG recadré au carré
  et décliné en 32, 180, 192, 512 et « maskable »), thèmes. Aperçu en direct (onglet, nom sous l'icône, lien
  d'invitation), journal `branding_changed` / `icon_changed`.
* ✅ Le serveur écrit le nom dans la coquille (`<title>`, description, nom sous l'icône, icônes, `<meta name="instance">`)
  et le manifeste ; l'app, l'admin, les partages, l'aide et le message « il faut un coupon » le reprennent. L'adresse
  publique ne sert qu'aux liens (invitation, coupon, partage d'un pari) : aucune redirection ; ses requêtes passent le
  contrôle d'origine et gardent le cookie `Secure` derrière un proxy. Pied de page : « Propulsé par PariTenu, logiciel
  libre » (une fois renommée) et « Hébergé par … ». Service worker `pari-tenu-v3`.
* ✅ 215 tests (3 nouveaux : réglages partout et texte échappé, origine publique et cookie, icône) et 30 scénarios Edge
  (« configuration » : renommer en « Paris entre Couilles », icône, accueil et aide d'un visiteur, lien d'invitation
  partagé sur `https://paris.entrecouilles.fr`, puis retour aux valeurs d'origine ; captures 64 à 66). Vu sur les
  captures et corrigé : champs d'adresse au style des autres champs ; bandeau de l'admin sur deux lignes sous 1500 px
  (un nom long ne pousse plus le menu hors de l'écran).
* ✅ **En ligne** le 2026-11-03 à 12 h 43 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de
  migration) : coquille, manifeste et admin servis par le serveur, service worker `pari-tenu-v3`, aucune erreur dans
  Edge (téléphone et PC) ; 2 groupes, 227 paris, 227 pronostics intacts. Valeurs encore par défaut (« Pari tenu ! »).
* ⏳ Régler notre installation dans `/admin` → Configuration : « Paris entre Couilles », « EntreCouilles », hébergeur
  Duck Platform ; l'adresse publique `https://paris.entrecouilles.fr` seulement une fois le domaine branché sur le
  serveur (sinon les liens d'invitation mèneraient nulle part).
* ⏳ Mise en ligne sur `paris.entrecouilles.fr` (cPanel : hébergement, proxy, HTTPS).
* ⏳ Préparation open source : licence, README sans adresse personnelle, `.env.example`, lien du dépôt (`PROJECT_URL`).

### 2026-11-03 : des adresses sans #, l'accueil du site, Mes groupes et la création à part

* ✅ Questions : « pourquoi la page par défaut est /#/groups et pas /, et pourquoi il y a un # ? » Réponse : un routeur
  « à # » (le serveur ne connaissait que 3 pages) ; `/` sautait au dernier groupe, l'accueil n'était visible qu'en
  `/#/groups`. Proposition validée, création de groupe sur `/groups/new` (choix de l'utilisateur).
* ✅ Vraies adresses : `/`, `/groups`, `/groups/new[/<coupon>]`, `/aide[/<section>]`, `/<groupe>/…` (16 caractères
  hexadécimaux), servies par le serveur avec la même coquille ; liens internes sans rechargement (pushState) ; anciennes
  adresses `/#/…` converties ; `/c/<coupon>` redirigé vers `/groups/new/<coupon>` ; l'admin du site garde ses `#`.
  Service worker `pari-tenu-v4`.
* ✅ `/` : l'accueil du site (principe, sports, points forts), sans formulaire, même connecté ; l'app installée s'ouvre
  toujours sur le dernier groupe. `/groups` : compte et groupes seulement. `/groups/new` : le formulaire, coupon rempli
  par son lien puis retiré de la barre d'adresse.
* ✅ Retour en cours de route : « virer le bouton Créer ou rejoindre… je ne veux pas de lien cliquable vers la page de
  création de groupe ». Aucun lien de l'app n'y mène plus (menu, accueil, Mes groupes, page Moi) : seulement le lien d'un
  coupon. Textes corrigés au passage : l'aide (« en créer d'autres sans code ») et la page Moi (« se connecter depuis
  l'accueil »).
* ✅ 216 tests (adresses servies, redirection des anciens coupons, 404 ailleurs) et 30 scénarios Edge (accueil sans
  formulaire ni lien de création, Mes groupes, création par l'adresse du coupon, app installée vers le dernier groupe,
  ancienne adresse en `#/` ; captures 00, 29).
* ✅ **En ligne** le 2026-11-03 à 13 h 18 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de
  migration) : vérifié dans Edge par le lien public (téléphone et PC) : `/` sans formulaire ni lien de création,
  `/#/groups` → `/groups`, liens internes sans rechargement, `/c/…` redirigé, service worker `pari-tenu-v4`, aucune
  erreur. Base : 1 groupe (l'utilisateur a supprimé « Les burnes » lui-même à 13 h 16), 227 paris, 227 pronostics.

### 2026-11-03 : toutes les adresses en anglais

* ✅ Demande : « revois toutes les routes pour les faire correspondre à des termes anglais, /admin/users, /admin/groups…
  seuls les textes sont français ». App : `/help[/<section>]` (sections en anglais), `/invite/<jeton>[?bet=<id>]`,
  `/<groupe>/members/<id>`. Admin du site sans `#` : `/admin/users`, `/admin/groups[/<id>[/edit]]`, `/admin/coupons`,
  `/admin/sources`, `/admin/configuration`, `/admin/log` (liens internes sans rechargement). L'API l'était déjà.
* ✅ Aucun lien cassé : le serveur redirige `/g/…?pari=` → `/invite/…?bet=`, `/aide/…` → `/help/…`, `/c/…` →
  `/groups/new/…` ; l'app convertit `/#/…`, `/<groupe>/m/…` et les anciens noms de section de l'aide ; l'admin convertit
  `/admin#/comptes…` (et `#/apparence`). Service worker `pari-tenu-v5`.
* ✅ 216 tests (adresses de l'app et de l'admin, redirections) et 30 scénarios Edge (dont les anciennes adresses).
* ✅ **En ligne** le 2026-11-03 à 14 h 10, avec la nouvelle admin (ci-dessous). L'ensemble vérifié ensuite : 218 tests,
  30 scénarios Edge, et par le lien public dans Edge (redirections `/aide`, `/g/…?pari=`, `/c/…` ; `/#/aide/installer`
  → `/help/installer` ; `/admin#/comptes` → `/admin/users` ; aucune erreur) ; base intacte (1 groupe, 227 paris).

### 2026-11-03 : dépôt Git et GitHub Actions

* ✅ Le projet devient un dépôt Git (branche `main`) dans `C:\Repositories\duckplatform\PariTenu` ; l'utilisateur le
  publie lui-même avec GitHub Desktop. `.gitignore` : `data/` (base, sauvegardes, icône), `.env`, `node_modules`,
  captures ; `.gitattributes` : fins de ligne LF. Aucun secret dans les fichiers suivis (vérifié).
* ✅ GitHub Actions (`.github/workflows/tests.yml`) : tests unitaires sous Linux, parcours dans Edge sous Windows avec
  ses captures en artefact ; à chaque envoi sur `main`, pull request, ou à la demande. Vérifié avant : clone neuf +
  `npm ci`, 219 tests et 30 scénarios en UTC, et les tests unitaires dans un conteneur Linux (Node 26) ; casse des 430
  imports relatifs (Linux distingue les majuscules).
* 🧪 Premier passage sur GitHub après la publication du dépôt.
* ⏳ Déploiement automatique sur cPanel (après l'installation manuelle) : SSH ou Git de cPanel, puis redémarrage de
  Passenger.

### 2026-11-03 : prêt pour cPanel (Phusion Passenger), en SQLite

* ✅ Précisions de l'utilisateur : sur cPanel, les variables d'environnement viennent de Passenger (« Setup Node.js App »),
  le `.env` n'est qu'un secours ; il faut pouvoir utiliser MySQL. Étude : les variables avaient déjà priorité (vérifié) ;
  MySQL demande de passer toute l'app en asynchrone (225 requêtes, 40 transactions, 13 migrations en SQL SQLite).
  Choix de l'utilisateur : **d'abord cPanel en SQLite**, MySQL ensuite ; Node 24 disponible sur son cPanel.
* ✅ `app.cjs` : fichier de démarrage pour Passenger (charge l'app en modules ES) ; sous Passenger, message de
  démarrage adapté (pas d'adresses locales ni de Tailscale). `.env` et un `PT_DB_PATH` relatif partent du dossier de
  l'app, plus du dossier courant. `npm run backup [-- étiquette]` : copie cohérente de la base (déménagement, cron).
* ✅ Guide `docs/05-installation-cpanel.md` : sous-domaine et SSL, code hors de `public_html`, données à part,
  Setup Node.js App (Node 24.7+, `app.cjs`, variables), reprise de la base du PC, mot de passe admin, adresse publique,
  vérification de l'IP des visiteurs (`PT_TRUST_PROXY`), tâche planifiée qui garde l'app éveillée (Passenger l'arrête
  sans visite, et avec elle les résultats et le direct), sauvegarde de nuit, départ de l'ancienne installation.
* ✅ 219 tests et 30 scénarios Edge ; démarrage par `app.cjs` essayé avec un Passenger simulé.
* ⏳ Installation sur `paris.entrecouilles.fr` avec l'utilisateur (son cPanel) ; à vérifier sur place : chargement par
  Passenger, IP des visiteurs, cookies Secure, app gardée éveillée.
* ⏳ MySQL / MariaDB : lot 1 (couche de base asynchrone, SQLite par défaut), lot 2 (MySQL, variables `PT_DB_*`), lot 3
  (`npm run db:copy` SQLite → MySQL).

### 2026-11-03 : seul l'accueil est visible des moteurs de recherche

* ✅ Demande : « les robots du net ne doivent pas voir les pages de groupe ; juste la page d'index peut être indexée ».
  Constat sur le site en ligne : pas de `robots.txt`, seule l'admin était en `noindex` ; un lien d'invitation chargé par
  un robot qui exécute le JavaScript aurait montré le nom du groupe et les pseudos des membres.
* ✅ `/robots.txt` : `Allow: /# Feuille de route

✅ fait et vérifié par les tests · 🧪 fait, mais pas encore essayé en vrai · ⏳ à faire

## V1 — 2026-10-29

Tout le cahier des charges V1 (docs/01-cahier-des-charges.md) :

* ✅ Groupe créé depuis l'accueil, lien d'invitation (128 bits) partagé dans WhatsApp, entrée avec pseudo, avatar et
  PIN ; reconnexion sur un autre téléphone ; blocage 15 min après 5 PIN faux ; un téléphone peut être dans plusieurs
  groupes.
* ✅ Paris Oui/Non et à choix multiples (2 à 8 options), 12 catégories, idées de paris à compléter, raccourcis de
  clôture, arbitre au choix, précisions datées, clôture repoussée, modification et suppression avant le premier
  pronostic.
* ✅ Pronostic gratuit en 2 touches avec les points potentiels recalculés au moment de confirmer ; pari tenu (pas de
  changement) ; l'arbitre ne parie pas.
* ✅ Cotes du groupe et barème (100 × cote, plafond réglable), pari unanime ou à moins de 2 participants annulé,
  prime d'arbitre de 20 points.
* ✅ Verdict, validation de 24 h, contestation, vote de 48 h (majorité, égalité = annulation, moins de 3 votants =
  décision maintenue), arbitre absent (admin après 7 jours, annulation à 30 jours), correction par un admin avec
  écritures inverses.
* ✅ Classement général et du mois (heure de Paris), profil (stats, séries, meilleur coup, historique, relevé),
  7 badges, fil d'activité, commentaires et réactions.
* ✅ Administration : lien, nom et emoji, réglages des points et délais, catégories, rôles, réinitialisation de PIN,
  retrait d'un membre, export JSON ; quitter le groupe (pseudo anonymisé).
* ✅ Installable (manifeste, icônes, service worker), mode sombre automatique, téléphone d'abord.
* ✅ Tests : 76 tests `node:test` + 20 scénarios Edge (`npm run test:all`).
* ✅ Démo : `npm run demo` (groupe « Les Potes », 10 paris dans tous les états).

### 2026-11-01 : parier d'un geste depuis la liste

* ✅ Demande : « il faut pouvoir parier rapidement depuis la page liste des paris, en cliquant sur le choix ; pas de
  modale comme sur la page du pari ». Sur la liste, les options d'un pari ouvert sont des boutons : un toucher parie
  (message « Pari enregistré : « Victoire Lyon » »), sans fenêtre ; le reste de la carte mène toujours à la fiche.
* ✅ Règle changée (réponse à la question posée : « on peut changer de choix tant que ce n'est pas clôturé ») : on change
  d'avis jusqu'à la clôture, depuis la liste (un toucher) ou la fiche (fenêtre « Changer ton pari ») ; le fil le raconte
  (« a changé d'avis : … au lieu de … ») et un pronostic de match change aussi dans les autres groupes du joueur.
  Toujours pas de retrait, et plus rien après la clôture. 195 tests, 27 scénarios Edge (capture 54).
* ✅ **En ligne** le 2026-11-01 à 20 h 35 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`, pas de migration) : le site public sert la nouvelle version (cartes, pari d'un geste, passeurs).

### 2026-11-01 : titre d'un pari de F1

* ✅ Demande : « pour les courses F1, juste mettre le lieu/circuit dans le titre du pari, on s'en fout des phrases genre
  “qui gagne ?” ». Le pari d'un Grand Prix s'appelle maintenant « Mexico City · Autódromo Hermanos Rodríguez » (lieu et
  circuit donnés par Jolpica). Vaut pour les paris ouverts à partir de maintenant ; celui du GP de Mexico, ouvert avant
  et clos à 21 h le jour même, garde son ancien titre.
* ✅ Retour : « “pari annulé au bout de 30 jours” : certainement pas ». Une course de F1 annulée annule maintenant le
  pari dès qu'elle sort du calendrier officiel (Jolpica), sans attendre ; repoussée, le pari la suit. Au passage : une
  course annulée décale les numéros des suivantes, et le pari aurait pu être réglé sur le GP d'après ; il reconnaît
  maintenant sa course à sa page officielle. Migration v12 : les paris de F1 déjà ouverts ont le nouveau texte.
  Le délai général de 30 jours (un pari resté sans verdict est annulé) reste, en dernier recours, pour tous les paris.
  198 tests.
* ✅ **En ligne** le 2026-11-01 à 20 h 54 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : migration v12 appliquée à la vraie base (le pari du GP de Mexico a le nouveau texte, 187 paris et
  186 pronostics intacts) ; avec le vrai Jolpica, ce pari retrouve sa course dans le calendrier et attend son résultat.

### 2026-11-03 : « Voir sur … » nomme le bon site

* ✅ Retour : « le lien sur le pari du Grand Prix de Mexico renvoie vers Wikipédia, alors qu'il y a écrit “Voir sur
  Jolpica F1” ». Le lien d'un pari dit maintenant le site qu'il ouvre (« Voir sur Wikipédia ↗ »), plus la source du
  résultat (Jolpica reste nommé comme source du résultat). Vaut pour toutes les sources (ESPN, MotoGP.com, Fantasy Padel
  Tour, Manifold…) et pour les paris déjà ouverts. 199 tests, 27 scénarios Edge.
* ✅ Suite : « pourquoi tu renvoies vers Wikipédia ! on renvoie vers des pages de la compétition (… ESPN propose une
  page F1 …), même si tu utilises une autre source de données ». Le lien d'un pari de F1 est maintenant la page du
  Grand Prix chez ESPN (https://www.espn.com/f1/race/_/id/600057447 pour Mexico), trouvée dans le calendrier F1
  d'ESPN par le jour de la course ; ESPN injoignable : son calendrier F1, remplacé plus tard. Les paris déjà ouverts
  (São Paulo, et Mexico déjà réglé) sont corrigés tout seuls avec l'ouverture automatique (`SourceService.relink`). Les
  autres sources renvoyaient déjà vers la page de la compétition (ESPN, MotoGP.com, Fantasy Padel Tour, Manifold).
  200 tests, 27 scénarios Edge.
* ✅ **En ligne** le 2026-11-03 à 9 h 38 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`, pas de migration) : dès le démarrage, São Paulo (https://www.espn.com/f1/race/_/id/600057448) et
  Mexico (…/600057447) ont leur lien ESPN ; 227 paris et 186 pronostics intacts.
* ✅ Padel (« l'API que tu utilises propose un site qui donne les résultats et détails des matchs, exactement ce vers
  quoi on veut renvoyer ; vois si les réponses de l'API donnent ce type d'adresse ») : oui, Padel API donne la page de
  chaque match et de chaque tournoi chez Fantasy Padel Tour (son site), déjà utilisée par les paris de padel, mais en
  espagnol. Après validation : lien en français (« fr.fantasypadeltour.com », mêmes chemins, vérifié) et « Voir sur
  Fantasy Padel Tour ↗ ». Page du match, sinon celle du tournoi ; le calendrier n'est pas donné par l'API. Erreur
  corrigée : les liens de padel n'ont jamais ouvert Premier Padel (c'était l'adresse du faux service des tests). Vraies
  réponses capturées (`padelapi-*.json`, Kuwait Major 2026). 201 tests, 27 scénarios Edge.
  En ligne le 2026-11-03 à 9 h 51 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration ;
  227 paris et 186 pronostics intacts). Aucun pari de padel ouvert : les prochains (Mexico Major) auront le lien en français.

### 2026-11-03 : la connexion seulement par le lien d'un groupe

* ✅ Demande : « il y a un formulaire de connexion sur la page d'accueil, re-sécurisons tout ça. Les tentatives de login
  ne sont possibles que depuis les liens de groupe, sinon je vais me faire bruteforcer de partout car on n'utilise que
  des codes PIN ». Le serveur refuse toute connexion sans le lien (secret) d'un groupe (`403`, lien inconnu : `404`) ;
  l'accueil n'a plus de formulaire, il dit d'ouvrir le lien d'un de ses groupes ou de le demander à un ami. Le lien de
  n'importe quel groupe convient (on s'y connecte, puis on rejoint ce groupe). Au passage : les essais ratés pour
  changer de PIN (page « Moi ») comptent maintenant pour le blocage, comme à la connexion. Restent : 5 erreurs bloquent
  le compte 15 min puis deux fois plus (24 h au plus), et 30 essais par adresse toutes les 5 minutes (vraie adresse du
  visiteur derrière Funnel). Aide mise à jour. 203 tests, 27 scénarios Edge (capture 39 : connexion par le lien).
* ✅ **En ligne** le 2026-11-03 à 9 h 59 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration).
  Vérifié sur le vrai site : connexion sans lien refusée (403), lien inventé refusé (404), accueil sans champ PIN ;
  227 paris, 186 pronostics et les 5 appareils connectés intacts (personne n'a à retaper son PIN).

### 2026-11-03 : 5 thèmes au choix de l'admin et refonte de l'ergonomie

* ✅ Demande : « l'expérience utilisateur sur mobile comme sur PC est pas folle », maquettes de thèmes avec le skill
  ui-ux-pro-max (`docs/maquettes/`), puis « mets-les tous, et que ce soit configurable via l'admin UI ». Page
  **Apparence** dans `/admin` : 6 habillages avec aperçu et couleurs — **Stade** (celui d'origine, toujours par
  défaut), **Tribune** (rouge et or, Bebas Neue), **Nocturne** (noir OLED, Barlow), **Récré** (néo-brutalisme, Space
  Grotesk), **Arène** (verre dépoli néon, Russo One), **Vestiaire** (noir et blanc, Outfit). Le même pour tout le site,
  appliqué à la page suivante de chaque joueur ; polices hébergées par l'app.
* ✅ Ergonomie commune à tous les thèmes : barre du bas avec **Parier** au centre (plus de bouton flottant sur les
  cartes) et « Moi » sur l'avatar en haut quand l'onglet Direct est là ; nom du groupe en haut = changer de groupe ;
  cartes plus compactes (équipes en ligne, choix en grille) ; chaque choix montre **ce qu'il rapporte** (« +210 ») au
  lieu de la cote ; **« À toi de jouer »** en tête de carte au lieu de « Touche ton choix pour parier » sur chacune ;
  « Ton pari : Lyon · modifiable jusqu'à 20h55 » ; plus d'étiquette « Auto » ; compétitions à découvrir sous les
  paris ouverts ; icônes dessinées (SVG) au lieu des emoji pour la navigation, les sections et les états. Sur PC :
  paris en lignes (le match à gauche, les choix à droite) et, sur grand écran, une colonne avec le direct, le
  classement et l'activité du groupe.
* ✅ Tests : 204 `node:test` (thème : défaut, changement réservé à l'admin du site, feuille et polices servies, pas de
  304 vers l'ancien thème) + 28 scénarios Edge (Apparence, les 6 thèmes sur téléphone et sur PC : police chargée, fond,
  barre du bas, colonne de droite ; captures 60 et 61).
* ✅ **En ligne** le 2026-11-03 à 10 h 43 (redémarré avec l'accord de l'utilisateur, base sauvegardée avant, pas de
  migration). L'utilisateur a choisi **Vestiaire** dans la page Apparence aussitôt après. Vérifié sur le vrai site dans
  Edge : `/theme.css` sans date ni ETag, polices de Vestiaire chargées depuis l'app, aucune erreur.

### 2026-11-03 : « sport · compétition · rencontre », plus de « qui gagne ? »

* ✅ Demande : « pourquoi je vois encore “Rolex Paris Masters, 1er tour : Quentin Halys – Arthur Fery, qui gagne ?” ;
  tu mets le sport, la compétition, la rencontre et c'est tout ! ». Tous les paris de sport s'appellent maintenant
  « Tennis · Rolex Paris Masters, 1er tour · Quentin Halys – Arthur Fery », « Football · Ligue 1 · Lille – Lens »,
  « MMA · UFC Fight Night: … · A – B », « Padel · Kuwait Major, finale · … », « Moto · MotoGP · Grand Prix du Qatar »
  (« …, sprint »), « Formule 1 · São Paulo · Autódromo José Carlos Pace » (`sportTitle`, src/sources/http.js).
  Migration v13 : les 227 paris déjà là (ouverts et passés, donc aussi dans le fil et l'historique) renommés pareil,
  vérifié à blanc sur la vraie base (aucun « qui gagne » restant). Textes des réglages et de l'aide sans « qui gagne ».
  Les idées de paris maison (« Qui gagne le tournoi de Mario Kart ? ») restent. 205 tests, 28 scénarios Edge.
* ✅ Page Activité refaite (« les pages d'activités sont pas dingue, des pauvres listes ; tu proposes quoi de mieux ? »,
  proposition avec maquette validée : « Oui, lots A et B »). Lot A : le fil jour par jour (« Aujourd'hui », « Hier »,
  « Dimanche 1er novembre ») ; chaque résultat en carte (écussons et score final, réponse gagnante et cote, points de
  chacun, « raté », prime d'arbitre) ; plusieurs résultats d'une compétition le même jour en une seule carte avec le
  bilan de chacun (« Simon 8/19 · +1 479 pts ») et la liste dépliable ; les pronostics d'une même personne regroupés
  (« Simon a parié sur 11 paris », chaque pari et son choix, changements d'avis signalés) ; les nouveaux paris en une
  ligne (« 40 nouveaux paris · NBA 14, NHL 10… · Parier ») ; les commentaires en bulle ; plus de « pronostics clos » ni
  de résultat officiel en double. Lot B : « À la une » (depuis 24 h : paris réglés, gains de chacun, coup de flair à
  partir d'une cote ×2,5, leader de chaque classement qui a bougé et « passe en tête » s'il double quelqu'un,
  champions sacrés) ; filtres Tout / Résultats / Pronos / Discussions. Sur la vraie base (copie) : 18 éléments pour tout
  l'historique au lieu de 60 lignes pour quelques heures. 207 tests, 28 scénarios Edge (capture 14).
* ✅ **En ligne** le 2026-11-03 à 11 h 08, avec les titres « sport · compétition · rencontre » et les thèmes de la session
  « Maquettes UI/UX » (redémarré avec l'accord de l'utilisateur, base sauvegardée dans `data/backups/`). Migration v13
  appliquée à la vraie base : plus aucun « qui gagne » (226 paris renommés) ; 227 paris, 210 pronostics, 2 groupes intacts.

### 2026-11-03 : 4 sections, choix visible au direct, supprimer son groupe, commentaires désactivables

* ✅ « Ne mentionne pas MonPetitProno sur la page de /groups, on va m'accuser de plagiat » : plus aucune mention d'une
  autre app (page d'accueil du site, aide, README, docs, commentaires du code, noms des tests).
* ✅ Liste des paris en 4 sections, les vides cachées : « À parier » (pas encore parié, clôture la plus proche d'abord),
  « Pariés » (choix fait, modifiable jusqu'à la clôture ; aussi les paris que j'arbitre), « Clos » (plus rien ne change :
  d'abord ce qui m'attend, trancher ou voter, puis les matchs en direct, puis les résultats attendus) et « Terminés ».
  Une phrase sous chaque titre dit ce qu'on y trouve.
* ✅ Page Direct : mon choix se voit sur le match (l'équipe entourée, pastille « Ton choix », en vert s'il passe, en rouge
  sinon ; « Nul · ton choix » au centre) au lieu de la phrase « Ton prono : … ».
* ✅ Un admin du groupe le supprime (Réglages du groupe → « Supprimer le groupe », en retapant son nom, sans tenir compte
  des majuscules) : tout disparaît pour tous ses membres, leurs comptes et leurs autres groupes restent ; noté dans le
  journal de l'admin du site.
* ✅ Réglage « 💬 Commentaires sur les paris » (Points, délais et commentaires ; aussi dans l'admin du site) : désactivés,
  plus personne ne commente (403) et ils disparaissent de la fiche d'un pari, de la page Activité et de la colonne de
  l'accueil ; réactivés, ils reviennent (rien n'est effacé). 209 tests, 29 scénarios Edge (capture 55).
* ✅ **En ligne** le 2026-11-03 à 11 h 26 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de migration) :
  le site public sert la nouvelle version (plus aucune mention d'une autre app) ; 227 paris, 227 pronostics, 2 groupes intacts.

### 2026-11-03 : un joueur remplacé avant le match (forfait)

* ✅ Retour : « problème avec ce pari, pas les bons noms entre matchup et proposition » (Tsitsipas – Tien). Tsitsipas a
  déclaré forfait et un repêché (Vallejo) a pris sa place sous le même numéro de match chez ESPN : le pari proposait
  toujours Tsitsipas, mais son visuel était réécrit avec Vallejo. Maintenant, pour les rencontres à deux (tennis, MMA,
  padel : `matchup`) : l'ouverture automatique voit l'affiche changer et annule le pari (« Forfait avant le match :
  Stefanos Tsitsipas remplacé par Adolfo Daniel Vallejo », aucun point), son visuel garde l'affiche d'origine ; si le
  remplacement arrive trop tard, le résultat annule le pari au lieu de le régler sur un joueur absent (avant, il plantait
  ou donnait le joueur absent perdant) ; les paris déjà réglés retrouvent leur affiche (`repairMatchups`). Sur la vraie
  base : 4 paris concernés (Tsitsipas – Tien et Davidovich Fokina – Kouame à 12 h 30, Parsons – Henrique à l'UFC du
  7 novembre, et Merida – Blockx, déjà réglé le 2 novembre alors que Blockx n'a pas joué). 212 tests, 29 scénarios Edge.
* ✅ **En ligne** le 2026-11-03 à 11 h 39 (redémarré avec l'accord de l'utilisateur, base sauvegardée) : dès la première
  ouverture automatique, les 3 paris ouverts concernés sont annulés avec leur motif et les 4 retrouvent leur affiche ;
  aucun autre pari annulé. Merida – Blockx reste réglé (correction possible par un admin du groupe).

### 2026-11-03 : page Configuration (nom, adresse publique, textes, icône)

* ✅ Demande : le projet devient open source sous le nom **PariTenu** ; chaque installation se personnalise dans l'admin.
  Nouvelle page **⚙️ Configuration** de `/admin` (remplace Apparence, dont l'adresse y mène) : nom et nom court,
  adresse publique, accroche, présentation et note de pied de page de l'accueil, hébergeur, icône (PNG recadré au carré
  et décliné en 32, 180, 192, 512 et « maskable »), thèmes. Aperçu en direct (onglet, nom sous l'icône, lien
  d'invitation), journal `branding_changed` / `icon_changed`.
* ✅ Le serveur écrit le nom dans la coquille (`<title>`, description, nom sous l'icône, icônes, `<meta name="instance">`)
  et le manifeste ; l'app, l'admin, les partages, l'aide et le message « il faut un coupon » le reprennent. L'adresse
  publique ne sert qu'aux liens (invitation, coupon, partage d'un pari) : aucune redirection ; ses requêtes passent le
  contrôle d'origine et gardent le cookie `Secure` derrière un proxy. Pied de page : « Propulsé par PariTenu, logiciel
  libre » (une fois renommée) et « Hébergé par … ». Service worker `pari-tenu-v3`.
* ✅ 215 tests (3 nouveaux : réglages partout et texte échappé, origine publique et cookie, icône) et 30 scénarios Edge
  (« configuration » : renommer en « Paris entre Couilles », icône, accueil et aide d'un visiteur, lien d'invitation
  partagé sur `https://paris.entrecouilles.fr`, puis retour aux valeurs d'origine ; captures 64 à 66). Vu sur les
  captures et corrigé : champs d'adresse au style des autres champs ; bandeau de l'admin sur deux lignes sous 1500 px
  (un nom long ne pousse plus le menu hors de l'écran).
* ✅ **En ligne** le 2026-11-03 à 12 h 43 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de
  migration) : coquille, manifeste et admin servis par le serveur, service worker `pari-tenu-v3`, aucune erreur dans
  Edge (téléphone et PC) ; 2 groupes, 227 paris, 227 pronostics intacts. Valeurs encore par défaut (« Pari tenu ! »).
* ⏳ Régler notre installation dans `/admin` → Configuration : « Paris entre Couilles », « EntreCouilles », hébergeur
  Duck Platform ; l'adresse publique `https://paris.entrecouilles.fr` seulement une fois le domaine branché sur le
  serveur (sinon les liens d'invitation mèneraient nulle part).
* ⏳ Mise en ligne sur `paris.entrecouilles.fr` (cPanel : hébergement, proxy, HTTPS).
* ⏳ Préparation open source : licence, README sans adresse personnelle, `.env.example`, lien du dépôt (`PROJECT_URL`).

### 2026-11-03 : des adresses sans #, l'accueil du site, Mes groupes et la création à part

* ✅ Questions : « pourquoi la page par défaut est /#/groups et pas /, et pourquoi il y a un # ? » Réponse : un routeur
  « à # » (le serveur ne connaissait que 3 pages) ; `/` sautait au dernier groupe, l'accueil n'était visible qu'en
  `/#/groups`. Proposition validée, création de groupe sur `/groups/new` (choix de l'utilisateur).
* ✅ Vraies adresses : `/`, `/groups`, `/groups/new[/<coupon>]`, `/aide[/<section>]`, `/<groupe>/…` (16 caractères
  hexadécimaux), servies par le serveur avec la même coquille ; liens internes sans rechargement (pushState) ; anciennes
  adresses `/#/…` converties ; `/c/<coupon>` redirigé vers `/groups/new/<coupon>` ; l'admin du site garde ses `#`.
  Service worker `pari-tenu-v4`.
* ✅ `/` : l'accueil du site (principe, sports, points forts), sans formulaire, même connecté ; l'app installée s'ouvre
  toujours sur le dernier groupe. `/groups` : compte et groupes seulement. `/groups/new` : le formulaire, coupon rempli
  par son lien puis retiré de la barre d'adresse.
* ✅ Retour en cours de route : « virer le bouton Créer ou rejoindre… je ne veux pas de lien cliquable vers la page de
  création de groupe ». Aucun lien de l'app n'y mène plus (menu, accueil, Mes groupes, page Moi) : seulement le lien d'un
  coupon. Textes corrigés au passage : l'aide (« en créer d'autres sans code ») et la page Moi (« se connecter depuis
  l'accueil »).
* ✅ 216 tests (adresses servies, redirection des anciens coupons, 404 ailleurs) et 30 scénarios Edge (accueil sans
  formulaire ni lien de création, Mes groupes, création par l'adresse du coupon, app installée vers le dernier groupe,
  ancienne adresse en `#/` ; captures 00, 29).
* ✅ **En ligne** le 2026-11-03 à 13 h 18 (redémarré avec l'accord de l'utilisateur, base sauvegardée, pas de
  migration) : vérifié dans Edge par le lien public (téléphone et PC) : `/` sans formulaire ni lien de création,
  `/#/groups` → `/groups`, liens internes sans rechargement, `/c/…` redirigé, service worker `pari-tenu-v4`, aucune
  erreur. Base : 1 groupe (l'utilisateur a supprimé « Les burnes » lui-même à 13 h 16), 227 paris, 227 pronostics.

### 2026-11-03 : toutes les adresses en anglais

* ✅ Demande : « revois toutes les routes pour les faire correspondre à des termes anglais, /admin/users, /admin/groups…
  seuls les textes sont français ». App : `/help[/<section>]` (sections en anglais), `/invite/<jeton>[?bet=<id>]`,
  `/<groupe>/members/<id>`. Admin du site sans `#` : `/admin/users`, `/admin/groups[/<id>[/edit]]`, `/admin/coupons`,
  `/admin/sources`, `/admin/configuration`, `/admin/log` (liens internes sans rechargement). L'API l'était déjà.
* ✅ Aucun lien cassé : le serveur redirige `/g/…?pari=` → `/invite/…?bet=`, `/aide/…` → `/help/…`, `/c/…` →
  `/groups/new/…` ; l'app convertit `/#/…`, `/<groupe>/m/…` et les anciens noms de section de l'aide ; l'admin convertit
  `/admin#/comptes…` (et `#/apparence`). Service worker `pari-tenu-v5`.
* ✅ 216 tests (adresses de l'app et de l'admin, redirections) et 30 scénarios Edge (dont les anciennes adresses).
* ✅ **En ligne** le 2026-11-03 à 14 h 10, avec la nouvelle admin (ci-dessous). L'ensemble vérifié ensuite : 218 tests,
  30 scénarios Edge, et par le lien public dans Edge (redirections `/aide`, `/g/…?pari=`, `/c/…` ; `/#/aide/installer`
  → `/help/installer` ; `/admin#/comptes` → `/admin/users` ; aucune erreur) ; base intacte (1 groupe, 227 paris).

 (l'accueil seul) et ce qu'il faut pour l'afficher, `Disallow: /` pour tout le reste ;
  `X-Robots-Tag: noindex, nofollow` sur toutes les réponses sauf l'accueil (pages, redirections, API, images).
* ✅ 219 tests (en-tête sur chaque type d'adresse, contenu de robots.txt) et 30 scénarios Edge.
* ✅ **En ligne** le 2026-11-03 à 15 h 01 (redémarré avec l'accord de l'utilisateur, base sauvegardée ; le serveur lancé
  par la session Maquettes, PID vérifié, arrêté seul) : `/robots.txt` servi, `noindex, nofollow` partout sauf sur
  l'accueil (vérifié par le lien public sur 10 adresses) ; base intacte.

### 2026-11-03 : nouvelle admin du site (Sobre le jour, Cockpit la nuit)

* ✅ Demande : « l'admin UI non plus c'est pas une dinguerie ». Maquettes avec le skill ui-ux-pro-max
  (`docs/maquettes/admin/` : avant/après, deux directions sur la même structure) ; choix de l'utilisateur : **Sobre +
  Cockpit la nuit**. Sobre (clair, Inter) et Cockpit (sombre, Fira Sans et Fira Code) suivent le mode de l'appareil,
  polices servies par l'app (`public/fonts/admin/`).
* ✅ Structure : menu à gauche en trois blocs (Suivi, Joueurs, Site) avec compteurs et pastilles ; sur téléphone, barre
  du bas (Accueil, Comptes, Groupes, Coupons, Plus). Recherche partout (Ctrl K ou la loupe) : comptes, groupes,
  coupons, pages. Icônes au trait au lieu des emoji ; titres droits.
* ✅ Vue d'ensemble : **« À traiter »** d'abord (compte bloqué avec son bouton Débloquer, PIN pas encore choisi, source
  sans clé ou qui ne répond plus depuis une heure, coupon qui expire sous 3 jours, groupe vide ou sans pari 3 jours
  après sa création ; liste vide = tout va bien), puis les chiffres avec leur tendance (+N comptes en 7 jours, paris qui
  ferment dans les 24 h, pronostics des 14 derniers jours en barres), les groupes les plus actifs et le journal.
* ✅ Listes denses et triables, toute la ligne s'ouvre ; sur téléphone, une ligne par élément au lieu d'une carte de
  6 lignes. La fiche d'un compte s'ouvre à droite de la liste (à sa place sur téléphone). Une action principale par
  page, le reste dans « ⋯ », supprimer à part (« Zone sensible »). Un groupe en onglets (Membres, Classements,
  Réglages), avec l'invitation et ses infos à côté. Sources : des interrupteurs rangés par type, et **« lue il y
  a … »** (nouveau : `SourceService.health`, en mémoire, la dernière lecture réussie et depuis quand une source ne
  répond plus). Configuration en onglets (Identité avec son aperçu, Page d'accueil, Icône, Thème), barre
  d'enregistrement dès qu'un champ change. Journal filtrable, sessions admin ouvertes sur la même page.
* ✅ API : `/api/admin/overview` gagne `attention`, `newPlayers`, `closingSoon`, `groupsWithoutBets`, `picksByDay`,
  `activeGroups` ; `/api/admin/nav` (compteurs du menu) ; `/api/admin/log` rend aussi les sessions ;
  `/api/admin/sources` donne `readAt`, `failingSince`, `error`, `keyName`. Pas de migration.
* ✅ 218 tests (dont « à traiter » qui disparaît une fois réglé, et la lecture d'une source qui tombe puis revient).
* ✅ **En ligne** le 2026-11-03 à 14 h 10 (accord de l'utilisateur ; base sauvegardée avant,
  `data/backups/paritenu-2026-11-03T13-10-41-588Z-avant-nouvelle-admin.db`, 227 paris, intacte ; pas de migration,
  schéma 13). Vérifié dans Edge par l'adresse publique : connexion de l'admin en clair (Inter) et en sombre (Fira
  Sans), polices servies par l'app, accueil de l'appli, aucune erreur. « Lue il y a … » attend la prochaine lecture de
  chaque source (la santé des sources n'est gardée qu'en mémoire).
* 🧪 La vraie admin connectée (avec le mot de passe de l'utilisateur) : à regarder sur son PC et son téléphone.

### À vérifier en vrai

* 🧪 Les thèmes sur de vrais téléphones (polices, flou d'Arène sur un vieil Android).
* ✅ Accès public par Tailscale Funnel (port 8443), vérifié depuis Internet le 2026-10-30 : HTTPS valide, page et
  service worker chargés dans Edge, contrôle d'origine et code d'instance actifs derrière le relais.
* 🧪 Premier vrai groupe sur les téléphones des amis (connexion, cookie Secure sur `*.ts.net` testé seulement en local).
* 🧪 Installation sur l'écran d'accueil d'un vrai iPhone et d'un vrai Android (manifeste et service worker testés dans Edge).
* 🧪 Partage natif vers WhatsApp sur téléphone (simulé dans les tests).

## V1.1 — 2026-10-30 : réglages des paris et paris tout prêts

* ✅ Page « Réglages des paris » (admins) : types Oui / Non et choix multiples, catégories (activer, renommer, ajouter),
  sources de données par catégorie (couper, régler).
* ✅ Paris tout prêts à résultat automatique, sources gratuites sans clé : football (ESPN, 7 compétitions), Formule 1
  (Jolpica), cryptos (Coinbase), météo (Open-Meteo, ville au choix), questions d'actualité (Manifold).
* ✅ Résultat proposé par la source (validation 24 h, contestation, vote) ; événement reporté : pari annulé ; source
  muette : un admin tranche au bout de 24 h ; bouton « Vérifier le résultat ».
* ✅ Tests : 109 tests `node:test` (dont 33 nouveaux, sur de vraies réponses capturées) + 22 scénarios Edge.
* ✅ Vérifié en direct le 2026-10-30 : les 5 sources répondent (28 matchs, GP du Mexique, BTC/ETH, 7 jours de météo,
  28 questions) et un vrai score est bien lu (PSG 2 – 0 Lyon).

### À vérifier en vrai

* 🧪 Premier pari tout prêt réglé de bout en bout avec un vrai événement (match, relevé météo…). En cours : Le Havre –
  PSG (1 – 5) résolu tout seul le 2026-10-30 à 21 h 17 ; points attendus à la fin de la validation, le 31 à 21 h 17.
* 🧪 L'API d'ESPN n'est pas documentée : surveiller qu'elle ne change pas (sinon passer à football-data.org, clé gratuite).

## V1.2 — 2026-10-30 : Grands Prix moto

* ✅ Source « Grands Prix moto » (MotoGP.com, gratuite, sans clé), catégorie Sport : MotoGP par défaut, Moto2 et Moto3
  au choix. Sur les 2 prochains Grands Prix : vainqueur de la course et du sprint (7 favoris + « Un autre pilote »),
  « le leader gagne ? », « un Français sur le podium ? » (si un Français court dans la catégorie).
* ✅ Heures de départ prises dans le calendrier officiel (fuseau du circuit) ; course ou sprint annulé : pari annulé.
* ✅ Catalogue : l'heure de clôture de chaque pari s'affiche quand elles diffèrent dans un même événement.
* ✅ Tests : 112 tests `node:test` (dont 3 sur de vraies réponses MotoGP capturées) + 22 scénarios Edge.
* ✅ Vérifié en direct le 2026-10-30 : GP de Malaisie et du Qatar (16 paris en MotoGP, Moto2, Moto3, départs à la bonne
  heure de Paris), victoire de Bezzecchi en Indonésie et course Moto3 annulée en Australie bien lues.

### À vérifier en vrai

* 🧪 Premier pari moto réglé de bout en bout (GP de Malaisie : sprint le 31 octobre, course le 1er novembre).
* 🧪 L'API de MotoGP.com n'est pas documentée : surveiller qu'elle ne change pas.

## V2 — 2026-10-30 : classements par compétition et par saison, paris automatiques, tous les sports

* ✅ Classements : un par compétition (Ligue 1, NFL, F1…) et un par catégorie, plus de classement général ni mensuel.
* ✅ Vraies saisons : dates officielles des compétitions (ESPN, calendriers F1 et MotoGP ; date fixe si les dates sont
  incohérentes, ex. Top 14) ; printemps, été, automne, hiver pour les catégories (équinoxes et solstices calculés).
* ✅ Fin de saison : champion sacré quand les derniers paris sont réglés (35 jours au plus), classement figé, annonce dans
  le fil, badge 🏆, remise à zéro ; historique des saisons, de leurs champions et de leurs paris.
* ✅ Paris ouverts tout seuls pour les compétitions activées (rien d'activé d'office) : au réglage puis toutes les
  30 minutes ; paris jamais joués supprimés à la clôture ; compétition coupée : ses paris sans pronostic retirés.
* ✅ Nouveaux sports (ESPN) : football américain, rugby, basket, hockey, baseball, tennis, MMA, football australien ;
  foot élargi à 33 compétitions.
* ✅ Un seul pari par match ou par course, sur le résultat (« qui gagne ? ») : plus de « buts », « les deux équipes
  marquent », total de points, « le leader gagne ? » ni « Français sur le podium ? ». Les paris de ce genre déjà ouverts
  et jamais joués sont retirés au démarrage ; ceux qui ont des pronostics sont réglés normalement.
* ✅ Migration v3 de la base (table des paris reconstruite, table des saisons) vérifiée sur une copie de la vraie base.
* ✅ Tests : 124 tests `node:test` + 22 scénarios Edge.
* ✅ Vérifié en direct le 2026-10-30 : 230 paris ouverts en 3 s (Ligue 1, Ligue des champions, NFL, Top 14, NBA, ATP,
  UFC, F1, MotoGP, météo), dates de saison officielles lues, aucun doublon à la passe suivante.

### À vérifier en vrai

* 🧪 Première fin de saison réelle (F1 et MotoGP en décembre 2026, Automne 2026 le 21 décembre).
* 🧪 Charge sur ESPN si beaucoup de compétitions sont activées (une requête par compétition et par jour, toutes les 30 min).

## V3 — 2026-10-30 : barème à cote fixe, plusieurs groupes, compétitions suivies, design sportif

* ✅ Paris sportifs : cote fixe des bookmakers (DraftKings via ESPN : foot, NFL, NBA, NHL, MLB…), sinon barème fixe
  (200 pts) ; 100 × la cote, connue avant de parier ; jamais de cote à 1, ni d'annulation faute de participants.
* ✅ Un joueur dans plusieurs groupes (cookie de l'appareil) : un pronostic vaut dans tous ses groupes où le même pari
  est ouvert (même s'il s'ouvre plus tard), classements propres à chaque groupe ; créer d'autres groupes sans code.
* ✅ Compétitions proposées par le groupe, chacun choisit d'y participer : sinon leurs paris ne s'affichent pas chez lui.
* ✅ Design sportif (ambiance stade), nouvelle icône, avatars sportifs (sports, joueurs, 26 drapeaux SVG, maillot à composer).
* ✅ Tablette (grille) et PC (barre latérale, mes groupes, classement sur deux colonnes).
* ✅ Page d'accueil du site et aide (#/aide).
* ✅ Migration v4 vérifiée sur une copie de la vraie base ; membres existants rattachés à un joueur à leur prochaine visite.
* ✅ Tests : 133 tests `node:test` + 23 scénarios Edge (dont un sur PC 1366 × 860).

### Correctif du 2026-10-30 : paris maison et compétitions réglés à part

Signalé : « pourquoi j'ai un bouton nouveau pari quand aucune catégorie manuelle n'est activée ? ». Il fallait activer
la catégorie Sport pour recevoir la Ligue 1 et la moto, ce qui autorisait aussi les paris maison de sport.

* ✅ L'interrupteur d'une catégorie ne règle plus que ses **paris maison** ; les compétitions et sources se règlent à part.
* ✅ Aucune catégorie de paris maison : pas de bouton « Nouveau pari » (téléphone et PC), formulaire remplacé par une
  explication, accueil vide qui renvoie vers les compétitions ; le serveur refuse aussi ces paris.
* ✅ Migration v5 : une catégorie activée seulement pour ses compétitions (aucun pari maison dedans) perd ses paris
  maison. Essayée sur une copie de la vraie base : « feu de camp » n'a plus de paris maison, la Ligue 1 et la moto
  restent actives.
* ✅ Tests : 136 tests `node:test` (dont la migration v5) + 23 scénarios Edge.

### 2026-10-31 : paris de sport en images, scores en direct, page Direct

Demande : « un pari plus visuel que textuel, plutôt que de lire Paris – Auxerre : qui gagne ? 2000 fois ; les scores en
live dans chaque pari, plus visibles, idem pour les scores finaux ; sinon une page live des rencontres et paris du jour ».

* ✅ Cartes de match : écussons et noms des équipes (ESPN), photos ou drapeaux des joueurs (tennis, MMA), heure, puis
  score en grand et chrono en direct (« 62' », « Mi-temps », quart-temps, période, manche, set, round), puis score final.
* ✅ Courses (MotoGP, Moto2, Moto3, F1) : tuiles des pilotes avec photo officielle recadrée sur le visage, numéro et
  couleur d'équipe (MotoGP.com, OpenF1), podium à l'arrivée.
* ✅ « Ton prono passe / ne passe pas » pendant le match, « Bien vu / Raté » ensuite ; section « En direct » en tête de
  l'accueil, mise à jour toute seule.
* ✅ Onglet « 📺 Direct » : hier, aujourd'hui, demain ; en direct, à venir, terminés ; bilan du jour.
* ✅ Direct relu chaque minute pendant les matchs seulement, une requête par compétition et par jour pour tous les groupes.
* ✅ Images relayées par l'app (liste blanche, aucune requête des téléphones chez ESPN ou MotoGP), réduites et gardées
  sur disque : photo MotoGP 4 Mo → 35 Ko.
* ✅ Migration v7 (table `source_events`) essayée sur une copie de la vraie base : logos des 10 matchs de Ligue 1 de
  « feu de camp », score final de Le Havre – PSG (1 – 5) relu tout seul.
* ✅ Tests : 147 tests `node:test` (dont 6 sur les visuels et le direct) + 25 scénarios Edge (dont un sur le direct et
  la page Direct) ; vérifié aussi avec les vraies sources (logos de Ligue 1, photos MotoGP, joueurs de l'ATP).
* ✅ **En ligne** le 2026-10-31 à 10 h 28 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/paritenu-avant-v7-2026-10-31.db`) : migrations v6 et v7 sur la vraie base sans erreur, visuels des
  16 paris ouverts de « feu de camp », score final de Le Havre – PSG (1 – 5) relu tout seul par le serveur, images
  servies par le site public (logo 7 Ko, photo MotoGP 35 Ko).

### Correctifs du 2026-10-31

* ✅ Maillot : numéro limité à deux chiffres (champ et serveur) et dessiné dans le t-shirt.
* ✅ Un groupe neuf n'a rien d'activé (types, catégories de paris maison, compétitions) ; les types ne règlent plus que
  les paris maison (les compétitions s'ouvrent sans).
* ✅ Pseudo et avatar uniques à chaque joueur, les mêmes dans tous ses groupes : repris pour créer ou rejoindre un
  groupe, modifiables dans « Moi » (changés partout). Migration v6 : le dernier choix de chacun gagne partout (sur la
  vraie base : « toto » devient « sqdsqds » au maillot n° 10 dans « feu de camp »).

* ✅ Padel (demande du 2026-10-31) : source « Padel » (Premier Padel : Major, P1, P2, Finals ; messieurs et dames, un
  classement chacun), par [Padel API](https://padelapi.org), gratuite avec une clé personnelle (`PT_PADEL_TOKEN` dans
  `.env`, 10 requêtes par minute) : matchs du tableau principal dès que l'horaire est connu, « qui gagne ? » entre les
  deux paires, sets en direct, vainqueur ; forfait avant le match : annulé. L'API officielle de Premier Padel répond
  mais ne publie aucun match (même pendant le Kuwait Major) ; SofaScore bloque les appels. 4 tests sur un faux Padel API
  écrit d'après la documentation.
* ✅ Padel vérifié avec la vraie API (clé dans `.env`, serveur redémarré à 13 h 32 avec l'accord de l'utilisateur) :
  tournois, matchs, horaires (ISO avec fuseau), sets et vainqueur au format attendu, rien à corriger. Les deux finales
  du Kuwait Major proposées ; la finale messieurs (17 h) ouverte dans un groupe. Le direct point par point est payant
  (`/matches/:id/live` : 402).
* ✅ Page d'accueil : la liste des sports (et les nombres de sports et de compétitions) vient du serveur, d'après les
  sources disponibles sur l'instance (le padel n'y est qu'avec sa clé) : elle suit toute seule les ajouts.
* ✅ Un compte par joueur (demande du 2026-10-31, « on a un compte dans chaque groupe ? ») : un pseudo unique sur
  l'instance, un avatar et un PIN, une connexion par appareil, valables dans tous ses groupes. Connexion depuis l'accueil
  (« Me connecter ») ou le lien d'un groupe (toucher son avatar remplit le pseudo) ; connecté, on entre dans un groupe
  d'un geste et on en crée un avec un nom et un emoji. Blocage du compte après 5 PIN faux, de plus en plus long (15 min,
  30 min… 24 h). PIN oublié : un admin de chacun de ses groupes doit le réinitialiser, puis le joueur en choisit un
  nouveau depuis le lien d'un groupe. Migration v8 : comptes créés pour tous, pseudos en double numérotés, sessions de
  groupe reprises (personne n'est déconnecté), PIN différents d'un groupe à l'autre : le premier tapé devient celui du
  compte. 151 tests et 26 scénarios Edge.
* ✅ Réglages du groupe (demande du 2026-10-31 : « avec un engrenage à côté de son nom dans le menu de gauche, pas via
  mon profil ») : ⚙️ à côté du nom de chaque groupe dont on est admin dans le menu de gauche (allumé sur ses réglages),
  dans l'en-tête du groupe sur téléphone ; la page devient « ⚙️ Réglages du groupe » (retour vers le groupe) et quitte
  « Moi ». Interface seule : en ligne dès le rechargement de la page.
* ✅ **Compte unique en ligne** le 2026-10-31 à 14 h 16 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : la migration v8 s'était déjà appliquée à 13 h 41, le serveur ayant été relancé à la main pendant le
  développement (même résultat que sur la copie : trois comptes, « sqdsqds » garde ses trois PIN de groupe jusqu'à sa
  prochaine connexion). Site public vérifié dans Edge : 12 sports et 63 compétitions sur l'accueil, padel compris,
  formulaire « J'ai déjà un compte », sans erreur ni débordement.
* ✅ Finale du Kuwait Major suivie en vrai (2026-10-31) : « 🔴 En cours » relu à 17 h 17, mais pas de score pendant le
  match en offre gratuite (score vide, « hidden_free_plan ») ; « Terminé » à 18 h 15 sans les sets, puis 6-1 6-1 et le
  pari réglé à 20 h 01 (vérification du résultat à l'heure prévue). Corrigé : « Terminé » sans score n'arrête plus la
  relecture du direct tant que le pari attend son résultat (le score final s'affiche dès que la source le donne).
  152 tests. En ligne le 2026-11-01 à 10 h 19 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`).
* ✅ Premier match de foot suivi en vrai (Troyes – Le Mans, 2026-10-31, 20 h 45) : le serveur en ligne relit le score
  chaque minute (0 – 0 à la 1re, à la 2e…), une seule fois pour les trois groupes qui ont le pari. Page Direct vérifiée
  avec ces vraies données (copie de la base, taille téléphone, sans erreur) : deux matchs en direct avec logos, score
  et prono (« ne passe pas »), la finale de padel dans « Terminés » (2 – 0, 6-1 6-1, « bien vu »). Suite du match relue
  en vrai : 1 – 0 (34e), mi-temps, 2 – 0 (73e), « Terminé » 2 – 0 dès 22 h 41 ; les trois paris réglés à 23 h 02
  (« Victoire Troyes », en validation 24 h).
* ✅ Titres de page explicites (onglet, historique, sélecteur d'applis) : « page · détail · groupe — Pari tenu ! », par
  exemple « Ligue 1 · Troyes – Le Mans · feu de camp — Pari tenu ! » ou « Classement Ligue 1 · Le vestiaire — Pari tenu ! ».

### 2026-11-01 : admin du site et coupons de création de groupe

* ✅ Admin du site `/admin` (demande : « une admin UI sécurisée simple avec CRUD user, groups… + quick boutons utiles ;
  un coupon généré via l'admin à la place du code du .env, suivi, qui expire après utilisation ») : tableau de bord,
  comptes, groupes, coupons et journal, sur PC et téléphone (§ 7.14 du cahier des charges).
* ✅ Mot de passe choisi sur le serveur (`npm run admin`), blocages croissants, sessions de 2 h (12 h au plus), cookie
  réservé à `/api/admin`, journal de chaque action et connexion. Migration v9 (coupons, admin_auth, admin_sessions,
  admin_log).
* ✅ Créer un groupe demande un coupon à usage unique, même connecté ; le lien `/c/<code>` remplit le formulaire.
  `PT_INSTANCE_CODE` ne sert plus (le serveur le signale au démarrage s'il est encore dans `.env`).
* ✅ 167 tests (dont 13 pour l'admin et 3 pour les coupons) et 27 scénarios Edge (dont l'admin de bout en bout : mot de
  passe, coupon, son lien, refus d'un coupon déjà servi, suivi, fiche du groupe et du compte, journal, téléphone).
* ✅ **En ligne** le 2026-11-01 à 14 h 38 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : migration v9 appliquée à la vraie base (intègre, 67 paris, 3 comptes, 4 groupes). Site public vérifié
  dans Edge : `/admin` (no-store, noindex), lien `/c/<code>` qui remplit le coupon, création sans coupon refusée, aucune
  erreur ni débordement. Mot de passe admin choisi par l'utilisateur sur le serveur à 14 h 39, connexion réussie.

### 2026-11-01 : le résultat officiel ne se conteste plus

* ✅ Question de l'utilisateur : « pourquoi on a le droit de contester un pari, sachant que le résultat vient d'une
  source ? ». Un pari réglé par une source l'est aussitôt : points dès le résultat officiel, ni validation de 24 h, ni
  contestation, ni vote. Une erreur de la source : un admin du groupe corrige (« Corriger le résultat »). Les paris
  maison gardent arbitre, 24 h, contestation et vote.
* ✅ Le résultat est demandé dès que le direct annonce la fin avec le score final (hier, Troyes – Le Mans fini à 22 h 41
  n'était réglé qu'à 23 h 02, puis attendait 24 h de plus). Migration v10 : les paris de source encore en validation sont
  réglés (essayée sur une copie : Troyes – Le Mans réglé, daté du 31 à 23 h 01). 169 tests, 27 scénarios Edge.
* ✅ **En ligne** le 2026-11-01 à 14 h 53 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : v10 appliquée, Troyes – Le Mans réglé aussitôt dans « Le vestiaire » (Simon +225 pts, daté du 31 à
  23 h 01) ; le site public sert les nouveaux textes (fiche d'un pari, aide).

### 2026-11-01 : classements et sources dans l'admin

* ✅ Demande : « voir les classements de groupe dans l'admin ; pouvoir activer ou désactiver certaines sources externes
  de manière globale ». Fiche d'un groupe : ses classements (une puce par compétition ou catégorie, son meneur, la
  saison au choix, le classement complet). Nouvelle page « 📡 Sources » : couper ou rallumer une source pour tous les
  groupes (paris sans pronostic retirés, paris joués jusqu'au bout, réglages des groupes gardés), clé manquante signalée,
  chaque changement au journal. Migration v11 (`instance_settings`). 172 tests, 27 scénarios Edge (captures 48 et 49).
* ✅ **En ligne** le 2026-11-01 à 16 h 11 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : v11 appliquée, aucune source coupée (les 15 restent proposées) ; les nouvelles routes de l'admin
  répondent 401 sans session, en local comme par le Funnel.

### 2026-11-01 : modifier tous les réglages d'un groupe depuis l'admin

* ✅ Demande : « configurer les settings des groupes depuis l'admin UI dans la partie Modifier ». « ✏️ Modifier » ouvre
  une page avec tout ce que règle l'admin du groupe (nom, emoji, points et délais, types, catégories, compétitions,
  ville de la météo), enregistré d'un coup ; la fiche montre les réglages en un coup d'œil ; le journal dit ce qui a
  changé. Éditeur des réglages partagé avec les pages de l'admin du groupe (`public/js/settings-editor.js`). Au
  passage, sur PC, le titre « Paris ouverts tout seuls » ne laisse plus une colonne vide. 173 tests, 27 scénarios Edge
  (captures 50 et 51).
* ✅ **En ligne** le 2026-11-01 à 16 h 56 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`) : pas de migration (base toujours en v11) ; les nouvelles routes de l'admin répondent 401 sans
  session, en local comme par le Funnel, et le site public sert le nouvel éditeur sans erreur.

### 2026-11-01 : le match en détail (lots 1 et 2)

* ✅ Demande : « quelques stats sur les matchs de foot dans le live ou sur la page de détails, genre qui a marqué et
  quand, les cartons jaune/rouge ; les mêmes adaptations sur les autres sports ; fais une proposition pour chaque sport
  avant de modifier ». Proposition en deux lots ; lot 1 (aucune requête de plus) fait : bloc « 📋 Le match » sur la
  fiche (chronologie des buts, essais et cartons ; scores par période ; statistiques comparées ; meilleurs joueurs ;
  situation de jeu en NFL et au baseball ; fin d'un combat et bilans au MMA) et « 🏁 Classement » complet d'une course
  (F1, MotoGP) ; ligne courte sous chaque match de la page Direct (buteurs, essais, 🟥, situation). « Terminé (prol.) »
  au hockey, au basket et en NFL. Testé sur de vraies captures (Strasbourg – Auxerre, Montpellier – Castres, NFL, NBA,
  NHL, MLB, UFC, GP des États-Unis, GP de Malaisie). 186 tests, 27 scénarios Edge (captures 52 et 53).
* ✅ **En ligne** le 2026-11-01 à 18 h 07 (redémarré avec l'accord de l'utilisateur, base sauvegardée dans
  `data/backups/`, pas de migration). Vu en vrai une minute après : deux matchs de Ligue 1 à la mi-temps, avec leurs
  buteurs (Sinayoko 38' et 44', Nuamah 38'), possession, tirs, tirs cadrés, corners et fautes.
* ✅ Retour : « aucune stat sur les paris passés » (Strasbourg – Auxerre, fini à 16 h 58, avant la mise en ligne). Une
  rencontre finie sans ses faits est maintenant relue une fois (tableau du jour d'ESPN, qui les garde) ; si la source
  n'en a pas, elle n'est plus redemandée. Couvre les 3 derniers jours. 187 tests, 27 scénarios Edge.
  En ligne le 2026-11-01 à 18 h 15 (serveur relancé par l'utilisateur après la correction, base sauvegardée) : dès
  18 h 16, Strasbourg – Auxerre (13 actions, cartons et statistiques) et Troyes – Le Mans (9 actions) ont leurs faits.
* ✅ Lot 2 (« go pour lot 2 », le résumé du match chez ESPN) : passeurs au foot (« passe : Oso » sous le buteur) ;
  chaque action qui marque en football américain (touchdown, field goal, safety, conversion défensive, en français :
  « passe de J. Love, 12 yards · transformation manquée ») ; buts au hockey avec leurs passeurs (supériorité,
  infériorité numérique, filet désert, prolongation, sans les tirs au but) et pénalités (« faire trébucher, 2 min »,
  plus discrètes que les buts). Ligne de la page Direct : buteurs au hockey, touchdowns et field goals. Le résumé n'est
  relu que quand le score ou la chronologie bouge, sinon toutes les 5 minutes (au lieu de chaque minute) ; injoignable,
  on garde ce qu'on avait. Les matchs des 3 derniers jours, lus avant, sont relus une fois pour leurs passeurs. Testé
  sur de vraies captures (Strasbourg – Auxerre, Panthers – Packers, quatre matchs NHL). 195 tests, 27 scénarios Edge.
  En ligne le 2026-11-01 à 20 h 35 (avec le pari d'un geste ci-dessous) : à 20 h 36, les 4 matchs du groupe ont été
  relus une fois et ont leurs passeurs (Paris FC – Monaco : Sinayoko sur passes de M. López et M. Simon, Balogun sur
  passe de Vanderson, Pagis sur passe de Sinayoko), sans nouvelle relecture ensuite.

### À vérifier en vrai

* 🧪 Situation de jeu en direct (NFL : qui attaque, tentative, yards ; baseball : retraits, bases, compte) : écrite
  d'après la forme documentée d'ESPN, à voir sur un vrai match en cours (NFL le dimanche soir, MLB au printemps).
* 🧪 Football australien et rugby à XIII : hors saison, à vérifier à la reprise (mars).
* 🧪 Premier coupon envoyé à un ami : groupe créé par son lien, coupon « utilisé » dans l'admin.
* 🧪 Premier match suivi en direct sur un vrai téléphone (le serveur et la page Direct sont vérifiés avec un vrai match
  le 2026-10-31 ; reste à le voir sur un téléphone, par le lien public).
* 🧪 Pronostic partagé entre deux vrais groupes, sur deux appareils.
* ✅ Cotes des bookmakers lues en vrai le 2026-10-30 après le redémarrage : les 7 matchs de Ligue 1 ouverts passent
  du barème fixe aux cotes DraftKings (ex. Lyon – Angers : ×1,41 / ×5 / ×7). Migration v4 appliquée à la vraie base,
  sans erreur de clé étrangère ; site public vérifié dans Edge (PC et téléphone, sans débordement ni erreur).

## Prochaine

* ⏳ Notifications push (nouveau pari, clôture proche, verdict, vote).
* ⏳ Photos : preuve jointe au verdict, illustration d'un pari.
* ⏳ Joker : doubler les points d'un pari, une fois par semaine.
* ⏳ QR code du lien d'invitation (écran Admin).

## V2

* ⏳ Plus de sources : Superbike (WorldSBK), télé-réalité, Pro D2, EuroLeague (pas de données gratuites trouvées) ; cotes des matchs (The Odds API, clé gratuite).
* ⏳ Mode « le plus proche gagne » (nombre, date, score).
* ⏳ Paris en direct pendant un match ou une émission.
* ⏳ Hébergement permanent (Docker + Caddy sur un petit serveur).

## V3

* ⏳ Cotes indicatives des bookmakers (The Odds API) et probabilités des marchés prédictifs (Manifold, Kalshi ;
  Polymarket est bloqué en France) affichées à côté des cotes du groupe.
