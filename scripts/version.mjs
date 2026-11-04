// Reporte la version de package.json dans public/manifest.webmanifest et CHANGELOG.md.
//
// Lancé par « npm version patch|minor|major » (script « version » de package.json), une fois package.json et
// package-lock.json passés à la nouvelle version. .npmrc (git-tag-version=false) : ni commit ni tag Git, la version
// vit dans les fichiers. Dans CHANGELOG.md, la section « [Non publié] » devient « [x.y.z] - date du jour » et une
// nouvelle section « [Non publié] », vide, s'ouvre au-dessus. Relancer le script ne change rien de plus.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = (name) => path.join(ROOT, name);
const UNRELEASED = '## [Non publié]';

const { version } = JSON.parse(fs.readFileSync(file('package.json'), 'utf8'));
// La date du jour à Paris, au format AAAA-MM-JJ.
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

// Le manifeste de l'app installable.
const manifestPath = file('public/manifest.webmanifest');
const manifestText = fs.readFileSync(manifestPath, 'utf8');
if (JSON.parse(manifestText).version !== version) {
  // Remplacement sur place : la mise en forme du fichier (icônes sur une ligne) ne bouge pas.
  const next = /"version":\s*"[^"]*"/.test(manifestText)
    ? manifestText.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
    : `${JSON.stringify({ ...JSON.parse(manifestText), version }, null, 2)}\n`;
  fs.writeFileSync(manifestPath, next);
  console.log(`public/manifest.webmanifest : ${version}`);
}

// Le journal des modifications.
const changelogPath = file('CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
if (changelog.includes(`## [${version}]`)) {
  console.log(`CHANGELOG.md : la section ${version} existe déjà`);
} else if (!changelog.includes(UNRELEASED)) {
  console.error(`CHANGELOG.md : pas de section « ${UNRELEASED} » à publier en ${version}`);
  process.exit(1);
} else {
  fs.writeFileSync(changelogPath, changelog.replace(UNRELEASED, `${UNRELEASED}\n\n## [${version}] - ${today}`));
  console.log(`CHANGELOG.md : « [Non publié] » devient [${version}] - ${today}`);
}
