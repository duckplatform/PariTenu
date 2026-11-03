// ⚽ Football : les championnats et coupes d'ESPN, une compétition = un classement (saison officielle).
import { HOUR, MINUTE } from '../lib/util.js';
import { teamSource } from './espn.js';

// fallbackMonth : début de saison si les dates d'ESPN sont inutilisables (7 : de juillet à juillet ; 1 : année civile).
export const LEAGUES = [
  { id: 'fra.1', label: 'Ligue 1', fallbackMonth: 7 },
  { id: 'fra.2', label: 'Ligue 2', fallbackMonth: 7 },
  { id: 'fra.coupe_de_france', label: 'Coupe de France', fallbackMonth: 7 },
  { id: 'fra.w.1', label: 'Première Ligue (féminine)', fallbackMonth: 7 },
  { id: 'uefa.champions', label: 'Ligue des champions', fallbackMonth: 7 },
  { id: 'uefa.europa', label: 'Ligue Europa', fallbackMonth: 7 },
  { id: 'uefa.europa.conf', label: 'Ligue Conférence', fallbackMonth: 7 },
  { id: 'uefa.wchampions', label: 'Ligue des champions féminine', fallbackMonth: 7 },
  { id: 'eng.1', label: 'Premier League', fallbackMonth: 7 },
  { id: 'eng.2', label: 'Championship (Angleterre)', fallbackMonth: 7 },
  { id: 'eng.fa', label: 'FA Cup', fallbackMonth: 7 },
  { id: 'eng.league_cup', label: 'Coupe de la Ligue anglaise', fallbackMonth: 7 },
  { id: 'esp.1', label: 'Liga', fallbackMonth: 7 },
  { id: 'esp.copa_del_rey', label: 'Coupe du Roi', fallbackMonth: 7 },
  { id: 'ita.1', label: 'Serie A', fallbackMonth: 7 },
  { id: 'ita.coppa_italia', label: 'Coupe d’Italie', fallbackMonth: 7 },
  { id: 'ger.1', label: 'Bundesliga', fallbackMonth: 7 },
  { id: 'ger.dfb_pokal', label: 'Coupe d’Allemagne', fallbackMonth: 7 },
  { id: 'por.1', label: 'Liga Portugal', fallbackMonth: 7 },
  { id: 'ned.1', label: 'Eredivisie', fallbackMonth: 7 },
  { id: 'bel.1', label: 'Pro League (Belgique)', fallbackMonth: 7 },
  { id: 'sco.1', label: 'Premiership (Écosse)', fallbackMonth: 7 },
  { id: 'tur.1', label: 'Süper Lig', fallbackMonth: 7 },
  { id: 'usa.1', label: 'MLS' },
  { id: 'mex.1', label: 'Liga MX', fallbackMonth: 7 },
  { id: 'bra.1', label: 'Brasileirão' },
  { id: 'arg.1', label: 'Liga argentine' },
  { id: 'conmebol.libertadores', label: 'Copa Libertadores' },
  { id: 'uefa.nations', label: 'Ligue des nations', fallbackMonth: 7 },
  { id: 'fifa.worldq.uefa', label: 'Qualifications Coupe du monde (Europe)' },
  { id: 'fifa.world', label: 'Coupe du monde' },
  { id: 'uefa.euro', label: 'Euro' },
  { id: 'fifa.cwc', label: 'Coupe du monde des clubs' },
].map((l) => ({ ...l, path: `soccer/${l.id}` }));

export default teamSource({
  id: 'foot',
  emoji: '⚽',
  name: 'Football',
  about: 'Le vainqueur de chaque match des 7 prochains jours des compétitions choisies ; le résultat arrive tout seul.',
  competitions: LEAGUES,
  draw: true,
  length: 2 * HOUR + 15 * MINUTE, // le score final est attendu un peu après la fin du match
  facts: 'soccer', // buts, cartons, possession, tirs…
  details: 'Résultat : score final officiel (prolongations comprises, tirs au but non compris). Match reporté ou annulé : pari annulé.',
});
