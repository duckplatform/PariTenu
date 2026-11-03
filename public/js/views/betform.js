import { faceText } from '../avatars.js';
import { get, patch, post } from '../api.js';
import { fill, h } from '../dom.js';
import { fromLocalInput, now, toLocalInput } from '../format.js';
import { IDEAS, isMultiQuestion } from '../ideas.js';
import { activeMembers, ctx, loadGroup, navigate } from '../state.js';
import { empty, field, openSheet } from '../ui.js';
import { markJustCreated } from './bet.js';

const HOUR = 3_600_000;
const KIND_LABELS = { yesno: 'Oui / Non', multi: 'Choix multiples' };

/** Raccourcis de clôture, calculés à l'heure de l'appareil (recalée sur le serveur). */
function presets() {
  const t = now();
  const at = (days, hour) => {
    const d = new Date(t);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const tonight = at(0, 20) > t + 10 * 60_000 ? at(0, 20) : at(1, 20);
  const saturday = (() => {
    const d = new Date(t);
    let add = (6 - d.getDay() + 7) % 7;
    if (add === 0 && d.getHours() >= 19) add = 7;
    return at(add, 19);
  })();
  return [
    ['Dans 1 h', t + HOUR],
    [tonight === at(0, 20) ? 'Ce soir 20 h' : 'Demain 20 h', tonight],
    ['Demain midi', at(1, 12)],
    ['Samedi 19 h', saturday],
    ['Dans 1 semaine', t + 7 * 24 * HOUR],
  ];
}

export async function betFormView(route) {
  const editId = route.sub === 'edit' ? route.arg : null;
  await loadGroup(ctx.gid, { force: true }); // types et catégories à jour (un admin vient peut-être de les changer)
  const bet = editId ? (await get(`/groups/${ctx.gid}/bets/${editId}`)).bet : null;
  const cats = ctx.settings.categories.filter((c) => !c.hidden || c.id === bet?.categoryId);
  const kinds = ['yesno', 'multi'].filter((k) => ctx.settings.kinds[k] || k === bet?.kind);
  // Aucun type ou aucune catégorie activés : pas de paris maison dans ce groupe (lien direct, ou un admin vient de tout couper).
  if (!bet && (!cats.length || !kinds.length)) {
    return {
      node: h('main.form-page',
        h('header.topbar', h('a.icon-btn', { href: `/${ctx.gid}`, 'aria-label': 'Retour' }, '←'), h('h1', 'Nouveau pari')),
        empty('📡', 'Pas de paris maison dans ce groupe', 'Ici, les paris s’ouvrent tout seuls avec les compétitions activées.',
          ctx.me.role === 'admin' ? h('a.btn.primary', { href: `/${ctx.gid}/config` }, '🎛️ Activer les paris maison') : null)),
      tab: 'home',
    };
  }
  let category = bet?.categoryId ?? null;
  let kind = bet?.kind ?? kinds[0];

  const question = h('textarea', { name: 'question', rows: 2, maxlength: 140, placeholder: 'Julien arrive après 20 h 15 samedi ?', required: true });
  question.value = bet?.question ?? '';
  const counter = h('span.counter', `${question.value.length}/140`);
  question.addEventListener('input', () => { counter.textContent = `${question.value.length}/140`; });

  const catChips = h('div.chips.wrap', { role: 'radiogroup', 'aria-label': 'Catégorie' });
  const drawCats = () => catChips.replaceChildren(...cats.map((c) => h('button.chip', {
    type: 'button', role: 'radio', 'aria-checked': String(c.id === category), dataset: { cat: c.id },
    onclick: () => { category = c.id; drawCats(); },
  }, `${c.emoji} ${c.label}`)));
  drawCats();

  const optionsBox = h('div.stack.options-edit');
  let optionValues = bet?.kind === 'multi' ? bet.options.map((o) => o.label) : ['', '', ''];
  const drawOptions = () => {
    fill(optionsBox,
      optionValues.map((v, i) => h('div.option-input',
        h('input', {
          type: 'text', maxlength: 60, value: v, placeholder: `Option ${i + 1}`, 'aria-label': `Option ${i + 1}`,
          oninput: (e) => { optionValues[i] = e.target.value; },
        }),
        optionValues.length > 2 ? h('button.icon-btn', {
          type: 'button', 'aria-label': `Retirer l’option ${i + 1}`,
          onclick: () => { optionValues.splice(i, 1); drawOptions(); },
        }, '✕') : null)),
      optionValues.length < 8 ? h('button.btn.ghost.small', {
        type: 'button', onclick: () => { optionValues.push(''); drawOptions(); optionsBox.querySelector('.option-input:last-of-type input')?.focus(); },
      }, '＋ Ajouter une option') : null,
      h('small.hint', 'Pour un nombre ou une date, découpe en tranches : « moins de 3 kg », « de 3 à 3,5 kg »…'));
  };
  // Un seul type activé dans le groupe : pas de sélecteur.
  const kindSwitch = h('div.segmented', { role: 'tablist', 'aria-label': 'Type de pari', hidden: kinds.length < 2 });
  const drawKind = () => {
    kindSwitch.replaceChildren(...kinds.map((k) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(kind === k), onclick: () => { kind = k; drawKind(); },
    }, KIND_LABELS[k])));
    optionsBox.hidden = kind !== 'multi';
    if (kind === 'multi') drawOptions();
  };
  drawKind();

  const closes = h('input', { type: 'datetime-local', name: 'closes', required: true, value: bet ? toLocalInput(bet.closesAt) : '' });
  const presetChips = h('div.chips.wrap');
  fill(presetChips, presets().map(([label, ts]) => h('button.chip', { type: 'button', onclick: () => { closes.value = toLocalInput(ts); } }, label)));
  const expected = h('input', { type: 'datetime-local', name: 'expected', value: bet?.expectedAt ? toLocalInput(bet.expectedAt) : '' });

  const arbiter = h('select', { name: 'arbiter' },
    h('option', { value: ctx.me.id }, 'Moi (je ne pourrai pas parier)'),
    activeMembers().filter((m) => m.id !== ctx.me.id).map((m) => h('option', { value: m.id, selected: bet?.arbiterId === m.id },
      `${faceText(m.avatar)} ${m.pseudo} (je pourrai parier)`)));

  const details = h('textarea', { name: 'details', rows: 3, maxlength: 500, placeholder: 'Ce qui compte et comment on tranchera. Ex. : l’heure qui fait foi est celle du téléphone de Léa.' });
  details.value = bet?.details ?? '';

  const err = h('p.form-error', { role: 'alert' });
  const submit = h('button.btn.primary.wide', { type: 'submit' }, bet ? 'Enregistrer' : '🎲 Lancer le pari');


  async function openIdeas() {
    const idea = await openSheet('Idées de paris', (close) => h('div.ideas',
      cats.filter((c) => IDEAS[c.id]).map((c) => h('section',
        h('h3', `${c.emoji} ${c.label}`),
        h('div.stack', IDEAS[c.id].map((text) => h('button.idea', { type: 'button', onclick: () => close({ text, cat: c.id }) }, text)))))));
    if (!idea) return;
    question.value = idea.text;
    question.dispatchEvent(new Event('input'));
    category = idea.cat;
    drawCats();
    if (isMultiQuestion(idea.text) && kind !== 'multi' && kinds.includes('multi')) { kind = 'multi'; drawKind(); }
    question.focus();
    const blank = idea.text.indexOf('___');
    if (blank >= 0) question.setSelectionRange(blank, blank + 3);
  }

  const form = h('form.stack.bet-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (question.value.includes('___')) { err.textContent = 'Complète les blancs « ___ » de la question.'; return; }
      if (!category) { err.textContent = 'Choisis une catégorie.'; return; }
      const closesAt = fromLocalInput(closes.value);
      if (!closesAt) { err.textContent = 'Choisis l’heure de clôture des pronostics.'; return; }
      const payload = {
        question: question.value, details: details.value, category, kind,
        options: kind === 'multi' ? optionValues.map((v) => v.trim()).filter(Boolean) : undefined,
        closesAt, expectedAt: fromLocalInput(expected.value), arbiterId: arbiter.value,
      };
      submit.disabled = true;
      try {
        if (bet) {
          await patch(`/groups/${ctx.gid}/bets/${bet.id}`, payload);
          navigate(`/${ctx.gid}/bet/${bet.id}`);
        } else {
          const { id } = await post(`/groups/${ctx.gid}/bets`, payload);
          markJustCreated(id);
          navigate(`/${ctx.gid}/bet/${id}`);
        }
      } catch (error) {
        err.textContent = error.message;
        submit.disabled = false;
      }
    },
  },
  h('div.field',
    h('div.label-row', h('span.label', 'La question'), h('button.btn.ghost.small', { type: 'button', onclick: openIdeas }, '💡 Idées de paris')),
    question, counter),
  h('div.field', h('span.label', 'Catégorie'), catChips),
  h('div.field', h('span.label', 'Les réponses possibles'), kindSwitch, optionsBox),
  h('div.field', h('span.label', 'Clôture des pronostics'), presetChips, closes),
  field('Résultat attendu le (facultatif)', expected, 'Sert à relancer l’arbitre s’il oublie de trancher.'),
  field('Qui tranche ?', arbiter, 'L’arbitre ne parie pas. Choisis quelqu’un d’autre si tu veux parier toi aussi.'),
  field('Précisions (facultatif mais conseillé)', details),
  err, submit);

  const node = h('main.form-page',
    h('header.topbar',
      h('a.icon-btn', { href: bet ? `/${ctx.gid}/bet/${bet.id}` : `/${ctx.gid}`, 'aria-label': 'Retour' }, '←'),
      h('h1', bet ? 'Modifier le pari' : 'Nouveau pari')),
    form);
  return { node, tab: 'home', title: editId ? 'Modifier le pari' : 'Nouveau pari' };
}
