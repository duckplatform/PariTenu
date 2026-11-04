# 🎲 PariTenu

Des paris **gratuits** entre amis : chacun propose ses paris, on fait un pronostic en deux touches, et les bons
pronostics rapportent des points. Plus on a raison seul contre le groupe, plus ça rapporte. Pas d'argent, pas
d'e-mail : un lien, un pseudo et un code PIN, qui forment un compte valable dans tous ses groupes.

PariTenu est un logiciel libre : chaque installation choisit son nom (« Pari tenu ! » par défaut), son adresse, les
textes de sa page d'accueil, son icône et son thème dans la page ⚙️ **Configuration** de l'admin du site.

## Démarrer

```bash
npm install
npm start
```

L'app écoute sur http://localhost:5190 (et sur l'adresse du PC dans le réseau local). La première personne crée le
groupe depuis l'accueil, avec un coupon, puis partage le lien du groupe dans WhatsApp.

**Admin du site** (`/admin`, pages `/admin/users`, `/admin/groups`, `/admin/coupons`, `/admin/sources`,
`/admin/configuration`, `/admin/log`) : choisis d'abord son mot de passe sur le serveur, jamais depuis le site :

```bash
npm run admin
```

Tu y gères les comptes et les groupes (voir, modifier, ajouter à un groupe, débloquer, réinitialiser un PIN, déconnecter
partout, supprimer ; les classements et tous les réglages de chaque groupe : points, délais, types de paris, catégories,
compétitions), tu coupes ou rallumes une **source** de données pour tous les
groupes (foot, padel, météo…), et tu règles la **Configuration** du site (nom, adresse publique, textes de l'accueil, hébergeur,
icône, thème), et tu génères les **coupons** : créer un groupe (et le compte qui va avec) en demande un, à usage
unique ; tu suis lequel a servi, à qui, pour quel groupe. Pour rejoindre un groupe, son lien suffit (c'est aussi là qu'on se connecte). Le
lien d'un coupon (`/n/<code>`) ouvre le formulaire de création, coupon rempli (sans coupon dans l'adresse, pas de formulaire). Mot de passe oublié ou admin bloqué : relance
`npm run admin`.

**Paris automatiques** : dans ⚙️ Réglages du groupe (l'engrenage à côté de son nom) → Réglages des paris, un admin active des compétitions (Ligue 1, NFL,
Top 14, NBA, ATP, UFC, F1, MotoGP…) ou des sources (météo de ta ville, cryptos, actu). Rien n'est activé d'office. Tous
leurs paris disponibles s'ouvrent alors tout seuls (en sport, un seul par match ou par course : qui gagne ?), et le
résultat arrive tout seul. Ces sources sont gratuites et sans
clé ; le serveur doit pouvoir sortir sur Internet.

**Points des paris sportifs** (cote fixe) : un bon pronostic rapporte 100 × la cote des bookmakers, connue
avant de parier (barème fixe de 200 pts quand aucune cote n'est connue). **Plusieurs groupes** : un pronostic sur un
match vaut dans tous tes groupes où il est ouvert. **Chacun choisit ses compétitions** : le groupe propose, tu participes
à ce qui t'intéresse. L'app s'utilise sur téléphone, tablette et PC ; l'aide est dans l'app (`/help`).

**Classements et saisons** : un classement par compétition (et un par catégorie pour les autres paris), sur les vraies
saisons. À la fin de la saison, le meilleur score est sacré champion et tout repart de zéro ; les saisons passées, leurs
champions et leurs paris restent consultables.

**Démo** : `npm run demo` recrée `data/demo.db` avec un groupe « Les Potes » (6 membres, 10 paris dans tous les états)
et lance l'app. Le lien du groupe s'affiche dans le terminal ; le PIN des membres est `DEMO_PIN` dans
`scripts/demo.mjs`. `npm run demo -- --keep` relance sans recréer la base.

### Pour tes amis : Tailscale Funnel

Funnel donne au PC une adresse publique en HTTPS (`https://<nom-du-pc>.<tailnet>.ts.net:8443`). Les amis
n'installent rien, et le HTTPS permet d'installer l'app sur l'écran d'accueil des téléphones.

1. Choisis le mot de passe de l'admin (`npm run admin`) : l'adresse est publique, et seuls ceux à qui tu envoies un
   coupon (généré dans `/admin`) peuvent créer un groupe sur ton PC ; les amis entrent avec le lien du groupe.
2. Lance l'app (`npm start`), puis ouvre Funnel :

```bash
tailscale funnel --bg --https=8443 5190
```

Le port 8443 laisse libre le 443, souvent déjà pris par un autre `tailscale serve` (`tailscale funnel 5190` le
remplacerait). La première fois, Tailscale demande d'autoriser Funnel pour ce PC dans la console d'administration.
`tailscale funnel status` montre ce qui est ouvert, et cette commande referme l'accès public :

```bash
tailscale funnel --https=8443 off
```

L'app n'est joignable que quand le PC est allumé et que `npm start` tourne. Le lien du groupe est le seul secret :
ne le partage que dans le groupe (l'admin peut le changer à tout moment).

### Configuration (variables d'environnement ou `.env`)

Les variables d'environnement l'emportent toujours (sous cPanel : celles de « Setup Node.js App ») ; le fichier `.env`
du dossier de l'app ne fait que compléter celles qui manquent.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` / `HOST` | `5190` / `0.0.0.0` | Adresse d'écoute |
| `PT_DB_PATH` | `data/paritenu.db` | Base SQLite (un seul fichier à sauvegarder : `npm run backup`) ; un chemin relatif part du dossier de l'app |
| `PT_COOKIE_SECURE` | `auto` | `auto` : cookie Secure en HTTPS et sur `*.ts.net` ; `always` ; `never` |
| `PT_TRUST_PROXY` | `loopback` | Proxy de confiance (Funnel, Caddy en local) ; `false` pour aucun |
| `PT_TEST_HOOKS` | — | `1` : permet de déplacer l'horloge (tests seulement, jamais en vrai) |
| `PT_PADEL_TOKEN` | — | Clé gratuite de [Padel API](https://padelapi.org/register) : sans elle, pas de paris de padel |

Le nom du site, son adresse publique (celle des liens partagés), ses textes et son icône ne sont pas des variables :
ils se règlent dans `/admin`, page Configuration.

## Tests

```bash
npm test           # 219 tests : barème, cycle de vie, sécurité, admin et coupons, saisons et classements, sources, simulation de 360 paris
npm run test:e2e   # 30 scénarios dans Edge (4 téléphones et un PC), captures dans test/e2e/out/
npm run test:all   # les deux
```

Aucun test n'appelle Internet : les sources de données sont simulées (`test/fake-upstream.js`) et leurs analyseurs
sont vérifiés sur de vraies réponses capturées (`test/fixtures/sources/`).

Les tests de bout en bout utilisent Microsoft Edge installé sur la machine (`playwright-core`, canal `msedge`) : rien
à télécharger. `npm run test:e2e -- --headed` pour regarder. `test/e2e/out/planche.png` rassemble les écrans clés.

**GitHub Actions** (`.github/workflows/tests.yml`) : à chaque envoi sur `main`, à chaque pull request et à la demande,
les tests unitaires tournent sous Linux et le parcours dans Edge sous Windows ; ses captures sont jointes au résultat
(artefact « captures-edge », gardé 14 jours).

## Documentation

* [Cahier des charges](docs/01-cahier-des-charges.md) : règles du jeu, barème, cycle de vie d'un pari.
* [Technique](docs/03-technique.md) : architecture, API, modèle de données, sécurité.
* [Installer sur cPanel](docs/05-installation-cpanel.md) : Phusion Passenger, variables d'environnement, données, tâches planifiées.
* [Feuille de route](docs/04-roadmap.md) : ce qui est fait, ce qui reste à vérifier, la suite.

## Pile

Node 24 (ESM), Express 5, zod, helmet ; SQLite intégré à Node (`node:sqlite`) ; interface en JavaScript natif sans
étape de build, installable (PWA) ; PIN hachés en scrypt (`crypto.scrypt`). Trois dépendances.
