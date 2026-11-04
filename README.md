# 🎲 PariTenu

Des paris **gratuits** entre amis : chacun propose ses paris, on fait un pronostic en deux touches, et les bons
pronostics rapportent des points. Plus on a raison seul contre le groupe, plus ça rapporte. Pas d'argent, pas
d'e-mail : un lien, un pseudo et un code PIN, qui forment un compte valable dans tous ses groupes.

PariTenu est un logiciel libre (licence MIT) à installer sur son propre serveur. Chaque installation choisit son nom
(« Pari tenu ! » par défaut), son adresse, les textes de sa page d'accueil, son icône et son thème depuis l'admin du
site, sans toucher au code.

* **Paris maison** Oui/Non ou à choix multiples, avec arbitre, verdict, contestation et vote.
* **Paris automatiques** : football, rugby, NFL, NBA, tennis, MMA, F1, MotoGP, météo, cryptos… Les paris des
  compétitions activées s'ouvrent seuls et leur résultat arrive seul (sources gratuites, sans clé).
* **Classements par compétition et par saison**, profils, badges, fil d'activité, commentaires.
* **Application installable** (PWA) sur téléphone, tablette et PC ; aide intégrée (`/help`).

## Prérequis

* **Node.js 24.7 ou plus récent** (la base utilise le SQLite intégré à Node : rien d'autre à installer).
* Un accès sortant à Internet pour les paris automatiques (résultats, scores, cotes).
* En production, une adresse en **HTTPS** : l'installation de l'app sur les téléphones et les cookies sécurisés
  l'exigent.

## Installation

```bash
git clone https://github.com/duckplatform/PariTenu.git paritenu
cd paritenu
npm ci --omit=dev
cp .env.example .env
npm run admin
npm start
```

* `npm ci --omit=dev` installe les trois dépendances (express, helmet, zod), sans les outils de test.
* `.env` règle le port, l'emplacement de la base, etc. (voir [Configuration](#configuration)) ; les valeurs par défaut
  conviennent pour un essai.
* `npm run admin` choisit le mot de passe de l'**admin du site** (`/admin`). Il ne se règle jamais depuis le site ;
  relancer la commande en cas d'oubli ou de blocage.
* `npm start` lance l'app sur http://localhost:5190. La base se crée au premier démarrage, ses migrations s'appliquent
  seules à chaque mise à jour.

**Premier groupe** : dans `/admin` → **Coupons**, générer un coupon et ouvrir son lien (`/n/<code>`) : il mène au
formulaire de création d'un groupe (et du compte qui va avec). Le lien du groupe se partage ensuite à ses membres,
c'est aussi par lui qu'ils se connectent. Un coupon ne sert qu'une fois ; l'admin voit qui l'a utilisé.

**Personnaliser** : `/admin` → **Configuration** règle le nom de l'installation, son adresse publique (celle des liens
partagés), les textes de l'accueil, l'hébergeur affiché en pied de page, l'icône et le thème. Son onglet
**Réinitialisation** repart de zéro (comptes, groupes, paris et classements effacés) en gardant tous ces réglages,
les sources coupées et les coupons ; une copie de la base est faite juste avant dans `backups/`.

**Paris automatiques** : dans les réglages d'un groupe (l'engrenage à côté de son nom) → Réglages des paris, un admin
du groupe active des compétitions ou des sources. Rien n'est activé d'office. L'admin du site peut couper une source
pour tous les groupes (`/admin` → **Sources**).

## Configuration

Les réglages techniques passent par des variables d'environnement ou par le fichier `.env` du dossier de l'app (modèle
commenté : [`.env.example`](.env.example)). Une variable déjà définie dans l'environnement l'emporte sur `.env`.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` / `HOST` | `5190` / `0.0.0.0` | Adresse d'écoute |
| `PT_DB_PATH` | `data/paritenu.db` | Base SQLite (un chemin relatif part du dossier de l'app). L'icône téléversée, les images des sources et les sauvegardes se rangent dans le même dossier |
| `PT_COOKIE_SECURE` | `auto` | `auto` : cookies `Secure` en HTTPS ; `always` : toujours (production) ; `never` : jamais |
| `PT_TRUST_PROXY` | `loopback` | Proxy de confiance : `loopback` (proxy sur la même machine), nombre de proxys, ou `false` |
| `PT_PADEL_TOKEN` | — | Clé gratuite de [Padel API](https://padelapi.org/register) ; sans elle, pas de paris de padel |
| `NODE_ENV` | — | `production` sur un serveur |
| `PT_TEST_HOOKS` | — | `1` : permet de déplacer l'horloge (tests et démo uniquement, **jamais en production**) |

Le nom du site, son adresse publique, ses textes, son icône et son thème ne sont pas des variables : ils se règlent
dans `/admin`, page Configuration.

## Mise en production

1. **HTTPS** : placer l'app derrière un reverse proxy (nginx, Caddy, Apache…) qui sert le domaine en HTTPS et relaie
   vers `http://127.0.0.1:5190`.
2. **`.env`** : `NODE_ENV=production`, `PT_COOKIE_SECURE=always`, `PT_TRUST_PROXY=loopback` (proxy sur la même machine)
   ou le nombre de proxys, et une base hors du dossier du code (`PT_DB_PATH=/var/lib/paritenu/paritenu.db`) pour que
   les mises à jour ne la touchent jamais. Mieux vaut tout régler dans `.env` : `npm run admin` et `npm run backup`
   le lisent aussi.
3. **Garder l'app lancée** avec le gestionnaire de services du système, par exemple systemd :

   ```ini
   # /etc/systemd/system/paritenu.service
   [Unit]
   Description=PariTenu
   After=network-online.target

   [Service]
   User=paritenu
   WorkingDirectory=/opt/paritenu
   ExecStart=/usr/bin/npm start
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   puis `systemctl enable --now paritenu`.
4. **Vérifier l'adresse des visiteurs** : `/admin` → **Journal** doit afficher la vraie adresse IP des visiteurs (les
   limites contre les essais de PIN en dépendent). Si elle vaut `127.0.0.1` ou `::1`, ajuster `PT_TRUST_PROXY`.

**Hébergeur avec Phusion Passenger** : indiquer `app.cjs` comme fichier de démarrage ; Passenger choisit le port
(`PORT` et `HOST` sont ignorés). S'il arrête les applications inactives, une requête régulière (par exemple
`curl -s -o /dev/null https://<domaine>/robots.txt` toutes les 4 minutes) garde actifs les résultats automatiques et
le direct.

L'app tourne en **un seul processus** : le nom du site, le thème et les sources coupées sont gardés en mémoire. Seul
l'accueil peut être indexé par les moteurs de recherche.

## Sauvegarde et mise à jour

```bash
npm run backup -- avant-mise-a-jour
```

copie la base (même pendant que l'app tourne) dans `backups/`, à côté de la base. Toute l'installation tient dans le
dossier de la base : le fichier SQLite, l'icône téléversée (`branding/`) et les images des sources (`media/`, qui se
retéléchargent). Une sauvegarde chaque nuit, par exemple avec cron :

```bash
30 3 * * * cd /opt/paritenu && npm run backup -- nuit
```

Les sauvegardes s'accumulent : penser à faire le ménage. Pour **mettre à jour** : sauvegarder, récupérer le nouveau
code (`git pull`), `npm ci --omit=dev`, puis redémarrer l'app. Les migrations de la base se font seules au démarrage ;
le [journal des modifications](CHANGELOG.md) signale ce qui demanderait une action.

## Démo

`npm run demo` recrée `data/demo.db` avec un groupe « Les Potes » (6 membres, 10 paris dans tous les états) et lance
l'app. Le lien du groupe s'affiche dans le terminal ; le PIN des membres est `DEMO_PIN` dans `scripts/demo.mjs`.
`npm run demo -- --keep` relance sans recréer la base.

## Développement

```bash
npm install        # dépendances, outils de test compris
npm run dev        # redémarre à chaque modification de src/
npm test           # tests unitaires (node:test) : barème, cycle de vie, sécurité, admin, saisons, sources…
npm run test:e2e   # parcours dans Microsoft Edge (4 téléphones et un PC), captures dans test/e2e/out/
npm run test:all   # les deux
```

Aucun test n'appelle Internet : les sources de données sont simulées (`test/fake-upstream.js`) et leurs analyseurs sont
vérifiés sur de vraies réponses capturées (`test/fixtures/sources/`). Les tests de bout en bout utilisent le Microsoft
Edge installé sur la machine (`playwright-core`, canal `msedge`) ; `npm run test:e2e -- --headed` pour les regarder.
GitHub Actions (`.github/workflows/tests.yml`) lance les deux à chaque envoi sur `main` et à chaque pull request.

### Publier une version

La version fait foi dans `package.json` ; elle s'affiche en pied de page (accueil, aide, page « Moi », admin du site).
Pas de tag Git ni de release GitHub : le [journal des modifications](CHANGELOG.md) est la référence.

1. Au fil de l'eau, noter chaque changement notable sous `## [Non publié]` dans `CHANGELOG.md`.
2. Choisir le niveau selon le [versionnage sémantique](https://semver.org/lang/fr/) et lancer :

   ```bash
   npm version minor   # ou patch, ou major
   ```

   `package.json` et `package-lock.json` changent de version, puis `scripts/version.mjs` la reporte dans
   `public/manifest.webmanifest` et transforme `[Non publié]` en `[x.y.z] - date du jour` dans `CHANGELOG.md`
   (`.npmrc` : ni commit ni tag).
3. Vérifier (`npm test`), puis committer ces fichiers.

## Documentation

* [Journal des modifications](CHANGELOG.md) : les versions et leurs nouveautés.
* [Cahier des charges](docs/01-cahier-des-charges.md) : règles du jeu, barème, cycle de vie d'un pari.
* [Technique](docs/03-technique.md) : architecture, API, modèle de données, sécurité.
* [Feuille de route](docs/04-roadmap.md) : les prochaines pistes.

## Pile

Node 24 (ESM), Express 5, zod, helmet ; SQLite intégré à Node (`node:sqlite`) ; interface en JavaScript natif sans
étape de build, installable (PWA) ; PIN hachés en scrypt (`crypto.scrypt`). Trois dépendances.

## Licence

[MIT](LICENSE).
