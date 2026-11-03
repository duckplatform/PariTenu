import { identityFields } from '../avatars.js';
import { ApiError, get, post } from '../api.js';
import { brand, brandLogo, credits, taglineParts } from '../brand.js';
import { h } from '../dom.js';
import { navigate } from '../state.js';
import { myGroups, setGroups } from '../store.js';
import { emojiPicker, field, GROUP_EMOJIS, pinInput, toast } from '../ui.js';
import { accountRow, switchAccount } from './login.js';

// Les pages du site, hors d'un groupe (aucun lien de l'app ne mène à la création d'un groupe : seul le lien d'un coupon) :
//   /                       l'accueil : le principe, les sports, pourquoi c'est mieux (sans formulaire)
//   /groups                 mes groupes (compte de l'appareil, groupes, « Déjà un compte ? »)
//   /groups/new[/<coupon>]  créer un groupe, par le lien que l'admin du site envoie (coupon rempli)

// Les sports viennent du serveur (les sources disponibles sur cette instance) : la liste suit toute seule les ajouts.
const SHORT = { meteo: 'Pluie et températures de ta ville', crypto: 'Bitcoin, Ether… le cours de demain', manifold: 'Les questions oui/non qui font l’actu' };
const FRIENDS = { emoji: '👥', name: 'Entre amis', detail: 'Tout ce que le groupe invente' };

/** « 33 compétitions : Ligue 1, Ligue 2, Coupe de France… », « ATP, WTA », « Chaque Grand Prix ». */
function detailOf(source) {
  if (SHORT[source.id]) return SHORT[source.id];
  const names = [...new Set(source.competitions.map((c) => c.replace(/\s*\(.*?\)/g, '').trim()))];
  if (source.competitions.length > 4) return `${source.competitions.length} compétitions : ${names.slice(0, 3).join(', ')}…`;
  if (names.length === 1 && names[0] === source.name) return source.id === 'f1' ? 'Chaque Grand Prix' : names[0];
  return names.join(', ') || source.about;
}

function sportTiles(catalog) {
  const sports = catalog.filter((s) => s.category === 'sport');
  return [...sports, ...catalog.filter((s) => s.category !== 'sport')].map((s) => ({ emoji: s.emoji, name: s.name, detail: detailOf(s) })).concat(FRIENDS);
}

const FEATURES = [
  ['⚡', 'Résultats automatiques', 'Le score officiel arrive tout seul après le match : personne n’a à trancher.'],
  ['📈', 'Des cotes qui ont du sens', 'Un bon pronostic rapporte 100 × la cote. L’outsider paie, jamais de cote à 1.'],
  ['🏆', 'Un classement par compétition', 'Ligue 1, NFL, F1… chacun sur sa vraie saison, avec un champion et tout l’historique.'],
  ['🎛️', 'Tu choisis tes compétitions', 'Le groupe propose, chacun participe à ce qui l’intéresse. Pas de paris qui encombrent.'],
  ['👥', 'Plusieurs groupes, un seul prono', 'Les potes, le foot du jeudi, le bureau : un pronostic compte partout où le match est ouvert.'],
  ['⚖️', 'Et tous vos paris maison', '« Julien arrive en retard ? » : un arbitre tranche, on peut contester et voter.'],
];

/** Le compte connecté sur l'appareil (s'il y en a un) et ses groupes ; sinon les groupes gardés sur l'appareil. */
async function visitor() {
  const instance = await get('/instance').catch(() => ({ account: null }));
  // Connecté : mes groupes sont ceux de mon compte ; sinon ceux gardés sur l'appareil (leurs liens mènent à la connexion).
  if (instance.account) setGroups(await get('/account').then((r) => r.groups).catch(() => myGroups()));
  return { instance, account: instance.account, groups: myGroups() };
}

/** Le haut des pages du site : la marque (vers l'accueil), « Mes groupes » quand l'appareil en connaît, l'aide. */
const siteTop = ({ groupsLink }) => h('div.landing-top',
  h('a.brand', { href: '/' }, brandLogo(40), brand.name),
  h('div.row-wrap',
    groupsLink ? h('a.btn.small', { href: '/groups' }, 'Mes groupes') : null,
    h('a.btn.small', { href: '/help' }, 'Aide')));

const siteFoot = () => h('footer.site-foot',
  brand.footerNote ? h('p', brand.footerNote) : null,
  h('p', `${brand.name} · paris gratuits entre amis · aucune mise, aucun e-mail · `, h('a', { href: '/help' }, 'Aide et règles')),
  credits());

// Pas de connexion depuis le site (un PIN de 4 chiffres se devine vite) : seulement depuis le lien d'un groupe.
const signInCard = () => h('section.card.stack#deja-un-compte', h('h2', '🔑 Déjà un compte ?'),
  h('p', 'Ouvre le lien d’un de tes groupes : c’est là que tu te connectes, avec ton pseudo et ton PIN. Tu retrouves ensuite tous tes groupes, sur ce téléphone comme sur ton PC.'),
  h('p.muted', 'Tu n’as plus le lien ? Demande-le à un ami du groupe : il le trouve dans l’app, page « Moi », « Invite tes amis ».'));

const linkHint = () => h('p.muted.center', 'Tu as reçu un lien ? Ouvre-le directement : il te fait entrer dans le groupe.');

/** / : l'accueil du site. Le principe et les sports de cette installation. */
export async function siteHomeView() {
  const { instance, account, groups } = await visitor();
  const catalog = instance.catalog ?? [];
  const sportCount = catalog.filter((s) => s.category === 'sport').length;
  const competitionCount = catalog.reduce((n, s) => n + s.competitions.length, 0);

  const node = h('main.landing',
    h('header.landing-hero',
      siteTop({ groupsLink: !!account || groups.length > 0 }),
      brand.tagline ? h('h1', taglineParts()) : null,
      brand.intro ? h('p.lead', brand.intro) : null,
      h('div.cta-row', h('a.btn', { href: '/help' }, 'Comment ça marche ?')),
      catalog.length ? h('div.scoreboard', { 'aria-label': 'En chiffres' },
        h('div', h('b', String(sportCount)), h('small', 'sports')),
        h('div', h('b', String(competitionCount)), h('small', 'compétitions')),
        h('div', h('b', '0 €'), h('small', 'de mise'))) : null),

    account ? null : signInCard(),

    h('section.landing-section', h('h2', 'Comment ça marche'),
      h('div.steps',
        h('div.step', h('h3', 'Crée ton groupe'), h('p.muted', 'Avec ton coupon : un nom, un emoji, ton pseudo et un PIN. Trente secondes.')),
        h('div.step', h('h3', 'Invite ta bande'), h('p.muted', 'Partage le lien dans WhatsApp : chacun entre avec un pseudo et un PIN.')),
        h('div.step', h('h3', 'Pronostique et grimpe'), h('p.muted', 'Les matchs s’ouvrent tout seuls, le résultat aussi. Toi, tu as juste à avoir du flair.')))),

    catalog.length ? h('section.landing-section', h('h2', 'Tous les sports'),
      h('div.sports-grid', sportTiles(catalog).map((t) => h('div.sport-tile',
        h('span.big-emoji', { 'aria-hidden': 'true' }, t.emoji), h('b', t.name), h('small', t.detail))))) : null,

    h('section.landing-section', h('h2', 'Pourquoi c’est mieux'),
      h('div.features', FEATURES.map(([emoji, title, text]) => h('div.feature',
        h('span.big-emoji', { 'aria-hidden': 'true' }, emoji), h('div', h('h3', title), h('p.muted', text)))))),

    linkHint(),
    siteFoot());
  return { node };
}

/** /groups : mes groupes et le compte connecté sur l'appareil. */
export async function groupsView() {
  const { account, groups } = await visitor();
  const rerender = () => navigate('/groups', { replace: true });

  const node = h('main.landing',
    h('header.landing-hero.compact', siteTop({ groupsLink: false }), h('h1', 'Mes groupes')),
    h('section.landing-section.stack',
      account ? accountRow(account, {
        note: 'Connecté sur cet appareil',
        onSwitch: () => switchAccount(() => { toast('Déconnecté de cet appareil.', 'ok'); rerender(); }),
      }) : null,
      groups.length ? h('div.my-groups', groups.map((g) => h('a.group-tile', { href: `/${g.id}` },
        h('span.big-emoji', { 'aria-hidden': 'true' }, g.emoji), h('span.grow', h('b', g.name)), h('span.chev', { 'aria-hidden': 'true' }, '›'))))
        : h('p.muted', 'Tu n’es dans aucun groupe pour l’instant : ouvre le lien qu’on t’a envoyé.')),
    account ? null : signInCard(),
    linkHint(),
    siteFoot());
  return { node, title: 'Mes groupes' };
}

/** /groups/new[/<coupon>] : le formulaire de création d'un groupe. Le coupon du lien est rempli, puis quitte l'adresse. */
export async function createGroupView({ coupon = null } = {}) {
  // Le code ne reste ni dans la barre d'adresse ni dans l'historique : le formulaire le garde.
  if (coupon) history.replaceState(null, '', '/groups/new');
  const { instance, account, groups } = await visitor();
  const node = h('main.landing',
    h('header.landing-hero.compact',
      siteTop({ groupsLink: !!account || groups.length > 0 }),
      h('h1', 'Créer un groupe'),
      h('p.lead', account
        ? 'Tu deviens admin du groupe et tu obtiens un lien à partager dans WhatsApp.'
        : 'Tu deviens admin du groupe et tu obtiens un lien à partager dans WhatsApp. Pas d’e-mail : un pseudo et un PIN suffisent.')),
    h('section.card#creer', createGroupForm(instance, coupon)),
    linkHint(),
    siteFoot());
  return { node, title: 'Créer un groupe' };
}

/**
 * Connecté : un nom et un emoji suffisent. Sinon le formulaire crée aussi le compte (pseudo, avatar, PIN). Toujours avec
 * un coupon (un par groupe, à usage unique), donné par la personne qui gère l'app.
 */
function createGroupForm(instance, couponCode) {
  const { account } = instance;
  const name = h('input', { name: 'group-name', maxlength: 40, placeholder: 'Les Potes', autocomplete: 'off', required: true });
  const groupEmoji = emojiPicker(GROUP_EMOJIS, '🏆', { label: 'Emoji du groupe' });
  const me = account ? null : identityFields({ defaultAvatar: 'j:3:1:10' });
  const pin = account ? null : pinInput({ name: 'pin', 'aria-label': 'PIN' });
  const pin2 = account ? null : pinInput({ name: 'pin2', 'aria-label': 'PIN (confirmation)' });
  const code = h('input', {
    name: 'coupon', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true, maxlength: 20,
    placeholder: 'ABCD-EFGH-JKMN', value: couponCode ?? '',
  });
  const err = h('p.form-error', { role: 'alert' });
  const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Créer le groupe');

  return h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (pin && !/^\d{4}$/.test(pin.value)) { err.textContent = 'Le PIN fait 4 chiffres.'; return; }
      if (pin && pin.value !== pin2.value) { err.textContent = 'Les deux PIN ne sont pas identiques.'; return; }
      submit.disabled = true;
      try {
        const { groupId } = await post('/groups', {
          name: name.value, emoji: groupEmoji.value,
          ...(me ? { pseudo: me.pseudo, avatar: me.avatar, pin: pin.value } : {}),
          coupon: code.value,
        });
        toast('Groupe créé ! Invite tes amis avec le lien.', 'ok');
        navigate(`/${groupId}`);
      } catch (error) {
        err.textContent = error instanceof ApiError ? error.message : 'Erreur inattendue.';
      } finally {
        submit.disabled = false;
      }
    },
  },
  field('Ton coupon', code, couponCode ? 'Rempli par ton lien : il sert une seule fois.' : `Un coupon par groupe : demande-le à la personne qui gère ${brand.name} (pour rejoindre un groupe, il suffit de son lien).`),
  field('Nom du groupe', name),
  h('div.field', h('span.label', 'Emoji du groupe'), groupEmoji.el),
  account ? accountRow(account, { note: 'Tu seras admin avec ton compte' }) : [
    me.el,
    h('div.pin-row', field('Ton PIN (4 chiffres)', pin), field('Encore une fois', pin2)),
    h('small.hint', 'Ton pseudo et ton PIN forment ton compte : ils te connectent à tous tes groupes, sur ton téléphone comme sur ton PC.'),
  ],
  err,
  submit);
}
