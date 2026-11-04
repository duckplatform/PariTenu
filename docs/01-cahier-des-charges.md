# Pari tenu ! : cahier des charges V1

> Version du document : 0.2 du 2026-10-29. Les paris sont gratuits : on ne mise rien et on ne fait que gagner des points.
>
> **Statut : V1 livrée le 2026-10-29 ; V1.1 (réglages des paris, paris tout prêts à résultat automatique, § 7.11) le
> 2026-10-30 ; V1.2 (Grands Prix moto) et V2 (classements par compétition et par saison, paris ouverts tout seuls,
> tous les sports, § 7.7 et § 7.11) le même jour ; V3 (barème à cote fixe, un joueur dans plusieurs groupes,
> compétitions suivies, design sportif, tablette et PC, site et aide, § 7.4, § 7.1, § 7.11, § 7.12) le même jour.** Ce qui est livré : [journal des modifications](../CHANGELOG.md) ; la suite : [feuille de route](04-roadmap.md).
> Le code fait foi pour les détails techniques : [docs/03-technique.md](03-technique.md) (par exemple, les badges sont
> calculés à la volée plutôt que stockés).

## 1. Le projet en une phrase

> **Une petite app web pour parier gratuitement entre amis sur tout et n'importe quoi, avec des paris que le groupe invente lui-même. Les bons pronostics rapportent des points, d'autant plus qu'ils sont rares, et un classement montre qui a le meilleur flair.**

## 2. Contexte

Entre amis, on parie déjà tout le temps : « je te parie qu'il sera en retard », « elle gagne Koh-Lanta, tu verras ». Mais ces paris se perdent dans le groupe WhatsApp : personne ne tient les comptes et on ne sait jamais qui avait raison.

Les applications existantes ne conviennent pas :

* **les sites de paris** (Winamax, Betclic…) : argent réel, sport uniquement, impossible de créer ses propres paris ;
* **les marchés prédictifs** (Polymarket, Manifold) : publics, en anglais, questions mondiales, rien sur la vie d'un groupe d'amis.

## 3. Objectifs et hors périmètre

### Objectifs de la V1

1. Créer un pari en moins d'une minute depuis son téléphone.
2. Parier en deux touches.
3. Calculer automatiquement les cotes et les points, sans erreur possible.
4. Un classement qui donne envie de revenir.
5. Rejoindre le groupe en moins de 30 secondes, sans créer de compte.

### Hors périmètre (volontairement)

| Exclu | Pourquoi |
|---|---|
| Argent réel, achat ou revente de points | Interdit en France hors agrément ANJ. Les points n'ont aucune valeur. |
| Mises en points, solde, points qu'on perd | Parier est gratuit : on choisit une option, c'est tout |
| E-mails, numéros de téléphone, inscription | Un lien, un pseudo et un code PIN suffisent (ils forment le compte du joueur, valable dans tous ses groupes) |
| Catalogue d'événements et résolution automatique | Avancé en V1.1 : voir § 7.11 |
| Cotes des bookmakers | Prévu en V3, à titre indicatif |
| Messagerie | Le groupe WhatsApp existe déjà : l'app s'y partage |
| Application native (stores) | Application web installable sur l'écran d'accueil (PWA) |

## 4. Principes de conception

1. **Gratuit, on ne perd jamais.** Parier ne coûte rien. Un bon pronostic rapporte des points, une erreur en rapporte zéro.
2. **Le groupe fait le contenu.** Les paris viennent des amis. L'app propose des idées, pas un catalogue.
3. **Pari tenu.** Un pronostic ne se retire pas. Jusqu'à la clôture, on peut changer d'option ;
   ensuite, plus rien ne bouge.
4. **Le flair paie.** Plus une bonne réponse est rare dans le groupe, plus elle rapporte : la cote vient du groupe lui-même. Avoir raison quand tout le monde a raison ne rapporte rien.
5. **Celui qui tranche ne parie pas.** Toute décision peut être contestée, puis soumise au vote.
6. **Tout est visible.** Chacun voit qui a parié quoi, à tout moment. Le chambrage fait partie du jeu.
7. **Le téléphone d'abord.** Tout se fait au pouce, en quelques secondes.
8. **Le minimum de données.** Un pseudo, un avatar emoji et un PIN haché, rien d'autre.

## 5. Rôles

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| **Membre** | Tout ami qui a rejoint le groupe | Créer des paris, parier, contester, voter, commenter |
| **Arbitre** (d'un pari) | Le créateur du pari, ou le membre qu'il désigne | Clôturer plus tôt, trancher ou annuler ce pari. Il ne peut pas parier dessus. |
| **Admin du groupe** | Le créateur du groupe et ceux qu'il nomme | Gérer le lien du groupe (le changer s'il a fuité), les membres et les réglages ; trancher à la place d'un arbitre absent ; corriger un résultat |
| **Admin du site** (2026-11-01) | La personne qui héberge l'app (mot de passe choisi sur le serveur) | Tous les comptes et tous les groupes (`/admin`) ; générer et suivre les coupons de création de groupe (§ 7.14) |

## 6. Glossaire

* **Pari** : une question avec 2 à 8 options et une heure de clôture.
* **Option** : une réponse possible (« Oui », « Non », « Léa », « Entre 3 et 3,5 kg »…).
* **Pronostic** : l'option qu'un membre choisit sur un pari. C'est gratuit.
* **Participants** : les membres qui ont fait un pronostic sur ce pari.
* **Cote** d'une option : le nombre de participants divisé par le nombre de pronostics sur cette option. Plus l'option est rare, plus sa cote est haute.
* **Clôture** : la fin des pronostics.
* **Résolution** : l'arbitre désigne l'option gagnante, ou annule le pari.
* **Contestation** : un membre conteste la résolution, ce qui ouvre un vote.
* **Règlement** : l'attribution définitive des points.
* **Classement** : un par compétition (Ligue 1, NFL, F1…) pour les paris venus d'une source sportive, un par catégorie
  pour les autres paris.
* **Saison** : la période d'un classement. Compétition : sa vraie saison (dates officielles) ; catégorie : la saison de
  l'année (printemps, été, automne, hiver). À la fin, le meilleur score est sacré champion et tout repart de zéro.
* **Score** : le total des points gagnés dans une saison d'un classement.

## 7. Fonctionnalités

Trois niveaux de priorité : **Indispensable** (la V1 ne sort pas sans), **Important** (dans la V1 si possible), **Bonus**.

### 7.1 Rejoindre sans inscription (Indispensable)

**Créer un groupe**, depuis la page « Créer un groupe » (`/n/<coupon>`), ouverte seulement par le lien d'un coupon
(aucun lien de l'app n'y mène, et `/n` sans coupon n'existe pas ; § 7.20) :

* nom et emoji du groupe, puis son propre pseudo, son avatar et son PIN ;
* il faut un **coupon** (depuis le 2026-11-01, à la place du code d'instance) : généré par l'admin du site, il crée un seul groupe et expire en servant ; son lien `/n/<code>` ouvre le formulaire, coupon rempli (les anciens liens `/groups/new/<code>` et `/c/<code>` y mènent aussi ; § 7.14, 7.16 et 7.20) ;
* on obtient le lien du groupe, son adresse `https://…/g/<groupe>`, à coller dans le groupe WhatsApp (bouton Partager ; QR code en bonus). Plus de lien d'invitation à part depuis le 2026-11-04 (§ 7.19).

**Rejoindre** :

* on ouvre le lien du groupe, puis « Je suis nouveau » ;
* on choisit un pseudo (unique sur toute l'instance, de 2 à 20 caractères), un avatar emoji et un PIN à 4 chiffres, saisi deux fois : c'est son compte ;
* déjà connecté à son compte : un bouton « Entrer dans <groupe> » suffit, avec son pseudo et son avatar.

**Un compte par joueur** (2026-10-31) : un pseudo (unique sur toute l'instance), un avatar et un PIN, les mêmes dans
tous ses groupes ; une connexion par appareil vaut pour tous ses groupes. Les changer (page « Moi ») les change partout.

**Revenir ou changer d'appareil** :

* la session dure un an sur l'appareil utilisé ;
* sur un autre appareil : le lien d'un de ses groupes (son adresse) propose « J'ai déjà un compte » : son pseudo et
  son PIN, sans rien qui montre les membres du groupe (§ 7.19), et on retrouve tous ses groupes. Pas de connexion
  depuis l'accueil du site, seulement depuis le lien d'un groupe : il dit d'ouvrir le lien d'un groupe, ou de le demander à un ami (page « Moi », « Invite tes amis ») ;
* « Me déconnecter de cet appareil » (page « Moi ») le déconnecte de tous ses groupes, pas ses autres appareils.

**Plusieurs groupes (V3)** :

* un joueur déjà membre d'un groupe peut en créer d'autres sans le code de l'instance, sans retaper pseudo ni PIN ;
* **un pronostic sur un pari de source** (même match, même course) **vaut dans tous ses groupes** où ce pari est ouvert
  et dont il suit la compétition, y compris ceux qui l'ouvrent plus tard ; les classements restent propres à chaque groupe ;
* le menu (sur PC) et la page d'accueil du site listent mes groupes pour passer de l'un à l'autre.

**Sécurité** :

* le jeton du lien est aléatoire (128 bits) : c'est lui le vrai secret. L'admin peut le régénérer : l'ancien lien cesse alors de marcher, mais les sessions déjà ouvertes restent valables ;
* le PIN est stocké haché ; après 5 erreurs, le compte est bloqué 15 minutes, puis deux fois plus à chaque nouveau
  blocage (24 h au plus). On ne se connecte que depuis le lien d'un groupe : sans lien (secret), personne ne peut essayer
  des pseudos et des PIN. Le lien de n'importe quel groupe convient (on s'y connecte, puis on rejoint ce groupe). Les
  essais ratés pour changer de PIN (page « Moi ») comptent aussi ;
* PIN oublié : un admin réinitialise le PIN ; le joueur en choisit un nouveau en rouvrant le lien du groupe (jamais
  depuis l'accueil, le pseudo n'étant pas secret). Un joueur dans plusieurs groupes : il faut un admin de chacun (un
  admin l'est parfois de plusieurs), sinon l'admin d'un groupe pourrait prendre son compte dans les autres.

### 7.2 Créer un pari (Indispensable)

Tout tient sur un seul écran :

| Champ | Règle |
|---|---|
| Question | Obligatoire, de 5 à 140 caractères. Exemple : « Julien arrive après 20 h 15 samedi ? » |
| Précisions | Facultatif, 500 caractères maximum : ce qui compte et comment on tranchera. Fortement suggéré. |
| Catégorie | Une catégorie de la liste (§ 7.9) |
| Type | **Oui / Non** (deux options déjà remplies) ou **Choix multiples** (de 2 à 8 options libres) |
| Clôture des pronostics | Date et heure, obligatoire : au moins 5 minutes plus tard et au plus dans un an |
| Résultat attendu le | Facultatif, sert aux rappels |
| Arbitre | **Moi** (je ne pourrai pas parier) **ou un autre membre** (je pourrai parier) |

* **Nombres et dates** (poids d'un bébé, date d'accouchement, score) : le créateur découpe en tranches, par exemple « moins de 3 kg », « de 3 à 3,5 kg », « plus de 3,5 kg ». Le mode « le plus proche gagne » est prévu en V2.
* **Idées de paris** (Important) : un bouton propose des modèles par catégorie, avec des blancs à compléter : « ___ arrive en retard ? », « Qui gagne ___ ? », « ___ tient son défi jusqu'au ___ ? ».
* **Arbitre désigné** : il ne doit pas avoir parié. Il peut se désister tant que le pari est ouvert ; le créateur en désigne alors un autre.
* **Modifier** : tout est modifiable tant que personne n'a parié. Ensuite, le créateur peut seulement ajouter une précision (datée et visible de tous) ou repousser la clôture. La question et les options ne changent plus.
* **Supprimer** : seulement si personne n'a parié. Sinon, on annule le pari.
* **Partager** : ouvre le partage du téléphone (WhatsApp…) avec un texte prêt, par exemple « 🎲 Nouveau pari : Julien arrive après 20 h 15 ? Pronostics jusqu'à samedi 19 h », suivi du lien.

### 7.3 Parier (Indispensable)

* La liste des paris a 4 sections, les vides cachées (2026-11-03) : « À parier », « Pariés » (modifiable jusqu’à la
  clôture), « Clos » (plus rien ne change ; ce qui attend le joueur d’abord) et « Terminés ».
* Sur la fiche, on touche une option, puis on valide. C'est gratuit. Depuis la liste des paris, on touche une option et
  c'est parié, sans fenêtre de confirmation.
* Avant de valider, l'app affiche par exemple : « Si tu as raison, ça te rapporte environ 250 pts (cote 2,50), à l'heure actuelle ».
* Règles :
  * **une seule option par membre et par pari** ;
  * pas de retrait ; changement d'option possible jusqu'à la clôture (le fil le raconte : « a changé d'avis : « Non »
    au lieu de « Oui » ») ; un pronostic de match change aussi dans les autres groupes du joueur ;
  * l'arbitre ne peut pas parier ;
  * l'heure du serveur fait foi : un pronostic reçu après la clôture est refusé.
* Tout est visible, tout le temps : qui a choisi quelle option, et la cote de chacune.

### 7.4 Calcul des cotes et des points (Indispensable)

**Paris sportifs (V3, cote fixe)** : chaque option a une **cote fixe**, affichée sous son nom avant de parier comme
chez les bookmakers (« 2,50 », deux décimales ; le barème fixe « 2,00 » en grisé, ce n'est pas une vraie cote), et un bon
pronostic rapporte **100 × cette cote**. C'est la cote des bookmakers (DraftKings, donnée par ESPN pour le foot, la NFL,
la NBA, la NHL, la MLB…) ; sans cote connue (rugby, tennis, MMA, F1, moto…), un **barème fixe** de 2 (200 pts le bon
pronostic). Le résultat ne dépend pas des autres joueurs : **jamais de cote à 1**, et un pari sportif
n'est jamais annulé faute de participants ou parce que tout le monde a fait le même choix. Une cote qui arrive après
l'ouverture remplace le barème fixe tant que personne n'a parié. Pas de prime d'arbitre (il n'y en a pas).

**Paris entre amis** — le reste de ce paragraphe :

Notations : *N* est le nombre de participants au pari, *nₖ* le nombre de pronostics sur l'option *k*.

* **Cote** de l'option *k* : *N ÷ nₖ*, affichée avec deux décimales, comme les cotes des bookmakers (« 2,50 » ; « — » si personne ne l'a choisie). Elle bouge à chaque pronostic et devient définitive à la clôture.
* **Points** pour chaque bon pronostic : **100 × la cote**, arrondi à l'entier le plus proche.
* Un mauvais pronostic rapporte 0 point. On ne perd jamais de points.

**Exemple** : « Julien arrive après 20 h 15 ? »

| Option | Qui | Pronostics | Cote | Points si elle gagne |
|---|---|---|---|---|
| Oui | Léa, Max, Sam | 3 | 5 ÷ 3 = 1,67 | 167 chacun |
| Non | Tom, Inès | 2 | 5 ÷ 2 = 2,50 | 250 chacun |

Julien arrive à 20 h 10, donc **Non** gagne : Tom et Inès marquent 250 points chacun, Léa, Max et Sam ne marquent rien.

**Cas particuliers** :

| Situation | Ce qui se passe |
|---|---|
| Moins de 2 participants à la clôture | Le pari est annulé, aucun point |
| Tout le monde a choisi la même option | « Pari unanime » : personne n'a pris de risque, aucun point. Ça évite de gonfler les scores avec des paris évidents. |
| Personne n'a choisi l'option gagnante | Aucun point |
| L'événement n'a pas lieu, ou la question était ambiguë | L'arbitre annule, aucun point |
| Un pronostic arrive au moment précis de la clôture | La transaction côté serveur tranche : accepté s'il arrive avant, refusé après |

### 7.5 Clôture, résolution et contestation (Indispensable)

```
Ouvert ──clôture──▶ Clos ──l'arbitre tranche──▶ En validation (24 h) ──▶ Réglé
                                                       │
                                                  contestation
                                                       ▼
                                                En vote (48 h) ──▶ Réglé ou Annulé

Ouvert ou Clos ──l'arbitre annule──▶ Annulé (aucun point)
```

* **Clôture** : automatique à l'heure prévue. L'arbitre peut clôturer plus tôt, par exemple quand l'événement a commencé.
* **Trancher** : une fois le pari clos, l'arbitre choisit l'option gagnante ou « Annuler », avec un commentaire facultatif (« Arrivé à 20 h 10, photo dans le groupe »).
* **Validation (24 h)** : le résultat est affiché et les points sont marqués « en attente ». S'il n'y a pas de contestation, ils sont attribués à la fin du délai.
* **Contester** : tout participant peut contester pendant ces 24 heures, avec un motif obligatoire. Une seule contestation suffit pour ouvrir le vote.
* **Vote (48 h)** : chaque membre du groupe, sauf l'arbitre, vote pour une option ou pour « Annuler ». Le choix majoritaire l'emporte. En cas d'égalité, le pari est annulé. S'il y a moins de 3 votants, la décision de l'arbitre est maintenue. Le vote s'arrête dès que tout le monde a voté.
* **Arbitre absent** : l'app lui envoie un rappel 24 heures après la date du résultat attendu (ou après la clôture, s'il n'y en a pas). Au bout de 7 jours, un admin peut trancher à sa place. Au bout de 30 jours, le pari est annulé automatiquement.
* **Erreur découverte après coup** : un admin peut corriger le résultat d'un pari réglé. Les points déjà attribués sont retirés par des écritures inverses (jamais effacés), les nouveaux sont attribués, et la raison s'affiche sur le pari.

### 7.6 Points (Indispensable)

| Réglage | Valeur par défaut (réglable par l'admin) |
|---|---|
| Points de base d'un bon pronostic | 100 (multipliés par la cote) |
| Plafond de cote | Aucun (l'admin peut plafonner, par exemple à 5, si un coup chanceux pèse trop) |
| Prime de l'arbitre | 20 points par pari réglé sans contestation, avec au moins 3 participants et sans unanimité |

* La **prime de l'arbitre** compense celui qui ne peut pas parier sur son propre pari, et encourage à créer des paris et à bien les trancher.
* Chaque attribution de points est inscrite dans un **journal** qu'on ne modifie jamais : gain, prime, correction. Le score est la somme du journal, et chacun peut consulter son relevé.

### 7.7 Classement et profils

* **Classements** (Indispensable, revu en V2 le 2026-10-30) : **pas de classement général**. Un classement par
  compétition (Ligue 1, Premier League, NFL, Top 14, F1, MotoGP, ATP…) pour les paris ouverts par une source sportive, et
  un par catégorie (Vie du groupe, Météo, Éco et crypto…) pour les autres. Chacun montre rang, avatar, pseudo, score,
  taux de réussite et nombre de paris réglés, saison par saison.
* **Saisons** (Indispensable, V2) : on suit les vraies saisons.
  * Compétition : sa saison officielle, d'après les dates de la source (Ligue 1 jusqu'au 1er juin, NFL jusqu'après le
    Super Bowl, NBA jusqu'après les finales, F1 et MotoGP jusqu'au lendemain du dernier Grand Prix…). Si la source
    donne des dates incohérentes, une saison à date fixe propre à la compétition (Top 14 : d'août à août).
  * Catégorie : la saison de l'année, de minuit le jour de l'équinoxe ou du solstice (heure de Paris) au suivant :
    printemps, été, automne, hiver.
  * Un pari compte dans la saison où tombe son résultat attendu (son événement pour un pari de source).
  * Fin de saison : quand tous ses paris sont terminés (ou 35 jours au plus après la fin), le meilleur score est sacré
    champion (ex æquo possibles), le classement est figé et annoncé dans le fil, et la saison suivante repart de zéro.
  * **Historique** : chaque classement garde ses saisons passées, leur champion, leur classement final et tous leurs paris.
* **Profil** (Important) : saisons en cours (place et points dans chaque classement), titres de champion, paris en cours,
  historique des pronostics, relevé de points, meilleur coup (la plus forte cote réussie) et série en cours.
* **Badges** (Bonus) : 🎯 Premier pari · 🦄 Seul contre tous (le seul à avoir raison, avec au moins 4 participants) · 🔥 Série de 5 · 🎤 Ambianceur (10 paris créés) · ⚖️ Juge de paix (10 arbitrages sans contestation) · 🏆 Champion (une saison gagnée, par classement) · 🐌 Lanterne rouge (dernier de la dernière saison close d'un classement, à 3 ou plus).

### 7.8 Accueil, fiche d'un pari et fil d'activité

* **Accueil** (Indispensable), sections dans cet ordre :
  1. *À trancher* : les paris dont je suis l'arbitre et qui attendent mon verdict ;
  2. *Ouverts* : la clôture la plus proche en premier, avec les repères « nouveau » et « tu n'as pas parié » ;
  3. *En attente de résultat*, puis *En validation ou en vote* ;
  4. *Terminés récemment*.

  Un filtre par catégorie est disponible.
* **Fiche d'un pari** (Indispensable) : question, précisions, catégorie, arbitre et compte à rebours ; pour chaque option, une barre de répartition, les avatars de ceux qui l'ont choisie et la cote ; mon pronostic et ce qu'il rapporterait ; l'historique (précisions ajoutées, résolution, contestation, votes) ; les actions possibles selon mon rôle.
* **Fil d'activité** (Important) : « Max a parié Oui », « Nouveau pari de Léa », « Tom a gagné 250 pts 🎉 ».
* **Commentaires** (Important) : messages courts et réactions emoji sous chaque pari, pour chambrer.
* **Mise à jour** : quand on revient dans l'app, et toutes les 20 secondes sur une fiche ouverte. Pas de temps réel strict en V1.

### 7.9 Catégories

Liste par défaut, que l'admin peut renommer, désactiver ou compléter (page « Réglages des paris », § 7.11) :

👥 Vie du groupe · 💪 Défis perso · 🎲 Jeux entre amis · ⚽ Sport · 🎮 Jeux vidéo et e-sport · 📺 Télé et télé-réalité · 🎬 Ciné et séries · 🎤 Musique et cérémonies · 🗳️ Actu et politique · 💶 Éco et crypto · 🌦️ Météo · 🤪 Insolite

### 7.10 Administration du groupe (Indispensable, sauf mention contraire)

Page « ⚙️ Réglages du groupe », réservée aux admins : l'engrenage à côté du nom du groupe, dans le menu de gauche sur
PC (pour chacun de ses groupes dont on est admin) et dans l'en-tête du groupe sur téléphone (2026-10-31 : plus depuis
« Moi »).

* **Lien du groupe** (son adresse) : copier, partager, changer (une nouvelle adresse, l'ancienne ne mène plus à rien) ; QR code en bonus.
* **Membres** : nommer ou retirer un admin, réinitialiser un PIN, bannir un membre, réintégrer un banni. Règle du 2026-11-04 :
  * **parti de lui-même** (« Quitter le groupe ») : il y apparaît comme « Max (parti) » ; il revient quand il veut par
    le lien du groupe et retrouve sa place, ses points, ses pronostics et son historique ;
  * **banni par un admin** : « Max (banni) » ; il ne revient pas de lui-même, même avec le lien (l'adresse du groupe le
    lui dit) ; un admin du groupe le réintègre (Réglages du groupe → Bannis → Réintégrer), ou l'admin du site, et il
    retrouve tout pareil ;
  * dans les deux cas, ses pronostics sur les paris encore ouverts sont retirés au départ ; ceux des paris clos restent ;
  * la mention suit son pseudo (« Maxime (parti) » s'il en change) ; « (parti) », « (banni) » et « (supprimé) » sont
    réservés.
* **Toujours un admin, jamais un groupe vide** (2026-11-04) : personne ne devient admin sans avoir été choisi.
  * Le seul admin qui veut partir alors qu'il reste du monde nomme d'abord son successeur (« Passer le relais ») ou
    supprime le groupe (en retapant son nom : tous les membres en sortent, leurs comptes restent).
  * Le dernier membre qui part emporte le groupe (paris, classements, historique) ; la confirmation le dit, et que ceux
    qui en sont partis ou bannis ne pourront plus y revenir.
  * L'admin du site ne peut pas bannir le seul admin (il en nomme d'abord un autre) ni le dernier membre (il supprime le
    groupe) ; il ne peut pas supprimer le compte du seul admin d'un groupe où il reste du monde ; supprimer le compte du
    dernier membre d'un groupe supprime aussi ce groupe (la fiche du compte le dit avant).
* **Réglages** : points (§ 7.6), délais (validation 24 h, vote 48 h) ; types de paris, catégories et sources de données sur la page « Réglages des paris » (§ 7.11).
* **Export** de tout le groupe en JSON (Bonus).

### 7.11 Réglages des paris et paris automatiques (V1.1, revu en V2 le 2026-10-30)

**Page « Réglages des paris »** (admins, depuis les réglages du groupe) :

* **Types des paris maison** : Oui / Non et choix multiples, activables un par un ; aucun type : pas de paris maison.
  Les compétitions n'en dépendent pas (2026-10-31).
* **Un groupe neuf n'a rien d'activé** (2026-10-31) : ni type, ni catégorie de paris maison, ni compétition ; l'admin
  choisit tout dans cette page.
* **Catégories des paris maison** (ceux qu'on lance avec « Nouveau pari ») : activer, désactiver, renommer, ajouter.
  Une catégorie désactivée disparaît du formulaire ; les paris déjà lancés continuent. **Aucune catégorie activée : pas
  de paris maison**, le bouton « Nouveau pari » disparaît et le groupe ne vit que de ses compétitions (2026-10-30).
* **Paris automatiques** : sous chaque catégorie, ses sources, **réglées à part** : couper les paris maison d'une
  catégorie (Sport…) ne coupe pas ses compétitions, et inversement. **Rien n'est activé d'office.** Pour un sport, l'admin
  active les compétitions une par une ; une source hors sport (météo, cryptos, actu) s'active d'un bloc et se règle
  (cryptos suivies, ville de la météo, thème).

| Catégorie | Source | Paris proposés | Résultat |
|---|---|---|---|
| ⚽ Sport | Football (ESPN), 33 compétitions : Ligue 1, Ligue 2, Coupe de France, Première Ligue, Ligue des champions (hommes, femmes), Ligue Europa, Ligue Conférence, Premier League, Championship, FA Cup, Liga, Serie A, Bundesliga, coupes nationales, Portugal, Pays-Bas, Belgique, Écosse, Turquie, MLS, Liga MX, Brésil, Argentine, Libertadores, Ligue des nations, Coupe du monde et qualifications, Euro, Coupe du monde des clubs | Qui gagne ? (victoire, nul, défaite) | Score final |
| ⚽ Sport | Football américain (ESPN) : NFL, NCAA | Qui gagne ? | Score final |
| ⚽ Sport | Rugby (ESPN) : Top 14, Champions Cup, Challenge Cup, Six Nations, tests internationaux, Coupe du monde, Premiership, URC, Rugby Championship, NRL (XIII) | Qui gagne ? (1N2) | Score final |
| ⚽ Sport | Basket (ESPN) : NBA, WNBA, NCAA hommes et femmes | Qui gagne ? | Score final |
| ⚽ Sport | Hockey sur glace (ESPN) : NHL, NCAA | Qui gagne ? | Score final (prolongation et tirs au but compris) |
| ⚽ Sport | Baseball (ESPN) : MLB | Qui gagne ? | Score final |
| ⚽ Sport | Tennis (ESPN) : ATP, WTA (simples, hors qualifications, dès que l'horaire est connu) | Le vainqueur du match | Vainqueur (forfait avant le match : annulé) |
| ⚽ Sport | MMA (ESPN) : UFC, PFL | Le vainqueur du combat | Vainqueur (nul, sans décision ou annulé : annulé) |
| ⚽ Sport | Football australien (ESPN) : AFL | Qui gagne ? (1N2) | Score final |
| ⚽ Sport | Formule 1 (Jolpica) | Vainqueur du prochain GP (7 favoris + « un autre ») ; titre : le lieu et le circuit (« Mexico City · Autódromo Hermanos Rodríguez »), sans « Qui gagne… ? » ; lien : la page du Grand Prix chez ESPN | Vainqueur officiel ; course retirée du calendrier officiel : annulé tout de suite ; repoussée : le pari la suit |
| ⚽ Sport | Grands Prix moto (MotoGP.com) : MotoGP, Moto2, Moto3, au choix | Sur les 2 prochains GP : vainqueur de la course et du sprint (7 favoris + « un autre ») | Classement officiel ; course annulée : pari annulé |
| 💶 Éco et crypto | Coinbase : Bitcoin, Ethereum, Solana, XRP, Dogecoin | Le cours dépasse un seuil rond à 20 h, demain ou dans une semaine | Cours à 20 h |
| 🌦️ Météo | Open-Meteo, ville au choix | Il pleut (≥ 1 mm) ? Au moins X °C ? sur les 7 jours à venir | Relevé du jour |
| 🗳️ Actu et politique | Manifold (questions en anglais) | Questions oui/non qui se terminent dans les 120 jours | Résolution officielle |

Toutes ces sources sont gratuites et sans clé. Polymarket, bloqué en France, est remplacé par Manifold (monnaie fictive).
Écartés faute de source gratuite exploitable : golf (pas de favoris), courses IndyCar et NASCAR (pas de partants avant la
course), cricket, cyclisme, handball, volley, Superbike (saison finie, pas d'API trouvée).

**Un seul pari par match ou par course : son résultat**, titré « sport · compétition · rencontre », sans « qui
gagne ? » (par exemple « Tennis · Rolex Paris Masters, 1er tour · Quentin Halys – Arthur Fery »), avec le match nul
quand il existe. Les paris « au moins 3 buts », « les deux équipes marquent », total de points, « le leader gagne ? »
et « un Français sur le podium ? » ont été retirés ; ceux qui avaient des pronostics vont jusqu'au bout.

**Les paris s'ouvrent tout seuls** (V2) : dès qu'une compétition est activée (et sa catégorie aussi), tous ses paris
disponibles s'ouvrent, puis toutes les 30 minutes ceux qui apparaissent (matchs des 7 prochains jours, matchs de tennis
du lendemain…). Le fil du groupe reçoit un résumé (« 6 nouveaux paris ouverts automatiquement : ⚽ Ligue 1 (6) »).

* La question, les options, la catégorie et la clôture (le début de l'événement) viennent de la source ; personne ne
  les modifie. Un type de pari désactivé n'est pas ouvert.
* **Ni créateur ni arbitre** : tout le monde peut parier. Le serveur demande le résultat à la source toutes les
  5 minutes après l'heure prévue (toutes les 10 minutes la première journée, puis toutes les heures), et chacun peut
  appuyer sur « Vérifier le résultat ».
* Le résultat de la source est le **résultat officiel** (depuis le 2026-11-01, avant : proposé comme un verdict
  d'arbitre, 24 h de validation, contestable) : le pari est réglé et les points tombent aussitôt, sans contestation ni
  vote (le groupe ne vote pas contre un score officiel). Le résultat est demandé dès que le direct annonce la fin avec le
  score final, sans attendre l'heure prévue. Une erreur de la source : un admin du groupe corrige le résultat (motif
  visible dans l'historique, points recalculés). Pas de prime d'arbitre.
* Événement reporté ou annulé : pari annulé, aucun point. Source muette 24 h après l'heure prévue : un admin sans
  pronostic peut trancher à la main.
* Un même pari ne s'ouvre qu'une fois par groupe.
* À la clôture, un pari que personne n'a joué disparaît ; joué par une seule personne, il est annulé comme les autres.
* Compétition désactivée : ses paris encore sans pronostic disparaissent, les autres vont jusqu'au bout.
* L'accueil filtre les paris par classement (⚽ Ligue 1, 🏈 NFL, 👥 Vie du groupe…).
* **Chacun choisit ses compétitions (V3)** : le groupe propose les compétitions activées ; chaque membre répond « Je
  participe » ou « Non merci » (page Moi → Mes compétitions pour changer d'avis : un interrupteur par compétition,
  allumé s'il y participe, éteint sinon, « pas encore choisi » sans réponse). Sans réponse, les paris d'une
  compétition ne s'affichent pas chez lui ; un pari sur lequel il a parié reste visible.
* **Une nouvelle compétition s'annonce** à chaque membre, admin compris, qui choisit d'y participer ou non :
  * personne n'y est inscrit d'office, pas même l'admin qui l'active (avant : lui, oui) ;
  * en haut de la page du groupe, au-dessus des paris, « 🆕 Nouvelle compétition dans le groupe », avec « Je participe »
    et « Non merci » pour chacune, jusqu'à la réponse (avant : une carte placée sous les paris à jouer) ;
  * l'Activité le dit à tout le groupe : « Léa a ajouté ⚽ Ligue 1 aux compétitions du groupe » (ou « L'admin du
    site a ajouté… ») ;
  * « Je participe » après coup : on retrouve ses pronostics des mêmes matchs déjà faits dans ses autres groupes.

### 7.12 Design, tablette et PC, site et aide (V3)

* Ambiance stade : bandeaux sombres façon tableau d'affichage, vert pelouse, jaune fluo, titres condensés en capitales.
* Avatars sportifs : icônes de sports, sportifs en action, 26 drapeaux (dessinés, Windows n'affiche pas les drapeaux
  emoji) et un maillot à composer (deux couleurs et un numéro). Les anciens avatars restent affichés.
* Téléphone, tablette (cartes en grille) et PC (barre latérale avec la navigation et mes groupes, contenu en grille,
  classement sur deux colonnes).
* Pages du site (revues le 2026-11-03, § 7.16) : l'accueil (présentation, comment ça marche, sports, points forts),
  Mes groupes, Créer un groupe.
* Aide et règles (`/help`), publique : commencer, parier, points, compétitions, plusieurs groupes, saisons, arbitrage,
  badges, installation.
* Maillot : numéro de 0 à 99 (deux chiffres au plus), dessiné dans le t-shirt (2026-10-31).

### 7.13 Paris de sport en images et direct (2026-10-31)

Un pari de sport se lit d'un coup d'œil plutôt qu'en texte : le score en direct, puis le score final, apparaissent dans
chaque pari, et une page Direct regroupe les rencontres et les paris du jour du joueur.

* **Carte d'un match** : les deux écussons et noms des équipes (ou les photos et drapeaux des joueurs au tennis et au
  MMA), l'heure du coup d'envoi au centre, puis le score en grand et le chrono en direct (« 62' », « Mi-temps »,
  « 3e QT · 5:32 »…), puis le score final ; options au nom des équipes, la cote sous chacune (« Lyon 2,10 · Nul 3,40 · Nice 3,20 » ; barème fixe : 2,00 en grisé).
* **Carte d'une course** (MotoGP, Moto2, Moto3, F1) : une tuile par pilote (photo officielle recadrée sur le visage,
  numéro, couleur de l'équipe), puis le podium à l'arrivée.
* **Où en est mon prono** pendant le match : « Ton prono passe / ne passe pas », puis « Bien vu / Raté ».
* **Accueil** : une section « En direct » en tête ; les scores se mettent à jour tout seuls (30 s).
* **Page « Direct »** (onglet 📺, si le groupe a des compétitions) : hier, aujourd'hui, demain ; en direct, à venir,
  terminés ; bilan du jour (joués, qui passent, bien vus, points gagnés).
* Les images passent par l'app (les téléphones n'appellent jamais ESPN ou MotoGP.com) et sont réduites (une photo
  MotoGP de 4 Mo devient 35 Ko).
* **Le match** (qui a marqué et quand, les cartons, et l'équivalent dans chaque sport) : sur la fiche d'un pari, un bloc sous le
  score, qui reste une fois le match fini ; sur la page Direct, une ligne sous le match.
  * ⚽ Foot : chronologie des buts (penalty, contre son camp) et des cartons, chaque action du côté de son équipe ;
    possession, tirs, tirs cadrés, corners, fautes, cartons. Direct : buteurs (« G. Yassine 77', 85' ») et 🟥.
  * 🏉 Rugby : essais, transformations, pénalités, drops et cartons ; cartons comptés. Direct : nombre d'essais, 🟥.
  * 🏈 Football américain : score par quart-temps, meneurs du match (passes, courses, réceptions) ; pendant le match,
    qui attaque, la tentative, les yards à faire et où est le ballon (aussi sur la page Direct).
  * 🏀 Basket : score par quart-temps, adresse aux tirs, à 3 points, lancers francs, rebonds, passes décisives, et le
    meilleur marqueur, rebondeur et passeur de chaque équipe.
  * 🏒 Hockey : score par période (« Prol. », « T.a.b. »), tirs cadrés, arrêts et % d'arrêts des gardiens, meilleurs
    buteur, passeur et pointeur de chaque équipe. « Terminé (prol.) » quand il y a eu prolongation (aussi au basket et
    en NFL).
  * ⚾ Baseball : points par manche, coups sûrs et erreurs ; pendant le match, retraits, coureurs sur base et compte.
  * 🦘 Football australien : score par quart-temps.
  * 🥊 MMA : comment le combat s'est fini (« KO/TKO au 3e round (3:20) », « Soumission… », « Décision après 3 rounds »)
    et le bilan de chaque combattant (« 13-0-0 »).
  * 🏎️ F1 et 🏍️ MotoGP, Moto2, Moto3 (après la course) : classement complet (écarts, pilotes doublés, abandons ;
    places gagnées ou perdues depuis la grille en F1) et meilleur tour.
  * Tennis et padel : rien de plus (sets et jeux déjà affichés, pas de point par point chez les sources).
  * Aucune requête de plus : tout vient des tableaux du jour qu'on relit déjà pour le score, ou du résultat de la course.
  * Lot 2 (2026-11-01, le résumé du match : une requête de plus par match en cours, seulement quand le score ou la
    chronologie bouge, sinon toutes les 5 minutes) : ⚽ le passeur de chaque but ; 🏈 chaque action qui marque
    (touchdown, field goal, safety, en français, avec la transformation manquée ou la conversion à 2 points) ; 🏒 les
    buts avec leurs passeurs (supériorité, infériorité numérique, filet désert) et les pénalités (« rudesse, 2 min »).
    Direct : buteurs au hockey (« 🏒 A. Frondell 1re 6:04 (sup. num.) »), touchdowns et field goals.

### 7.14 Admin du site et coupons (2026-11-01)

Une administration du site sécurisée : comptes et groupes en lecture et en écriture, avec des actions rapides. Créer
un groupe (et le compte qui va avec) demande un coupon à usage unique, généré et suivi dans l'admin, à la place d'un code
commun dans `.env` ; créer un compte seul demande le lien d'un groupe.

* **Accès** (`/admin`, page à part, jamais indexée ni gardée hors connexion) : un mot de passe d'au moins 12 caractères,
  choisi sur le serveur avec `npm run admin` (jamais depuis le site : personne ne peut le prendre en premier). 5 erreurs
  bloquent l'admin 15 min, puis deux fois plus à chaque fois ; `npm run admin` débloque. La session se ferme après 2 h
  sans activité, 12 h au plus. Chaque action, chaque connexion (réussie ou non) et chaque coupon utilisé vont au journal.
* **Tableau de bord** : comptes, actifs en 24 h, groupes, paris ouverts, coupons disponibles ; raccourcis (nouveau
  coupon, groupe, compte) ; derniers groupes, dernières actions, sessions admin ouvertes (adresse, navigateur).
* **Comptes** : liste (recherche ; tous, bloqués, PIN à choisir, sans groupe), fiche (groupes et rôles, appareils,
  dernière visite, coupons utilisés). Boutons : modifier (pseudo, avatar), ajouter à un groupe, débloquer, réinitialiser
  le PIN (choisi ensuite depuis le lien d'un groupe), déconnecter partout, supprimer (en retapant le pseudo). Règle du
  2026-11-04 : tant que le compte existe, il garde son lien avec ses groupes (il y retrouve sa place s'il revient) ;
  supprimé, il devient « Max (supprimé) » partout (« Max (supprimé 2) » si le groupe a déjà eu un Max supprimé) : dans
  ses groupes, qu'il quitte (ou là où il avait été retiré), son historique et ses points restent lisibles ; dans les
  coupons et le journal de l'admin aussi. Personne ne peut plus s'y connecter ni choisir un pseudo en « (supprimé) »,
  et « Max » se libère pour quelqu'un d'autre, sans confusion. Les lignes d'événements des groupes, du journal et des
  coupons suivent toujours le nom du compte : Max, Maxime après un changement de pseudo (même depuis la page « Moi »,
  même pour un membre retiré), puis « Maxime (supprimé) ». Nouveau compte : pseudo, avatar et un groupe ; il
  choisit son PIN en ouvrant le lien du groupe.
* **Groupes** : liste (recherche ; avec membres, vides), fiche (membres, rôles, coupon d'origine, paris, activité, lien,
  réglages en un coup d'œil). Boutons : copier le lien du groupe, modifier, ajouter un compte, rendre ou retirer admin, retirer un
  membre (le groupe garde toujours un admin), nouveau lien, supprimer (en retapant le nom). Nouveau groupe : pour un
  compte existant, qui en devient l'admin.
* **Modifier un groupe** : une page avec tout ce que règle l'admin du groupe : nom et emoji, points et délais (points de base,
  plafond de cote, prime d'arbitre, délais de contestation et de vote), types des paris maison, catégories (renommer,
  activer, ajouter) et paris automatiques (compétitions, ville de la météo…), enregistrés d'un coup (tout ou rien), avec
  les mêmes garde-fous. Une compétition activée est proposée aux membres, chacun choisit d'y participer ; coupée, ses
  paris sans pronostic disparaissent. Le journal dit ce qui a changé (« points et délais, compétitions (+ ⚽ Ligue 1) »).
  Les sources coupées pour tout le site n'y apparaissent pas (signalées) ; ce que le groupe avait choisi pour elles est
  gardé.
* **Classements d'un groupe** (fiche du groupe) : une puce par classement (compétition ou
  catégorie, avec son meneur), la saison en cours ou une autre, et le classement complet : rang (🏆 pour les champions
  d'une saison close), membre, points, paris réglés, bien vus.
* **Sources**, coupées ou rallumées pour tout le site : chaque
  source (foot, rugby, padel, F1, météo, cryptos, actu…), son fournisseur, ses compétitions, les groupes qui l'ont
  réglée, ses paris en cours, et un bouton Couper / Rallumer. Coupée : plus proposée aux groupes (réglages, accueil),
  plus aucun pari ne s'ouvre, ses paris sans pronostic disparaissent, ceux déjà joués vont jusqu'à leur résultat (direct
  compris). Les réglages des groupes sont gardés : rallumée, elle reprend partout comme avant. Une source sans sa clé
  (padel sans `PT_PADEL_TOKEN`) est signalée « Clé manquante ».
* **Coupons** : 12 caractères sans 0, O, 1 ni I (« ABCD-EFGH-JKMN », minuscules et tirets indifférents), une note (pour
  qui) et une validité (7, 30, 90 jours ou sans limite). Le code n'est montré qu'une fois (la base n'en garde que
  l'empreinte et la fin, « …JKMN ») : copier le lien, le code, ou partager. Suivi : disponible, utilisé (par qui, quel
  groupe, quand ; gardé même si le compte ou le groupe est supprimé), annulé, expiré. Un coupon disponible s'annule.
* **Créer un groupe** demande un coupon, même connecté (fini le passe-droit « déjà membre d'un groupe ») ; deux créations
  en même temps avec le même coupon : une seule passe. **Créer un compte** : en créant un groupe (coupon) ou en rejoignant
  un groupe par son lien. `PT_INSTANCE_CODE` ne sert plus.

### 7.15 Configuration de l'installation (2026-11-03)

PariTenu est un logiciel libre : une page Configuration de l'admin du site regroupe l'apparence et l'identité de
l'installation (nom, adresse…). Le logiciel s'appelle **PariTenu** ; chaque installation choisit son nom (par exemple « Les Pronos du
Vendredi », nom court « Pronos », `https://pronos.example.org`) et peut nommer son hébergeur.

* **Page ⚙️ Configuration** de l'admin du site (elle remplace la page Apparence, dont l'adresse y mène) :
  * **Identité** : nom (onglet, en-têtes, messages partagés), nom court (sous l'icône du téléphone, 14 caractères),
    adresse publique (`https://…`, sans chemin). Aperçu en direct : onglet, nom sous l'icône, lien d'un groupe.
  * **Page d'accueil** : accroche (le titre ; sa dernière phrase en valeur), présentation (aussi la description du site
    pour les aperçus de liens), note de pied de page.
  * **Hébergement** : « Hébergé par … » avec son lien, en bas de l'accueil et de l'aide.
  * **Icône et logo** : un PNG carré (512 px conseillés), aperçu dans l'onglet, sur l'écran du téléphone et en en-tête ;
    retour à l'icône d'origine.
  * **Apparence** : les thèmes, comme avant.
  Les textes s'enregistrent d'un coup (journal : « Nom : « Pari tenu ! » → « Les Pronos du Vendredi » ») ; l'icône et le
  thème s'appliquent tout de suite, après confirmation. Chaque joueur voit le changement à sa page suivante.
* **Adresse publique : seulement les liens** : les liens des groupes, des coupons et des paris partagés
  la prennent ; pas de redirection, les autres adresses du site continuent de marcher.
* **Crédit** : un petit crédit en pied de l'accueil, de l'aide et de la page « Moi » nomme le logiciel et sa version
  (« PariTenu v1.0.0, logiciel libre » ; « Propulsé par PariTenu v1.0.0, logiciel libre » une fois l'installation
  renommée), puis « Hébergé par … » si un hébergeur est renseigné. L'admin du site affiche aussi la version.
* Restent inchangés, pour ne déconnecter personne : la règle du jeu « pari tenu », les cookies, les adresses, la base.

### 7.16 Adresses de l'app et pages du site (2026-11-03)

Des adresses sans `#` ; un accueil du site (`/`) qui présente le principe et les sports, sans formulaire ; une page
« Mes groupes » sans présentation ; la création d'un groupe à une adresse à part, coupon pré-rempli depuis l'adresse
(`/groups/new`, devenue `/n/<coupon>`, § 7.20).

* **Plus de `#`** dans les adresses de l'app : `/groups`, `/help`, `/<groupe>`, `/<groupe>/bet/<id>`… (et dans
  celles de l'admin, § 7.17). Les anciennes adresses `/#/…` (favoris, applis installées) mènent à la même
  page.
* **`/` : l'accueil du site**, pour tout le monde dans un navigateur : accroche, présentation, chiffres, « Déjà un
  compte ? » (sans compte connecté), comment ça marche, tous les sports, pourquoi c'est mieux. Boutons « Comment ça
  marche ? », « Mes groupes » (si l'appareil en connaît) et « Aide ». Aucun formulaire. L'app installée sur l'écran
  d'accueil, elle, s'ouvre toujours sur le dernier groupe.
* **`/groups` : mes groupes** : le compte connecté sur l'appareil, ses groupes, « Déjà un compte ? » (sans compte). Ni
  présentation, ni sports, ni formulaire.
* **Aucun lien cliquable vers la création d'un groupe** (il ne permettrait pas de rejoindre un groupe, et créer demande de toute façon un
  coupon) : ni bouton sur l'accueil ou Mes
  groupes, ni « Créer ou rejoindre » dans le menu, ni « créer un groupe » sur la page Moi. On y arrive par le lien du
  coupon.
* **`/groups/new` : créer un groupe** : le formulaire (coupon, nom, emoji, et pseudo + avatar + PIN sans compte).
  `/groups/new/<coupon>` le remplit : c'est le lien que copie et partage l'admin du site ; le code quitte aussitôt la
  barre d'adresse (ni historique, ni capture d'écran). Les anciens liens `/c/<coupon>` y mènent.

### 7.17 Adresses en anglais (2026-11-03)

Les adresses (routes) sont en anglais (`/admin/users`, `/admin/groups`…) ; seuls les textes sont en français.

* **App** : `/help[/<section>]` (sections : start, betting, points, competitions, groups, rankings, referee, badges,
  install), `/invite/<jeton>[?bet=<id>]` (depuis le 2026-11-04 : un ancien lien, qui dit qu'il a expiré ; § 7.19), `/<groupe>/members/<id>` ; le reste était déjà en anglais (`/groups`,
  `/groups/new`, `/<groupe>/bet/<id>`, `/rank`, `/activity`, `/me`, `/admin`, `/config`, `/follow`, `/live`).
* **Admin du site**, sans `#` : `/admin`, `/admin/users[/<id>]`, `/admin/groups[/<id>[/edit]]`, `/admin/coupons`,
  `/admin/sources[/<id>]`, `/admin/configuration`, `/admin/log`.
* L'API était déjà en anglais (`/api/…`).
* **Rien ne casse** : les liens déjà partagés ou gardés en favori mènent à la nouvelle adresse (`/g/…?pari=` →
  `/invite/…?bet=`, `/aide/…` → `/help/…` avec les anciens noms de section, `/c/…` → `/groups/new/…`,
  `/<groupe>/m/…` → `/<groupe>/members/…`, `/#/…`, `/admin#/comptes…` → `/admin/users…`).

### 7.18 Moteurs de recherche (2026-11-03)

Les robots des moteurs de recherche ne voient pas les pages des groupes : seul l'accueil peut être indexé.

* Seul l'accueil du site (`/`) peut apparaître dans Google, Bing, DuckDuckGo, Qwant…
* `robots.txt` interdit tout le reste aux robots (pages de groupe, dont leur adresse qui sert à y entrer, mes groupes, création de groupe,
  aide, admin, API), en leur laissant ce qu'il faut pour afficher l'accueil (styles, scripts, polices, icônes).
* Chaque réponse autre que l'accueil porte aussi « ne pas indexer, ne pas suivre les liens » (`X-Robots-Tag`), pour les
  robots qui passeraient outre `robots.txt`.
* Les données d'un groupe ne sont lisibles qu'avec un compte du groupe ; son adresse ne montre à qui n'en est pas que
  son nom et son emoji (jamais ses membres), et elle n'est jamais indexée.

### 7.19 Le lien du groupe fait tout (2026-11-04)

Plus de liens d'invitation : le lien du groupe sert à tout (entrer dans le groupe, s'y connecter). La page de
connexion ne propose aucune identité (pseudo et PIN à taper), et un admin peut changer le lien du groupe s'il a fuité.
Les anciens liens d'invitation : sans redirection.

* Le lien d'un groupe est son adresse, `https://…/<groupe>` (16 caractères hexadécimaux : 64 bits tirés au hasard).
  Les boutons Partager (accueil du groupe, « Moi », Réglages du groupe) la partagent ; un pari se partage par son
  adresse, `/<groupe>/bet/<id>`.
* Ouverte par quelqu'un qui n'est pas dans le groupe, la même adresse (ou celle d'un pari) montre le nom et l'emoji du
  groupe et propose « Je suis nouveau » (pseudo, avatar, PIN) ou « J'ai déjà un compte » (pseudo + PIN). Déjà connecté à
  son compte : « Entrer dans <groupe> ». Ensuite, l'adresse s'affiche : le groupe, ou le pari partagé.
* Rien n'y montre les membres : ni pseudos ni avatars à toucher (le serveur ne les envoie qu'aux membres). Un PIN
  réinitialisé s'y choisit aussi : on tape son pseudo, l'app demande le nouveau PIN.
* « Changer le lien » (Réglages du groupe, et l'admin du site) donne au groupe une nouvelle adresse : l'ancienne ne
  permet plus ni d'entrer ni de se connecter, elle ne mène plus au groupe (« Lien périmé »). Les membres connectés
  gardent l'accès : l'admin qui change le lien suit le groupe, les autres le retrouvent dans « Mes groupes ».
* Les anciens liens d'invitation (`/invite/…`, `/g/…`) ne marchent plus : une page dit de demander le lien du groupe à
  un membre. Les groupes existants gardent leur adresse : liens déjà partagés, favoris et apps installées marchent.
* Sécurité (choix assumé) : quelqu'un qui a vu l'adresse (historique, capture d'écran, ancien membre) peut entrer dans le
  groupe ou essayer des PIN, freiné par les blocages (5 erreurs par compte, puis deux fois plus long à chaque fois ;
  30 essais par adresse IP en 5 minutes), et il doit connaître un pseudo. D'où « Changer le lien ».

### 7.20 Adresses courtes : /g et /n/<coupon> (2026-11-04)

Des adresses plus courtes : `/g` remplace `/groups`, `/g/<groupe>` remplace `/<groupe>` et `/n/<coupon>` remplace
`/groups/new`. Sans coupon dans l'adresse, pas de formulaire de création.

* **`/g` : mes groupes** (avant `/groups`).
* **`/g/<groupe>` : un groupe**, et toutes ses pages : `/g/<groupe>/bet/<id>[/edit]`, `/new`, `/rank[/<classement>[/<saison>]]`,
  `/activity`, `/members/<id>`, `/me`, `/admin`, `/config`, `/follow`, `/live` (avant `/<groupe>/…`). Le lien du groupe
  que l'on partage est donc `https://…/g/<groupe>`.
* **`/n/<coupon>` : créer un groupe** (avant `/groups/new[/<coupon>]`). `/n` seul répond « Page introuvable » : le
  formulaire ne s'ouvre qu'avec un coupon dans l'adresse (le lien que copie l'admin du site). Le coupon reste dans la
  barre d'adresse (avant : il la quittait aussitôt), pour qu'un rechargement garde le formulaire ; il sert une fois.
  Le coupon de l'adresse n'est vérifié qu'à la création du groupe (comme avant) : un faux coupon ouvre le formulaire,
  qui le refuse.
* **Rien ne casse** : le serveur redirige les adresses déjà partagées : `/<groupe>/…` → `/g/<groupe>/…` (query
  comprise), `/groups` → `/g`, `/groups/new/<coupon>` et `/c/<coupon>` → `/n/<coupon>` ; l'app convertit aussi les
  anciennes adresses en `/#/…`. `/g/<jeton>` (autre chose qu'une adresse de groupe) reste un ancien lien d'invitation,
  qui dit qu'il a expiré.

## 8. Exigences non fonctionnelles

| Sujet | Exigence |
|---|---|
| Appareils | Téléphone d'abord (dès 360 px de large), tablette et PC (V3) ; versions récentes de Safari, Chrome, Edge |
| Installation | Installable sur l'écran d'accueil (PWA), ce qui demande du HTTPS (fourni par le reverse proxy ou l'hébergeur) |
| Rapidité | Créer un pari en moins d'une minute, parier en 2 touches, pages affichées en moins d'une seconde en 4G |
| Fiabilité des points | Chaque attribution de points se fait dans une transaction, et le score de chacun est toujours égal à la somme de son journal (vérifié par les tests) |
| Heure | Fuseau Europe/Paris ; l'heure du serveur fait foi ; affichage relatif (« dans 2 h ») |
| Sécurité | Adresse de groupe de 64 bits tirés au hasard (changeable par un admin), PIN haché, nombre d'essais limité, cookie de session `HttpOnly` + `Secure` + `SameSite=Lax`, CSP stricte, aucun contenu affiché sans échappement |
| Vie privée | Ni e-mail, ni téléphone, ni vrai nom demandés. « Quitter le groupe » laisse « Max (parti) » (il peut revenir) ; un compte supprimé devient « Max (supprimé) ». |
| Volume | Quelques groupes de 5 à 30 personnes : aucune contrainte de charge |
| Sauvegarde | Toute la base tient dans un fichier SQLite à sauvegarder |
| Langue et ton | Français, ton détendu |
| Accessibilité | Contrastes suffisants, zones tactiles d'au moins 44 px, mode sombre automatique |

## 9. Choix techniques

* **Serveur** : Node 24 (modules ESM), Express 5, validation avec zod, helmet.
* **Données** : SQLite embarqué (`node:sqlite`), tables STRICT, migrations versionnées.
* **Interface** : application d'une seule page en JavaScript natif, sans étape de build, avec le helper `h()` (pas d'`innerHTML`). Manifest et service worker pour l'installation sur téléphone.
* **PIN** : haché avec scrypt (`crypto.scrypt`, au niveau recommandé par l'OWASP).
* **Tests** : `node:test` pour le calcul des points et le cycle de vie des paris ; Playwright (Edge) pour les parcours sur téléphone.

### Hébergement

* **Auto-hébergé** : un serveur Node 24.7 ou plus récent, derrière une adresse HTTPS (reverse proxy ou hébergeur
  Node). Les amis n'ont rien à installer : ils ouvrent le lien du groupe. Le lien du groupe reste le seul secret.
* La base SQLite tient dans un fichier, qui se sauvegarde et se déplace tel quel. Installation : voir le
  [README](../README.md).

### Modèle de données (esquisse)

| Table | Contenu principal |
|---|---|
| `groups` | Nom, emoji, adresse (le lien du groupe), réglages (JSON) |
| `players` | Le compte : pseudo (unique), avatar, hash du PIN, essais ratés, blocages |
| `player_sessions` | Compte, hash du jeton de session, dernière activité |
| `members` | Compte, groupe, pseudo et avatar (recopiés du compte), rôle, statut |
| `bets` | Groupe, créateur (vide : ouvert automatiquement), arbitre, catégorie, question, précisions, statut, clôture, résultat attendu, option gagnante, dates de résolution et de validation, source, classement et saison |
| `seasons` | Groupe, classement (compétition ou catégorie), libellé, début, fin, date de clôture, classement final figé (V2) |
| `bet_options` | Pari, libellé, ordre |
| `picks` | Pari, membre, option, date (un seul pronostic par membre et par pari) |
| `points` | Membre, type (gain, prime, correction), montant, pari concerné, date |
| `bet_events` | Historique du pari : précision ajoutée, clôture, résolution, contestation, annulation, correction |
| `disputes`, `votes` | Contestations (avec leur motif) et votes |
| `comments` | Pari, membre, texte ou emoji |
| `badges` | Membre, badge, date d'obtention |

## 10. Critères de recette : la V1 est terminée quand…

1. Sur un téléphone, un nouvel ami rejoint le groupe depuis le lien WhatsApp en moins de 30 secondes.
2. On crée un pari Oui/Non en moins d'une minute et on le partage dans WhatsApp.
3. On parie en 2 touches, et les points potentiels affichés sont justes.
4. Les tests de calcul couvrent : le cas normal, les arrondis, le pari unanime, l'absence de bon pronostic, moins de 2 participants, l'annulation, une contestation qui change le résultat, une correction par un admin, la prime de l'arbitre.
5. Le score de chacun est toujours égal à la somme de son journal de points.
6. Un pronostic envoyé une seconde après la clôture est refusé.
7. Cinq PIN faux bloquent le compte pendant 15 minutes (puis plus longtemps), et un lien régénéré bloque l'ancien.
8. L'arbitre ne peut pas parier sur son pari, et un membre ne peut pas choisir deux options.
9. Servie en HTTPS, l'app s'installe sur l'écran d'accueil d'un iPhone et d'un téléphone Android.

## 11. Feuille de route

| Version | Contenu |
|---|---|
| **V1** | Tout ce document : groupe rejoint par lien, paris custom (Oui/Non et choix multiples), pronostics gratuits avec cotes du groupe, résolution et contestation, classement général et mensuel, fil d'activité, commentaires |
| V1.1 | Notifications push (nouveau pari, clôture proche, résultat), photos (preuve, illustration), joker (doubler les points d'un pari, une fois par semaine) |
| V1.1 | Livré le 2026-10-30 : réglages des paris (types, catégories, sources) et paris tout prêts à résultat automatique (§ 7.11) |
| V1.2 | Livré le 2026-10-30 : paris sur les Grands Prix moto (MotoGP, Moto2, Moto3), § 7.11 |
| V2 | Livré le 2026-10-30 : classements par compétition et par saison (vraies saisons, champion, historique, § 7.7), paris ouverts automatiquement, football américain, rugby, basket, hockey, baseball, tennis, MMA, football australien (§ 7.11) |
| V3 | Livré le 2026-10-30 : barème à cote fixe, joueur multi-groupes (pronostic partagé), compétitions suivies, design sportif et avatars, tablette et PC, site et aide |
| V3.1 | Télé-réalité ; mode « le plus proche gagne » (nombre, date, score) ; paris en direct pendant un match ou une émission ; passage sur un serveur permanent |
| V3 | Cotes indicatives des bookmakers (The Odds API) et probabilités des marchés prédictifs (Manifold, Kalshi), affichées à côté des cotes du groupe |

## 12. Décisions

| Sujet | Décision (2026-10-29) |
|---|---|
| Nom | « Pari tenu ! » |
| Hébergement | Auto-hébergé : chaque installation tourne sur son serveur ; logiciel libre, réglé depuis son admin (2026-11-03) |
| Visibilité | Tout le monde voit tout, à tout moment |
| Économie | Paris gratuits : on ne mise rien et on ne fait que gagner des points (100 × la cote du groupe) |
| Saisons | ~~Pas de remise à zéro (onglet « Ce mois-ci »)~~ — remplacé le 2026-10-30 : classement par compétition (ou catégorie), sur les vraies saisons (officielles pour le sport, équinoxes et solstices sinon) ; champion en fin de saison, remise à zéro, historique gardé |
| Barème des paris sportifs (2026-10-30) | Cote fixe des bookmakers (sinon barème fixe), jamais de cote à 1 |
| Plusieurs groupes (2026-10-30) | Un pronostic sur un même pari de source compte dans tous les groupes du joueur ; classements propres à chaque groupe |
| Compétitions suivies (2026-10-30) | Le groupe propose, chaque membre choisit d'y participer : pas de paris qui encombrent ceux que ça n'intéresse pas |
| Design (2026-10-30) | Plus sportif (fini les « bisounours »), avatars sportifs, versions tablette et PC, site et aide |
| Paris de sport (2026-10-30) | Un seul pari par match ou par course : le résultat, « point barre » |
| Paris automatiques (2026-10-30) | Les paris des compétitions activées s'ouvrent tout seuls ; rien n'est activé d'office ; tous les sports disponibles gratuitement |
| Grands Prix moto (2026-10-30) | Paris tout prêts sur les courses moto (MotoGP, Moto2, Moto3 ; course et sprint), comme la F1 |
| Réglages des paris (2026-10-30) | Une page de config du groupe active ou désactive types et catégories ; une catégorie activée branche ses sources de données (paris tout prêts, résultat automatique) |
| Un compte par joueur (2026-10-31) | Un seul compte (pseudo unique sur l'instance, avatar, PIN) et une connexion par appareil, valables dans tous ses groupes ; connexion depuis le lien d'un groupe (plus depuis l'accueil, 2026-11-03) ; PIN oublié : un admin de chacun de ses groupes |
| Padel (2026-10-31) | Premier Padel (Major, P1, P2, Finals), messieurs et dames, par Padel API (gratuit avec une clé personnelle) ; l'API officielle de Premier Padel répond mais ne publie aucun match |
| Résultat officiel (2026-11-01) | Un pari réglé par une source ne se conteste plus ; ses points tombent dès le résultat officiel (plus de 24 h de validation) ; une erreur de la source se corrige par un admin du groupe |
| Admin du site et coupons (2026-11-01) | Une admin `/admin` (mot de passe choisi sur le serveur) pour tous les comptes et groupes ; créer un groupe demande un coupon à usage unique, généré et suivi dans l'admin, à la place du code d'instance (§ 7.14) |
| Paris de sport en images (2026-10-31) | Écussons, photos, score en direct et final dans chaque pari, et une page « Direct » des matchs du jour (§ 7.13) |
| Rien d'activé dans un groupe neuf (2026-10-31) | Ni type, ni catégorie de paris maison, ni compétition ; les types ne règlent plus que les paris maison |
| Pseudo et avatar par joueur (2026-10-31) | Les mêmes dans tous ses groupes ; migration v6 : le dernier choix de chacun gagne partout |
| Paris maison à part (2026-10-30) | Les catégories ne règlent plus que les paris maison, les compétitions se règlent à part ; sans catégorie activée, pas de bouton |
