// Vue d'ensemble (ce qui demande une action d'abord, puis les chiffres, les groupes et le journal) et page Journal
// (chaque action de l'admin, les sessions admin ouvertes).
import { h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { run } from '../ui.js';
import { newCoupon } from './coupons.js';
import { newPlayer } from './players.js';
import { aget, ago, apost, button, card, clock, filters, iconTile, more, pageHead, plural, soon, table, tile, when } from './kit.js';

// Le journal : une icône et une couleur par action.
const LOG_ICONS = {
  login: ['login', 'muted'], logout: ['logout', 'muted'], login_failed: ['ban', 'bad'], password_set: ['key', 'warn'], password_changed: ['key', 'warn'],
  coupon_created: ['ticket', 'info'], coupon_revoked: ['ban', 'bad'], coupon_used: ['checkCircle', 'ok'],
  player_created: ['userPlus', 'ok'], player_updated: ['pencil', 'info'], player_unlocked: ['unlock', 'ok'], player_pin_reset: ['key', 'warn'],
  player_logged_out: ['phone', 'muted'], player_deleted: ['trash', 'bad'],
  group_created: ['users', 'ok'], group_updated: ['pencil', 'info'], group_invite: ['refresh', 'info'], group_address: ['refresh', 'info'], group_deleted: ['trash', 'bad'],
  member_added: ['userPlus', 'ok'], member_role: ['shield', 'info'], member_removed: ['userMinus', 'bad'], member_reinstated: ['userPlus', 'ok'],
  source_disabled: ['pause', 'bad'], source_enabled: ['play', 'ok'], theme_changed: ['palette', 'info'], branding_changed: ['settings', 'info'], icon_changed: ['image', 'info'],
  instance_reset: ['trash', 'bad'],
};
// Les filtres du journal : les actions de chaque famille.
const LOG_KINDS = {
  access: /^(login|logout|login_failed|password_)/, players: /^player_/, groups: /^(group_|member_)/, coupons: /^coupon_/, site: /^(source_|theme_|branding_|icon_|instance_)/,
};

/** Une ligne du journal mène à ce qu'elle concerne (compte, groupe ou source), s'il existe encore. */
function logText(e) {
  const [kind, id] = e.target.split(':');
  const href = { player: '/admin/users/', group: '/admin/groups/', source: '/admin/sources/' }[kind];
  return href && id && !/deleted$/.test(e.action) ? h('a.adm-log-link', { href: href + id }, e.summary) : h('span', e.summary);
}
const logIcon = (e) => iconTile(...(LOG_ICONS[e.action] ?? ['activity', 'muted']), 'sm');
const logRow = (e) => h('li.adm-log-row', logIcon(e), h('span.adm-grow', logText(e)), h('small', { title: when(e.at) }, ago(e.at)));

const today = () => {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return s[0].toUpperCase() + s.slice(1);
};

/** « À traiter » : chaque point dit ce qui se passe et mène à ce qui le règle. */
function attentionCard(items, refresh) {
  const unlock = (p) => async (e) => { if (await run(e.currentTarget, () => apost(`/players/${p.id}/unlock`), { success: `${p.pseudo} est débloqué.` })) refresh(); };
  const row = ({ name, tone, title, text, action }) => h('li.adm-todo', iconTile(name, tone), h('div.adm-grow', h('b', title), h('small', text)), action);
  const ROWS = {
    locked: (a) => ({
      name: 'lock', tone: 'bad', title: `${a.player.pseudo} est bloqué jusqu’à ${clock(a.until)}`,
      text: 'Trop de PIN faux d’affilée. Si c’est bien lui qui se trompe, débloque-le.',
      action: button('Débloquer', { icon: 'unlock', small: true, onclick: unlock(a.player) }),
    }),
    new_pin: (a) => ({
      name: 'key', tone: 'warn', title: a.players.length > 1 ? `${a.players.length} comptes attendent leur PIN` : `${a.players[0].pseudo} n’a pas encore choisi son PIN`,
      text: `${a.players.map((p) => `${p.pseudo} (${ago(p.since).replace(/^il y a /, 'depuis ')})`).join(', ')} : envoie-${a.players.length > 1 ? 'leur' : 'lui'} le lien de son groupe, le PIN se choisit en l’ouvrant.`,
      action: button('Voir', { small: true, href: a.players.length > 1 ? '/admin/users?state=new_pin' : `/admin/users/${a.players[0].id}` }),
    }),
    source_key: (a) => ({
      name: 'radio', tone: 'warn', title: `${a.source.emoji} ${a.source.name} : clé manquante`,
      text: `Ajoute ${a.keyName} dans le fichier .env du serveur, ou coupe la source si tu n’en veux pas.`,
      action: button('Voir la source', { small: true, href: `/admin/sources/${a.source.id}` }),
    }),
    source_down: (a) => ({
      name: 'alert', tone: 'bad', title: `${a.source.emoji} ${a.source.name} ne répond plus`,
      text: `Depuis ${ago(a.since).replace('il y a ', '')}${a.error ? ` (${a.error})` : ''}. Dernière lecture réussie : ${a.readAt ? ago(a.readAt) : 'aucune depuis le démarrage du serveur'}.`,
      action: button('Voir', { small: true, href: `/admin/sources/${a.source.id}` }),
    }),
    coupon_expiring: (a) => ({
      name: 'ticket', tone: 'warn', title: `Le coupon …${a.coupon.hint}${a.coupon.note ? ` (${a.coupon.note})` : ''} expire ${soon(a.expiresAt)}`,
      text: 'Il n’a pas encore servi : relance la personne, ou laisse-le expirer.',
      action: button('Voir', { small: true, href: '/admin/coupons' }),
    }),
    empty_group: (a) => ({
      name: 'users', tone: 'muted', title: `« ${a.group.name} » n’a plus aucun membre`, text: 'Supprime-le s’il ne sert plus.',
      action: button('Ouvrir', { small: true, href: `/admin/groups/${a.group.id}` }),
    }),
    idle_group: (a) => ({
      name: 'users', tone: 'muted', title: `« ${a.group.name} » n’a encore aucun pari`,
      text: `Créé ${ago(a.createdAt)} : personne n’a lancé de pari et aucune compétition n’est activée.`,
      action: button('Ouvrir', { small: true, href: `/admin/groups/${a.group.id}` }),
    }),
  };
  const rows = items.map((a) => ROWS[a.type]?.(a)).filter(Boolean);
  return card('À traiter', { flush: true, extra: rows.length ? h('span.adm-pill.is-bad', String(rows.length)) : null },
    rows.length ? h('ul.adm-todos', rows.map(row))
      : h('div.adm-allgood', icon('checkCircle'), h('div', h('b', 'Rien à traiter'),
        h('small', 'Aucun compte bloqué, toutes les sources répondent, aucun coupon n’expire bientôt.'))));
}

/** Les chiffres, avec ce qui bouge ; les pronostics des 14 derniers jours en barres. */
function kpis(o) {
  const week = o.picksByDay.slice(-7).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...o.picksByDay);
  const bars = h('div.adm-spark', { role: 'img', 'aria-label': `Pronostics par jour, du plus ancien à aujourd’hui : ${o.picksByDay.join(', ')}` },
    o.picksByDay.map((n, i) => {
      const bar = h('i', { class: i >= o.picksByDay.length - 7 ? 'is-now' : '' });
      bar.style.setProperty('--h', `${Math.max(6, (n / max) * 100)}%`);
      return bar;
    }));
  const kpi = (href, label, value, note, extra = null) => h('a.adm-kpi', { href }, h('small', label), h('b.num', String(value)), h('span.adm-kpi-note', note), extra);
  return h('section.card.adm-kpis', { 'aria-label': 'Chiffres clés' },
    kpi('/admin/users', 'Comptes', o.players, o.newPlayers ? [h('span.adm-up', `+${o.newPlayers}`), ' en 7 jours'] : 'aucun nouveau en 7 jours'),
    kpi('/admin/users', 'Actifs en 24 h', o.activeToday, `sur ${plural(o.players, 'compte')}`),
    kpi('/admin/groups', 'Paris ouverts', o.openBets, o.closingSoon ? `${o.closingSoon} se ferme${o.closingSoon > 1 ? 'nt' : ''} dans les 24 h` : 'aucun ne ferme dans les 24 h'),
    kpi('/admin/groups', 'Groupes', o.groups, o.groupsWithoutBets ? `dont ${o.groupsWithoutBets} sans pari` : 'tous ont des paris'),
    kpi('/admin/log', 'Pronostics', week, 'ces 7 derniers jours', bars));
}

export async function dashboardView({ refresh }) {
  const o = await aget('/overview');
  const n = o.attention.length;
  return {
    title: 'Vue d’ensemble',
    node: h('div.adm-page',
      pageHead({
        title: 'Vue d’ensemble',
        sub: `${today()} · ${n ? `${plural(n, 'point demande', 'points demandent')} ton attention` : 'rien à traiter'}`,
        actions: [
          button('Nouveau compte', { icon: 'userPlus', compact: true, onclick: () => newPlayer({ refresh }) }),
          button('Nouveau coupon', { icon: 'ticket', kind: 'primary', compact: true, onclick: async () => { if (await newCoupon()) refresh(); } }),
        ],
      }),
      kpis(o),
      h('div.adm-dash',
        h('div.adm-col',
          attentionCard(o.attention, refresh),
          card('Groupes', { flush: true, extra: more('Tous les groupes', '/admin/groups') }, table([
            ['Groupe', (g) => h('a.adm-who', { href: `/admin/groups/${g.id}` }, tile(g.emoji), h('b', g.name))],
            ['Membres', (g) => String(g.members), { align: 'right', unit: g => (g.members > 1 ? 'membres' : 'membre') }],
            ['Paris ouverts', (g) => String(g.openBets), { align: 'right', unit: (g) => (g.openBets > 1 ? 'paris ouverts' : 'pari ouvert') }],
            ['Dernière activité', (g) => ago(g.lastActivityAt)],
          ], o.activeGroups, { href: (g) => `/admin/groups/${g.id}`, emptyText: 'Aucun groupe pour l’instant : envoie un coupon.' }))),
        card('Journal', { flush: true, extra: more('Tout le journal', '/admin/log') },
          o.log.length ? h('ul.adm-log', o.log.map(logRow)) : h('p.muted.adm-empty', 'Rien encore.')))),
  };
}

export async function logView() {
  const { entries, sessions } = await aget('/log');
  const list = h('div');
  const show = ({ choice, text }) => fill(list, table([
    ['Action', (e) => h('span.adm-who', logIcon(e), logText(e))],
    ['Quand', (e) => h('span', { title: when(e.at) }, ago(e.at)), { sort: (e) => e.at, desc: true }],
    ['Adresse', (e) => h('small.muted', e.ip || '—')],
  ], entries.filter((e) => (choice === 'all' || LOG_KINDS[choice].test(e.action)) && (!text || e.summary.toLowerCase().includes(text))),
  { emptyText: 'Rien ici.', label: 'Journal' }));
  show({ choice: 'all', text: '' });
  const count = (kind) => entries.filter((e) => LOG_KINDS[kind].test(e.action)).length;
  return {
    title: 'Journal',
    node: h('div.adm-page',
      pageHead({ title: 'Journal', sub: 'Chaque action de l’admin, chaque connexion (réussie ou non) et chaque coupon utilisé. Les 200 dernières.' }),
      filters({
        choices: [['all', 'Tout', entries.length], ['access', 'Connexions', count('access')], ['players', 'Comptes', count('players')],
          ['groups', 'Groupes', count('groups')], ['coupons', 'Coupons', count('coupons')], ['site', 'Site', count('site')]],
        placeholder: 'Chercher dans le journal',
        onChange: show,
      }),
      card(null, { flush: true }, list),
      card('Sessions admin ouvertes', { flush: true },
        h('p.adm-card-note', 'Une session se ferme après 2 h sans activité, 12 h au plus. Une inconnue ? Change le mot de passe sur le serveur (npm run admin) : elles se ferment toutes.'),
        table([
          ['Navigateur', (s) => h('span.adm-ua', s.userAgent.slice(0, 90) || '—')],
          ['Connectée', (s) => when(s.createdAt)],
          ['Active', (s) => ago(s.lastSeenAt)],
          ['Adresse', (s) => s.ip || '—'],
        ], sessions, { emptyText: 'Aucune.' }))),
  };
}
