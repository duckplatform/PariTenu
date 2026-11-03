import os from 'node:os';
import { createApp } from './app.js';
import { buildConfig, loadDotEnv } from './config.js';

const logger = {
  info: (data, msg) => console.log(`[info] ${msg}`, Object.keys(data).length ? data : ''),
  warn: (data, msg) => console.warn(`[warn] ${msg}`, data),
  error: (data, msg) => console.error(`[erreur] ${msg}`, data),
};

loadDotEnv();
const config = buildConfig();
const { app, deps, close } = createApp(config, { logger });

// Sous Phusion Passenger (cPanel), c'est lui qui choisit le port et sert l'adresse publique.
const passenger = typeof globalThis.PhusionPassenger !== 'undefined';

const server = app.listen(config.port, config.host, () => {
  if (passenger) {
    console.log(`[info] PariTenu est lancé sous Passenger (Node ${process.version}, base ${config.dbPath})`);
    if (!deps.admin.hasPassword()) console.log('[info] Admin (/admin) : choisis son mot de passe avec « npm run admin » dans le terminal de cPanel');
    return;
  }
  const urls = [`http://localhost:${config.port}`];
  if (config.host === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${config.port}`);
      }
    }
  }
  const { name, publicUrl } = deps.branding.get();
  console.log(`\n  🎲 PariTenu est lancé${name === 'Pari tenu !' ? '' : ` : « ${name} »`}`);
  for (const url of urls) console.log(`     ${url}`);
  if (publicUrl) console.log(`     ${publicUrl} (adresse publique, page Configuration de /admin)`);
  // 8443 et non 443 : « tailscale funnel <port> » remplacerait un « tailscale serve » déjà présent sur le 443.
  console.log(`\n  Pour tes amis (HTTPS, rien à installer) : tailscale funnel --bg --https=8443 ${config.port}`);
  if (!deps.admin.hasPassword()) console.log('  🔐 Admin (/admin) : choisis son mot de passe avec « npm run admin »');
  // Avant les coupons, un code commun dans .env permettait de créer un groupe : il ne sert plus.
  if (process.env.PT_INSTANCE_CODE) console.log('  ℹ PT_INSTANCE_CODE (.env) ne sert plus : créer un groupe demande un coupon, généré dans /admin');
  if (config.testHooks) console.log('  ⚠ PT_TEST_HOOKS actif : l’horloge peut être déplacée par /api/_test/clock (tests et démo seulement)');
  console.log('');
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
