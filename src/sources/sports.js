// Les autres sports collectifs d'ESPN : football américain, rugby, basket, hockey, baseball, football australien.
// Une compétition = un classement, sur sa saison officielle (dates d'ESPN, sinon fallbackMonth : 1er mois de la saison).
import { HOUR, MINUTE } from '../lib/util.js';
import { teamSource } from './espn.js';

const VOID_RULE = 'Match reporté ou annulé : pari annulé.';

export const usfoot = teamSource({
  id: 'usfoot',
  emoji: '🏈',
  name: 'Football américain',
  about: 'Le vainqueur de chaque match des 7 prochains jours ; le résultat arrive tout seul.',
  competitions: [
    { id: 'nfl', label: 'NFL', path: 'football/nfl', fallbackMonth: 3 },
    { id: 'college-football', label: 'NCAA (universitaire)', path: 'football/college-football', fallbackMonth: 2 },
  ],
  draw: false,
  length: 4 * HOUR,
  clock: 'quarter',
  facts: 'nfl',
  details: `Résultat : score final officiel, prolongation comprise (match nul : pari annulé). ${VOID_RULE}`,
});

export const rugby = teamSource({
  id: 'rugby',
  emoji: '🏉',
  name: 'Rugby',
  about: 'Le vainqueur de chaque match des 7 prochains jours des compétitions choisies ; le résultat arrive tout seul.',
  competitions: [
    { id: '270559', label: 'Top 14', path: 'rugby/270559', fallbackMonth: 8 },
    { id: '271937', label: 'Champions Cup', path: 'rugby/271937', fallbackMonth: 8 },
    { id: '272073', label: 'Challenge Cup', path: 'rugby/272073', fallbackMonth: 8 },
    { id: '180659', label: 'Tournoi des Six Nations', path: 'rugby/180659' },
    { id: '289234', label: 'Tests internationaux', path: 'rugby/289234' },
    { id: '164205', label: 'Coupe du monde', path: 'rugby/164205' },
    { id: '267979', label: 'Premiership (Angleterre)', path: 'rugby/267979', fallbackMonth: 8 },
    { id: '270557', label: 'United Rugby Championship', path: 'rugby/270557', fallbackMonth: 8 },
    { id: '244293', label: 'Rugby Championship', path: 'rugby/244293' },
    { id: 'nrl', label: 'NRL (rugby à XIII)', path: 'rugby-league/3' },
  ],
  draw: true,
  length: 2 * HOUR + 15 * MINUTE,
  facts: 'rugby',
  details: `Résultat : score final officiel (temps réglementaire). ${VOID_RULE}`,
});

export const basket = teamSource({
  id: 'basket',
  emoji: '🏀',
  name: 'Basket',
  about: 'Le vainqueur de chaque match des 7 prochains jours ; le résultat arrive tout seul.',
  competitions: [
    { id: 'nba', label: 'NBA', path: 'basketball/nba', fallbackMonth: 8 },
    { id: 'wnba', label: 'WNBA', path: 'basketball/wnba' },
    { id: 'mens-college-basketball', label: 'NCAA hommes', path: 'basketball/mens-college-basketball', fallbackMonth: 8 },
    { id: 'womens-college-basketball', label: 'NCAA femmes', path: 'basketball/womens-college-basketball', fallbackMonth: 8 },
  ],
  draw: false,
  length: 3 * HOUR,
  clock: 'quarter',
  facts: 'basket',
  details: `Résultat : score final officiel, prolongations comprises. ${VOID_RULE}`,
});

export const hockey = teamSource({
  id: 'hockey',
  emoji: '🏒',
  name: 'Hockey sur glace',
  about: 'Le vainqueur de chaque match des 7 prochains jours ; le résultat arrive tout seul.',
  competitions: [
    { id: 'nhl', label: 'NHL', path: 'hockey/nhl', fallbackMonth: 8 },
    { id: 'mens-college-hockey', label: 'NCAA (universitaire)', path: 'hockey/mens-college-hockey', fallbackMonth: 8 },
  ],
  draw: false,
  length: 3 * HOUR + 30 * MINUTE,
  clock: 'period',
  facts: 'hockey',
  details: `Résultat : score final officiel, prolongation et tirs au but compris. ${VOID_RULE}`,
});

export const baseball = teamSource({
  id: 'baseball',
  emoji: '⚾',
  name: 'Baseball',
  about: 'Le vainqueur de chaque match des 7 prochains jours ; le résultat arrive tout seul.',
  competitions: [{ id: 'mlb', label: 'MLB', path: 'baseball/mlb' }],
  draw: false,
  length: 4 * HOUR,
  clock: 'inning',
  facts: 'baseball',
  details: `Résultat : score final officiel, manches supplémentaires comprises. ${VOID_RULE}`,
});

export const afl = teamSource({
  id: 'afl',
  emoji: '🦘',
  name: 'Football australien',
  about: 'Le vainqueur de chaque match des 7 prochains jours ; le résultat arrive tout seul.',
  competitions: [{ id: 'afl', label: 'AFL', path: 'australian-football/afl' }],
  draw: true,
  length: 3 * HOUR,
  clock: 'quarter',
  facts: 'afl',
  details: `Résultat : score final officiel. ${VOID_RULE}`,
});
