# Feuille de route

Les pistes pour les prochaines versions de PariTenu. Ce qui est déjà livré est décrit dans le
[journal des modifications](../CHANGELOG.md) ; les règles du jeu dans le [cahier des charges](01-cahier-des-charges.md).

## Prochaines versions

* Notifications push : nouveau pari, clôture proche, verdict, vote.
* Photos : preuve jointe au verdict, illustration d'un pari.
* Joker : doubler les points d'un pari, une fois par semaine.
* QR code du lien du groupe.
* Mode « le plus proche gagne » (nombre, date, score).
* Paris en direct pendant un match ou une émission.
* Plus de sources : Superbike (WorldSBK), télé-réalité, Pro D2, EuroLeague (pas de données gratuites trouvées à ce
  jour).
* Cotes indicatives des bookmakers (The Odds API) et probabilités des marchés prédictifs (Manifold, Kalshi) affichées à
  côté des cotes du groupe.
* Installation simplifiée : image Docker prête à l'emploi ; base MySQL en option pour les hébergements qui la
  préfèrent à SQLite.

## À vérifier sur de vrais appareils

Ces points sont couverts par les tests (navigateur Edge, sources simulées) mais restent à observer en situation réelle :

* les thèmes sur des téléphones anciens (polices, effets de flou) ;
* l'installation sur l'écran d'accueil d'un iPhone et d'un Android, et le partage natif vers les messageries ;
* la situation de jeu en direct en football américain et en baseball, écrite d'après le format documenté des données ;
* le football australien et le rugby à XIII, hors saison au moment de la première version.
