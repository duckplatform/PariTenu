import fs from 'node:fs';

// La version de PariTenu : celle de package.json, seule source. package-lock.json, public/manifest.webmanifest et
// CHANGELOG.md la recopient (« npm version patch|minor|major », voir scripts/version.mjs) ; test/project.test.js vérifie
// qu'ils sont d'accord. Les navigateurs la reçoivent avec l'identité de l'installation (services/branding.js : public()).
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
