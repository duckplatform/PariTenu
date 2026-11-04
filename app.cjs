// Fichier de démarrage pour les hébergeurs qui lancent l'app avec Phusion Passenger (fichier de démarrage : app.cjs).
// L'app est écrite en modules ES ; ce petit fichier CommonJS la charge, quelle que soit la façon dont Passenger lit le
// fichier de démarrage. Passenger choisit lui-même le port : l'app l'écoute sans rien régler.
import('./src/server.js').catch((err) => {
  console.error('[erreur] PariTenu n’a pas pu démarrer :', err);
  process.exit(1);
});
