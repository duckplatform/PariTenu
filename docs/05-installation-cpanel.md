# Installer PariTenu sur cPanel (Phusion Passenger)

PariTenu tourne sur un hébergement cPanel qui propose **Setup Node.js App** (Phusion Passenger, souvent avec
CloudLinux). La base reste un fichier SQLite : rien à créer dans « MySQL Databases » (MySQL viendra plus tard, voir la
feuille de route).

Dans ce guide, `<utilisateur>` est ton identifiant cPanel (le dossier personnel est `/home/<utilisateur>`) et
`paris.example.fr` l'adresse choisie pour l'app.

## Ce qu'il faut

* **Node.js 24.7 ou plus récent** dans Setup Node.js App : la base utilise le SQLite intégré à Node. Les PIN sont hachés
  avec scrypt (`crypto.scrypt`) : le Node de cPanel, lié à l'OpenSSL du système, n'a pas `crypto.argon2`.
* Un **sous-domaine** (ou un domaine) avec un **certificat SSL** : l'app installable sur les téléphones et ses cookies
  demandent HTTPS.
* Le **Terminal** de cPanel (pour choisir le mot de passe de l'admin) et les **Cron Jobs**.

## 1. Le sous-domaine et son certificat

1. **Domains** → **Create A New Domain** : `paris.example.fr`. Laisse cPanel choisir son dossier (il ne contiendra que
   le fichier `.htaccess` que Passenger écrit).
2. **SSL/TLS Status** : lance **AutoSSL** pour ce sous-domaine (Let's Encrypt ou Sectigo), jusqu'au cadenas vert.

## 2. Envoyer le code

Le code va dans un dossier **hors de** `public_html`, par exemple `/home/<utilisateur>/paritenu`. Les données vont dans
un autre dossier, par exemple `/home/<utilisateur>/paritenu-data` : une mise à jour du code ne les touche jamais.

* **Avec Git (conseillé)** : le dépôt GitHub est cloné dans un dossier à part, et `.cpanel.yml` (à la racine du dépôt)
  copie le code dans l'application à chaque déploiement, installe les dépendances et redémarre Passenger.
  1. **Git Version Control** → **Create** : l'adresse du dépôt (`https://github.com/<compte>/PariTenu.git` ; pour un
     dépôt privé, l'adresse SSH `git@github.com:<compte>/PariTenu.git` et la clé SSH de cPanel ajoutée au dépôt sur
     GitHub comme « Deploy key », en lecture seule), dossier `/home/<utilisateur>/repositories/PariTenu` (**pas** le
     dossier de l'application).
  2. Crée d'abord l'application (étape 3) : `.cpanel.yml` utilise son environnement Node
     (`~/nodevenv/paritenu/24`) et copie le code dans `~/paritenu`.
  3. **Manage** → **Pull or Deploy** → **Deploy HEAD Commit**.
* **Avec une archive** : sur ton PC, une archive du projet **sans** `node_modules/`, `data/`, `.env` ni `test/e2e/out/`.
  Dans **File Manager**, envoie-la dans `/home/<utilisateur>/paritenu`, puis **Extract**.

## 3. Créer l'application Node.js

**Setup Node.js App** → **Create Application** :

| Champ | Valeur |
|---|---|
| Node.js version | 24.x (24.7 au moins) |
| Application mode | Production |
| Application root | `paritenu` |
| Application URL | `paris.example.fr` |
| Application startup file | `app.cjs` |

**Environment variables** : c'est ici qu'on règle l'app. Le fichier `.env` n'est qu'un secours : une variable
définie ici l'emporte toujours.

| Variable | Valeur | Rôle |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PT_DB_PATH` | `/home/<utilisateur>/paritenu-data/paritenu.db` | La base ; l'icône (`branding/`), les images des sources (`media/`) et les sauvegardes (`backups/`) se rangent à côté |
| `PT_COOKIE_SECURE` | `always` | Cookies réservés au HTTPS |
| `PT_PADEL_TOKEN` | ta clé Padel API | Facultatif : sans elle, pas de paris de padel |
| `PT_TRUST_PROXY` | (vide au départ) | Voir l'étape 7 |
| `NODE_OPTIONS` | `--disable-warning=ExperimentalWarning` | Facultatif : retire l'avertissement « SQLite expérimental » du journal |

`PORT` et `HOST` ne servent pas : Passenger choisit lui-même.

Puis **Create**, et **Run NPM Install** (installe express, helmet et zod).

## 4. Les données

* **Repartir de zéro** : rien à faire, la base se crée au premier démarrage.
* **Reprendre l'installation de ton PC** (groupes, comptes, paris, réglages, mot de passe de l'admin) :
  1. sur le PC, `npm run backup -- demenagement` : une copie cohérente de la base dans `data/backups/` ;
  2. dans File Manager, crée `/home/<utilisateur>/paritenu-data/` et envoie-y cette copie, renommée `paritenu.db` ;
  3. si une icône a été téléversée dans la page Configuration, envoie aussi le dossier `data/branding/` (dans
     `paritenu-data/branding/`) ; `data/media/` est facultatif (les images des sources se retéléchargent).

Après la copie, ce qui se passe encore sur le PC n'est plus repris : fais-la juste avant l'étape 5 et arrête
l'ancienne installation ensuite (étape 9).

## 5. Démarrer

**Setup Node.js App** → **Restart**, puis ouvre `https://paris.example.fr`. En cas d'erreur, le journal de Passenger
(`stderr.log` dans le dossier de l'app, ou le lien « Logs » de cPanel) dit pourquoi.

**Mot de passe de l'admin** (seulement si la base est neuve) : en haut de la page de l'application, cPanel affiche une
commande « Enter to the virtual environment ». Colle-la dans le **Terminal** de cPanel, puis :

```bash
cd ~/paritenu
npm run admin
```

## 6. Régler l'installation

Dans `https://paris.example.fr/admin` → **Configuration** : le nom, le nom court, l'**adresse publique**
(`https://paris.example.fr` : les liens d'invitation et de coupon la prennent), les textes de l'accueil, l'hébergeur
et l'icône.

## 7. Vérifier l'adresse des visiteurs

Les limites contre les essais de PIN comptent par adresse IP. Dans l'admin, page **Journal** (colonne « Adresse » et
« Sessions admin ouvertes ») : l'adresse affichée doit être la tienne (celle que donne un site comme « quelle est mon
IP »).

* C'est la bonne : rien à faire.
* C'est `127.0.0.1`, `::1` ou une adresse vide : Passenger relaie les visiteurs. Mets `PT_TRUST_PROXY` à `1` (un
  relais de confiance), **Restart**, et revérifie.

## 8. Garder l'app éveillée

Passenger arrête une application restée quelques minutes sans visite ; avec elle s'arrêtent les résultats
automatiques, le direct et l'ouverture des paris. Une visite toutes les 4 minutes la garde éveillée.

**Cron Jobs** → **Add New Cron Job**, réglage `*/4 * * * *` :

```bash
curl -s -o /dev/null https://paris.example.fr/robots.txt
```

Et une sauvegarde chaque nuit (réglage `30 3 * * *`), avec la commande « virtual environment » de l'étape 5 :

```bash
source /home/<utilisateur>/nodevenv/paritenu/24/bin/activate && cd /home/<utilisateur>/paritenu && npm run backup -- nuit
```

(le chemin exact de `nodevenv` est celui affiché par cPanel). Les sauvegardes s'accumulent dans
`paritenu-data/backups/` : fais le ménage de temps en temps.

## 9. Quitter l'ancienne installation

Les liens d'invitation déjà envoyés pointent vers l'ancienne adresse. Une fois la nouvelle en place :

1. dans chaque groupe, un admin repartage le lien d'invitation (page Réglages du groupe → Partager) : il part sur la
   nouvelle adresse ;
2. les joueurs ouvrent ce nouveau lien et se reconnectent (pseudo et PIN : ce sont les mêmes) ; une app installée sur
   l'écran d'accueil se réinstalle depuis la nouvelle adresse ;
3. arrête l'ancienne installation (pour Tailscale Funnel : `tailscale funnel --https=8443 off`, puis arrêter
   `npm start`).

## Mettre à jour

1. `npm run backup -- avant-mise-a-jour` (Terminal, environnement virtuel) ;
2. **avec Git** : **Git Version Control** → **Manage** → **Pull or Deploy** → **Update from Remote**, puis **Deploy
   HEAD Commit** (`.cpanel.yml` copie, installe et redémarre) ;
   **avec une archive** : envoie le nouveau code dans `/home/<utilisateur>/paritenu` (sans toucher à `paritenu-data/`),
   puis **Run NPM Install** si `package.json` a changé, et **Restart**.

Les migrations de la base se font seules au démarrage. Le déploiement par Git ne supprime pas les fichiers retirés du
dépôt : sans conséquence pour l'app, mais un ménage de `~/paritenu` peut se faire à la main de temps en temps.

## Ce que l'app suppose

* **Un seul processus** : pour une application Node, qui sert plusieurs visiteurs à la fois, Passenger n'en lance
  normalement qu'un. Le nom du site, le thème et les sources coupées sont gardés en mémoire par ce processus ; si
  l'hébergeur en lançait plusieurs, un changement fait dans l'admin pourrait n'apparaître qu'après un **Restart**.
* **Moteurs de recherche** : seul l'accueil peut être indexé (`/robots.txt` et `X-Robots-Tag` sur tout le reste).
