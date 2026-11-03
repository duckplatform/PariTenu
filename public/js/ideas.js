// Modèles de paris par catégorie : « ___ » est un blanc à compléter.
export const IDEAS = {
  groupe: ['___ arrive en retard samedi ?', 'Qui paie l’addition au resto ?', 'Qui part le premier de la soirée ?',
    '___ et ___ sont encore ensemble à Noël ?', 'Le bébé de ___ naît avant le ___ ?'],
  defis: ['___ tient son défi jusqu’au ___ ?', '___ court le semi-marathon en moins de 2 h ?', '___ tient 30 jours sans sucre ?',
    '___ arrête de fumer avant l’été ?'],
  jeux: ['Qui gagne le tournoi de Mario Kart ?', 'Qui gagne la prochaine partie de belote ?', '___ gagne au Monopoly sans tricher ?'],
  sport: ['___ gagne contre ___ ?', 'Plus de 2,5 buts pendant ___ - ___ ?', '___ marque pendant le match ?', 'Qui gagne le Tour de France ?'],
  jeuxvideo: ['Qui gagne les Worlds de League of Legends ?', '___ sort avant la fin de l’année ?', '___ finit le jeu avant ___ ?'],
  tele: ['Qui gagne Koh-Lanta ?', 'Qui est éliminé cette semaine dans ___ ?', 'Qui gagne la Star Academy ?'],
  cine: ['___ dépasse 1 million d’entrées la première semaine ?', 'Qui gagne le César du meilleur film ?', '___ meurt dans la prochaine saison ?'],
  musique: ['Quel pays gagne l’Eurovision ?', 'La France finit dans le top 10 à l’Eurovision ?', 'Qui gagne la Victoire de l’album de l’année ?'],
  actu: ['___ est encore ministre au 1er janvier ?', 'Qui gagne l’élection de ___ ?'],
  eco: ['Le Bitcoin vaut plus de ___ € au 1er janvier ?', 'L’essence passe sous ___ € le litre avant l’été ?'],
  meteo: ['Il neige à ___ à Noël ?', 'Plus de 35 °C à ___ en juillet ?', 'Il pleut samedi pour le barbecue ?'],
  insolite: ['Le présentateur dit « ___ » pendant l’émission ?', 'Le discours dure plus de ___ minutes ?', '___ remet la même chemise que la semaine dernière ?'],
};

/** Une question en « Qui… ? », « Quel… ? » ou « Combien… ? » appelle des choix multiples. */
export const isMultiQuestion = (q) => /^(qui|quel|quelle|quels|quelles|combien)\b/i.test(q.trim());
