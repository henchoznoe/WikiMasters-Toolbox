# Roadmap — WikiMasters Toolbox

Backlog de fonctionnalités à construire pour faire de Toolbox le meilleur compagnon de WikiMasters. Il rassemble les besoins observés dans le jeu et dans l'écosystème des extensions, sans classement par origine des idées. Les entrées décrivent le résultat attendu ; elles ne supposent pas qu'une API existe déjà.

**Document préparé le 1er octobre 2026, à partir de l'inventaire du 30 septembre.** Toolbox affiche déjà les prix moyens et leur fraîcheur dans la collection, le marché et les paquets. La page `/pulls` possède son panneau, l'ouverture manuelle et automatique, le récapitulatif et les statistiques par compte. Les points ci-dessous concernent le travail restant, y compris l'amélioration de ces fonctions.

## Lire et prioriser ce backlog

- **P0** : socle ou irritant majeur à traiter en premier. **P1** : forte valeur après le socle. **P2** : enrichissement utile, à lancer une fois les parcours principaux solides.
- **D1** : petit ajout local, environ une demi-journée à deux jours. **D2** : quelques jours. **D3** : une à deux semaines. **D4** : plusieurs semaines ou plusieurs parcours à coordonner. **D5** : recherche importante, dépendance externe ou changement d'architecture. Ces tailles sont relatives, pas des délais promis.
- **À valider** : vérifier d'abord le comportement du jeu, les données accessibles et les règles applicables. La difficulté pourra changer après ce diagnostic.
- Pour les actions qui consomment, défaussent, vendent ou échangent des cartes : toujours montrer les cartes et quantités exactes, préserver les exclusions choisies, puis faire confirmer l'action. Favoriser les parcours officiels du jeu. Les [règles de WikiMasters](https://www.wiki-masters.com/rules) encadrent l'automatisation et l'interception du trafic ; vérifier leur compatibilité avant d'étendre les automatismes existants.
- Les prix actuellement reçus sont des moyennes pour chaque carte, déclinées par rareté. La réponse utilisée par Toolbox ne précise ni leur période de calcul ni le nombre de ventes. La durée de 24 h du cache Toolbox n'est pas une période de ventes.

## Parcours à livrer en premier

1. Fiabiliser l'identité des cartes et copies possédées, puis charger toute la collection avec progression et reprise (**DATA-01 à DATA-04**).
2. Construire la sélection avancée et la défausse par rareté, avec simulation et confirmation (**COL-01 à COL-05**).
3. Étendre le moteur de prix aux vues globales, aux échanges et aux ventes, en montrant la qualité des données (**PRICE-01 à PRICE-08**).
4. Ajouter le classement des cartes de la collection et les aides à la vente sans multiplier les requêtes inutiles (**COL-14, MARKET-01 à MARKET-05**).
5. Créer les familles de cartes et la liste de manquantes, puis les relier au marché (**FAM-01 à FAM-09**).

## 1. Données, identité et fiabilité

**DATA-01 à DATA-04 implémentés le 1er octobre 2026.** Index local des possessions, chargement paginé avec arrêt/reprise et invalidation après les actions observées. Vérification Chrome sur 240 copies et 5 pages ; erreurs serveur, changements de compte et dérive de pagination couverts par les tests. Les modifications distantes sont détectées lors des observations et des rafraîchissements, sans garantie de synchronisation instantanée.

- [x] **DATA-01 · P0 · D3 — Identité stable des cartes.** Utiliser l'ID du catalogue, la rareté et l'ID de la copie possédée selon l'action ; ne jamais déduire une identité du seul titre lorsqu'il existe des doublons ou variantes.
- [x] **DATA-02 · P0 · D3 — Index local de la collection complète.** Parcourir les pages de la collection à la demande, dédupliquer les résultats, conserver les copies distinctes et signaler clairement si l'index est partiel.
- [x] **DATA-03 · P0 · D2 — Progression et annulation des chargements longs.** Montrer pages/cartes chargées, arrêt volontaire, erreurs et état final ; reprendre sans recommencer les pages déjà valides.
- [x] **DATA-04 · P0 · D3 — Synchronisation après une action du jeu.** Actualiser l'index local après ouverture de paquet, vente, échange, défausse ou changement de compte, sans laisser de copies fantômes.
- [ ] **DATA-05 · P0 · D2 — Partition stricte par compte.** Attacher index, favoris locaux, listes, statistiques et réglages sensibles au compte détecté ; empêcher l'affichage des données d'un ancien compte.
- [ ] **DATA-06 · P1 · D2 — Cache borné et inspectable.** Définir TTL par type de donnée, limite de taille, nettoyage et bouton pour voir la date de synchronisation et vider un cache précis.
- [ ] **DATA-07 · P1 · D2 — Gestion commune des requêtes.** Centraliser concurrence, délais, `429`, erreurs temporaires, annulation et nouvelle tentative afin que les vues partagent la même politique.
- [ ] **DATA-08 · P1 · D3 — Adaptateurs de pages.** Donner à chaque route un module de lecture et un module Toolbox via le registre existant, avec remontage propre après navigation SPA et modales.
- [ ] **DATA-09 · P1 · D3 — Détection des changements du jeu.** Tester les sélecteurs et formats d'API critiques ; afficher un état dégradé compréhensible si le site change, sans actions sur une mauvaise carte.
- [ ] **DATA-10 · P2 · D3 — Sauvegarde des données locales.** Exporter/importer réglages, familles, listes et statistiques dans un format versionné, sans inclure d'identifiants de session ni mélanger les comptes.

## 2. Prix, estimation et qualité du marché

- [ ] **PRICE-01 · P0 · D2 — Prix dans la collection globale.** Afficher la moyenne de la rareté correcte dans la fiche d'une carte inspectée sur `/global-collection`, même si elle n'est pas possédée.
- [ ] **PRICE-02 · P0 · D3 — Chargement des prix par lot.** Choisir les raretés, ne charger que les prix manquants ou forcer l'actualisation, avec progression, annulation et plafond de requêtes.
- [ ] **PRICE-03 · P0 · D2 — États cohérents partout.** Employer le même `…`, `—`, `!`, âge et infobulle dans collection, paquets, marché, échanges et listes ; distinguer absence de ventes et échec réseau.
- [ ] **PRICE-04 · P0 · D3 — Signal de confiance du prix.** Si la source expose un jour volume, période ou dispersion, les montrer. Jusque-là, signaler « moyenne seule » et éviter toute promesse de prix juste.
- [ ] **PRICE-05 · P1 · D3 — Rafraîchissement ciblé.** Actualiser une carte, une sélection ou une rareté sans vider tout le cache ; respecter les limites et montrer la dernière tentative.
- [ ] **PRICE-06 · P1 · D4 — Historique local des observations.** Enregistrer les prix réellement vus au fil des jours pour tracer une évolution, avec un indicateur de trous et sans inventer d'historique antérieur.
- [ ] **PRICE-07 · P1 · D5 — Estimation robuste à partir des ventes.** Étudier les transactions accessibles, la médiane, les valeurs extrêmes et le volume par rareté ; n'afficher une estimation alternative que si l'échantillon est suffisant. **À valider :** disponibilité des ventes individuelles et fenêtre autorisée.
- [ ] **PRICE-08 · P1 · D3 — Fourchette et incertitude.** Montrer une plage indicative et un niveau de confiance quand les données le permettent, avec une explication courte de la méthode.
- [ ] **PRICE-09 · P1 · D3 — Valeur de la collection.** Totaliser uniquement les cartes dont le prix est connu, afficher le nombre et la part non évalués, puis distinguer valeur de toutes les copies et valeur des seuls doublons.
- [ ] **PRICE-10 · P1 · D3 — Fraîcheur adaptée au contexte.** Définir un âge acceptable plus court lors d'une vente ou d'un échange que pendant la consultation de l'album ; proposer une actualisation ciblée avant décision et conserver l'âge visible si elle échoue.
- [ ] **PRICE-11 · P2 · D3 — Alertes de changement de prix.** Avertir dans Toolbox lorsqu'une observation fraîche franchit un seuil choisi, sans scruter le site en continu.
- [ ] **PRICE-12 · P2 · D3 — Comparaison vente/prix moyen.** Montrer écart en W et en pourcentage sur une annonce, en indiquant la fraîcheur et l'incertitude du prix de référence.
- [ ] **PRICE-13 · P2 · D2 — Diagnostics des prix manquants.** Filtrer les cartes « aucune vente », « introuvable » ou « erreur », avec relance limitée et aide contextuelle.
- [ ] **PRICE-14 · P2 · D4 — Tableau de bord du marché.** Répartitions par rareté, cartes souvent sans prix, montants connus et évolution issue des observations locales, sans confondre prix affichés et ventes conclues.

## 3. Collection, sélection et défausse

**COL-01 à COL-05 implémentés le 1er octobre 2026.** Sélection sur l’index complet, protections réglables, conservation par variante, aperçu avec quantités avant/après, confirmation et exécution séquentielle avec arrêt et bilan. Fonds de rareté partagés avec `/pulls`. Les contrôles sont couverts par les tests ; sélection et aperçu vérifiés dans Chrome. Défausse native confirmée avec succès, bilan restauré après rechargement et index resynchronisé. Les protections sont revérifiées avant l’exécution, sans réservation atomique côté serveur.

- [x] **COL-01 · P0 · D3 — Sélection par rareté sur toute la collection.** Choisir une ou plusieurs raretés avec un total exact, y compris les pages non visibles, puis ajouter ou retirer des cartes individuelles.
- [x] **COL-02 · P0 · D4 — Défausser toutes les cartes d'une rareté.** Préparer la sélection, afficher un aperçu par rareté et nombre de copies, puis utiliser le parcours de défausse confirmé par le jeu. API native validée dans le code du jeu ; une copie identifiée par requête, sans dépendre d’une limite de lot non documentée.
- [x] **COL-03 · P0 · D3 — Protéger les cartes à conserver.** Exclure par défaut favoris, cartes étiquetées, cartes en vente/échange et exemplaire unique ; permettre d'ajuster chaque exclusion avant la confirmation.
- [x] **COL-04 · P0 · D3 — Règle « garder N copies ».** Sur une défausse ou une sélection de doublons, conserver au minimum un nombre choisi par carte et montrer les quantités avant/après.
- [x] **COL-05 · P0 · D3 — Exécution contrôlée d'une action groupée.** Afficher progression, erreurs par copie, arrêt, bilan et resynchronisation ; ne pas réessayer silencieusement une action dont le résultat est incertain. Utilise la défausse native avec contrôle des réponses, verrou entre onglets et journal par compte.
- [ ] **COL-06 · P1 · D3 — Filtres combinables.** Rareté, étiquette, favori, doublon, prix connu, fourchette de prix, catégorie, ATK/DEF et cartes sans image, appliqués à l'index complet.
- [ ] **COL-07 · P1 · D2 — Sélection enregistrable.** Sauver une requête de filtres comme vue personnelle, avec un nom et une date de synchronisation plutôt qu'une liste figée d'IDs.
- [ ] **COL-08 · P1 · D2 — Mode compact.** Afficher davantage de cartes par ligne dans collection et collection globale sans rendre titre, rareté, prix ou actions illisibles.
- [ ] **COL-09 · P1 · D3 — Vue des doublons.** Regrouper les exemplaires d'une même carte, montrer le nombre libre/en vente/en échange et les actions possibles sur chaque copie.
- [ ] **COL-10 · P1 · D2 — Tri avancé.** Trier prix, quantité, rareté, ATK, DEF, ratio ATK/DEF et date d'acquisition si elle existe ; garder la sélection lors du tri.
- [ ] **COL-11 · P1 · D3 — Étiquettes en lot.** Ajouter ou retirer une étiquette sur une sélection, avec aperçu des changements et respect des étiquettes préexistantes.
- [ ] **COL-12 · P1 · D2 — Favoris en lot.** Ajouter/retirer des favoris sans toucher les cartes déjà protégées par une autre règle.
- [ ] **COL-13 · P1 · D3 — Inventaire des cartes manquantes.** Croiser collection et catalogue global par ID, rareté et variantes pour afficher progression et manquantes réelles.
- [ ] **COL-14 · P1 · D2 — Liste « plus chères ».** Classement paginé issu de l'index local, signalement des prix absents et raccourci vers la fiche de la carte.
- [ ] **COL-15 · P2 · D2 — Statistiques de l'album.** Répartition des raretés, cartes uniques, doublons, favoris, étiquettes et progression du catalogue.
- [ ] **COL-16 · P2 · D3 — Comparer deux instantanés.** Voir cartes gagnées/perdues et changement de quantités depuis une synchronisation choisie, avec stockage borné.
- [ ] **COL-17 · P2 · D2 — Raccourcis de navigation.** Passer d'une carte possédée à sa page Wikipédia, au catalogue global, au marché et aux échanges associés quand les liens sont fiables.
- [ ] **COL-18 · P2 · D3 — Recherche enrichie.** Chercher par titre, catégorie ou description avec normalisation des accents et indication de l'étendue réellement indexée.

## 4. Marché et mises en vente

- [ ] **MARKET-01 · P0 · D3 — Aide au prix de vente.** Dans le formulaire natif, afficher moyenne, fraîcheur, annonces comparables et écart au prix saisi, sans imposer un montant automatique.
- [ ] **MARKET-02 · P0 · D3 — Identifier la copie vendable.** Résoudre l'ID de possession, vérifier qu'elle est toujours détenue et non déjà engagée, puis laisser le joueur confirmer la vente.
- [ ] **MARKET-03 · P1 · D3 — Mes ventes dans Toolbox.** Rassembler annonces actives, prix de départ, meilleure offre, temps restant et résultat connu, avec liens vers les fiches du jeu.
- [ ] **MARKET-04 · P1 · D3 — Vente depuis le classement/les doublons.** Préremplir une proposition de montant et de durée sur la copie choisie, puis passer par la confirmation native. **À valider :** flux officiel disponible.
- [ ] **MARKET-05 · P1 · D3 — Comparables actifs.** Montrer les annonces de la même carte et rareté, triées par fin et par prix, en évitant les faux matchs de titres.
- [ ] **MARKET-06 · P1 · D3 — Liste de surveillance.** Enregistrer des cartes ou recherches, vérifier à la demande les annonces correspondantes et marquer celles déjà vues.
- [ ] **MARKET-07 · P1 · D2 — Vue des bonnes affaires potentielles.** Filtrer les annonces sous un seuil de référence, avec mention explicite de la faible fiabilité possible des moyennes.
- [ ] **MARKET-08 · P2 · D3 — Budget d'achat personnel.** Suivre un budget indicatif en W et le coût total des annonces surveillées, sans enchère ou achat automatique.
- [ ] **MARKET-09 · P2 · D3 — Suivi des enchères.** Afficher heure de fin locale, évolution observée des offres et raccourci vers l'enchère ; notifier seulement selon un seuil choisi.
- [ ] **MARKET-10 · P2 · D3 — Historique des ventes personnelles.** Construire un journal des ventes effectivement observées et comparer prix final et prix moyen connu à ce moment-là.
- [ ] **MARKET-11 · P2 · D4 — Préparation de plusieurs ventes.** Mettre des copies dans une file de brouillons avec contrôles de prix et durée, puis confirmer chaque annonce selon le flux du jeu. **À valider :** limites et règles applicables.

## 5. Échanges

- [ ] **TRADE-01 · P0 · D3 — Valeurs des deux côtés.** Dans liste et détail des échanges, afficher prix par carte, W inclus, total connu et nombre de cartes sans prix.
- [ ] **TRADE-02 · P0 · D2 — Écart de valeur lisible.** Montrer différence absolue et relative avec un état « estimation partielle » si un seul prix manque.
- [ ] **TRADE-03 · P1 · D3 — Cartes complètes dans l'aperçu.** Remplacer les titres tronqués par image, rareté et titre entier, sans modifier les données de l'offre.
- [ ] **TRADE-04 · P1 · D3 — Aide à la composition.** Pendant la création, visualiser doublons disponibles, cartes protégées, valeur estimée et quantité restante après l'échange.
- [ ] **TRADE-05 · P1 · D2 — Comparaison avec les manquantes.** Marquer les cartes reçues qui complètent l'album ou une famille, et celles déjà possédées en plusieurs exemplaires.
- [ ] **TRADE-06 · P1 · D3 — Historique personnel des échanges.** Conserver un résumé local des échanges vus ou conclus, sans supposer qu'une offre affichée a été acceptée.
- [ ] **TRADE-07 · P2 · D3 — Liste de souhaits pour échanges.** Exporter une sélection de cartes recherchées et rapprocher les offres visibles de cette liste.
- [ ] **TRADE-08 · P2 · D2 — Vérification avant acceptation.** Recharger les détails de l'offre et les prix au moment de la décision, signaler les modifications et laisser l'acceptation au joueur.
- [ ] **TRADE-09 · P2 · D4 — Propositions suggérées.** À partir des doublons et souhaits, préparer des échanges possibles avec contraintes configurables, sans envoyer de proposition automatiquement.

## 6. Paquets et statistiques de tirage

- [ ] **PACK-01 · P0 · D2 — Diagnostic de l'ouverture automatique actuelle.** Vérifier son comportement, ses limites et sa compatibilité avec les règles du jeu avant toute extension de l'automatisation. **À valider.**
- [ ] **PACK-02 · P1 · D2 — Récapitulatif d'un paquet ouvert nativement.** Montrer carte, rareté, prix connu, total et état des chargements après l'ouverture par le bouton du jeu.
- [ ] **PACK-03 · P1 · D3 — Historique local des ouvertures.** Enregistrer date, mode, cartes, raretés et prix connus au moment du tirage, avec rétention limitée et export.
- [ ] **PACK-04 · P1 · D2 — Statistiques par période.** Jour, semaine, mois et total, par rareté, avec nombre de paquets et date de dernier tirage.
- [ ] **PACK-05 · P1 · D3 — Probabilités observées.** Afficher la part constatée de chaque rareté avec taille d'échantillon ; ne pas présenter ces fréquences comme les probabilités officielles du jeu.
- [ ] **PACK-06 · P1 · D2 — Valeur des tirages.** Calculer total connu par session et moyenne par paquet, en séparant cartes non évaluées et prix actualisés plus tard.
- [ ] **PACK-07 · P2 · D2 — Filtres du récapitulatif.** Rechercher et trier les cartes reçues par rareté, prix ou numéro de paquet ; copier la liste en texte.
- [ ] **PACK-08 · P2 · D3 — Export du journal.** Télécharger CSV/JSON des tirages locaux avec version du format et métadonnées de prix.
- [ ] **PACK-09 · P2 · D2 — Réglages d'accessibilité des animations.** Réduire les effets visuels et respecter `prefers-reduced-motion` sans interférer avec l'ouverture native.
- [ ] **PACK-10 · P1 · D3 — Partager l'ouverture en cours.** Copier ou télécharger une image du tirage sur `/pulls`, avec cartes, raretés et total optionnel ; choisir d'inclure le pseudo et réutiliser le rendu de CARD-04.

## 7. Familles, objectifs de collection et catalogue

- [ ] **FAM-01 · P1 · D4 — Familles personnelles.** Créer, nommer, modifier et supprimer des groupes de cartes persistés localement, indépendants des étiquettes du jeu.
- [ ] **FAM-02 · P1 · D3 — Ajouter des cartes depuis le catalogue.** Recherche paginée par titre, catégorie et description, ajout/retrait unitaire et déduplication par ID.
- [ ] **FAM-03 · P1 · D3 — Progression possédées/manquantes.** Synchroniser le nombre de copies détenues, afficher pourcentage, raretés et date de contrôle.
- [ ] **FAM-04 · P1 · D2 — Filtres de famille.** Toutes, possédées, manquantes, non vérifiées, par rareté et par prix connu.
- [ ] **FAM-05 · P1 · D2 — Carte de couverture.** Choisir une carte du groupe comme visuel, avec fallback lisible lorsqu'aucune image n'existe.
- [ ] **FAM-06 · P1 · D3 — Import/export partageable.** Code compact versionné, validation stricte et taille maximale ; les possessions du compte ne sont jamais incluses dans le partage.
- [ ] **FAM-07 · P1 · D3 — Recherche marché des manquantes.** À la demande, chercher les annonces par carte, vérifier l'ID final, trier par fin/prix et ouvrir la fiche native.
- [ ] **FAM-08 · P2 · D3 — Recherche groupée des manquantes.** Progression, pause et reprises bornées pour une famille entière, avec cache court et plafonds de requêtes.
- [ ] **FAM-09 · P2 · D3 — Objectifs de famille.** Fixer un nombre de copies ou une rareté cible par carte, puis montrer ce qui manque réellement à l'objectif.
- [ ] **FAM-10 · P2 · D3 — Familles modèles.** Bibliothèque facultative de thèmes encyclopédiques vérifiés, importable dans des familles personnelles sans remplacer leurs modifications.
- [ ] **FAM-11 · P2 · D3 — Comparer familles et échanges.** Signaler lorsqu'une offre, une annonce ou un tirage apporte une carte manquante d'une famille.
- [ ] **FAM-12 · P2 · D2 — Vue album partageable.** Exporter une image ou une liste des cartes d'une famille, avec contrôle de la visibilité des possessions et des prix.

## 8. Cartes, images et Wikipédia

- [ ] **CARD-01 · P1 · D1 — Raccourci Wikipédia.** Ouvrir l'article de la carte depuis la collection, le marché et la fiche, avec URL fournie par le jeu ou encodage sûr du titre.
- [ ] **CARD-02 · P1 · D3 — Images manquantes.** Proposer une image pertinente depuis Wikimedia Commons/Wikidata quand le jeu n'en fournit pas, avec crédit, cache et choix de laisser le visuel natif.
- [ ] **CARD-03 · P1 · D2 — Fallback des cartes sans image.** Utiliser rareté, titre et contraste pour éviter les cartes illisibles lorsque la recherche d'image échoue.
- [ ] **CARD-04 · P1 · D3 — Copier/partager une carte.** Produire un PNG fidèle à la carte affichée, avec prix et stats selon des options explicites, puis copier ou télécharger.
- [ ] **CARD-05 · P2 · D4 — Mode full-art/holographique.** Proposer un rendu facultatif respectant rareté, lisibilité et performance ; offrir une bascule immédiate vers le rendu natif.
- [ ] **CARD-06 · P2 · D2 — Masquer ATK/DEF séparément.** Options indépendantes dans collection, fiche et images partagées, notamment pour éviter les spoilers.
- [ ] **CARD-07 · P2 · D2 — Indicateur possédée dans le marché/catalogue.** Montrer le nombre d'exemplaires lorsque la collection est synchronisée, avec date et état « inconnu » si elle ne l'est pas.
- [ ] **CARD-08 · P2 · D3 — Fiche encyclopédique compacte.** Montrer catégorie, résumé, article source et attribution sans quitter le jeu, si ces données sont déjà exposées.
- [ ] **CARD-09 · P2 · D3 — Comparateur de cartes.** Deux à quatre cartes côte à côte pour rareté, ATK/DEF, prix, possession et liens Wikipédia.
- [ ] **CARD-10 · P2 · D2 — Présentation adaptée au mobile.** Contrôler zoom, longs titres, contraste et placement des badges sur les petits écrans.

## 9. Batailles, social et progression

- [ ] **GAME-01 · P1 · D3 — Préparation de duel.** Sur les cartes possédées, filtrer et comparer ATK/DEF et rareté pour aider le joueur à choisir manuellement son équipe.
- [ ] **GAME-02 · P1 · D2 — Raccourci vers les règles des combats.** Expliquer les statistiques réellement utilisées et lier les règles officielles lorsqu'elles sont disponibles. **À valider :** formule exacte du jeu.
- [ ] **GAME-03 · P2 · D3 — Journal de duels personnels.** Enregistrer uniquement les résultats visibles au joueur et montrer tendances, cartes utilisées et dates.
- [ ] **GAME-04 · P2 · D3 — Suivi de succès.** Vue des succès visibles, progression observée et raccourcis vers les actions correspondantes, sans promettre d'objectifs cachés.
- [ ] **GAME-05 · P2 · D2 — Liste de contacts utiles.** Repères locaux sur amis avec lesquels un échange ou duel a déjà eu lieu, sans aspirer les messages privés.
- [ ] **GAME-06 · P2 · D3 — Contexte de guilde.** Résumer progression et classement de la guilde avec les seules données accessibles au membre.
- [ ] **GAME-07 · P2 · D3 — Suivi des classements.** Conserver quelques positions publiques observées et leur date, puis afficher une tendance sans surveillance continue.
- [ ] **GAME-08 · P2 · D2 — Son de notification optionnel.** Jouer un signal seulement quand le compteur visible augmente, avec volume/muet et respect des préférences du navigateur.
- [ ] **GAME-09 · P2 · D3 — Centre d'alertes personnel.** Regrouper prix surveillés, enchères proches et objectifs de famille, avec lecture seule et réglages fins par type.

## 10. Réglages, accessibilité, navigateurs et maintenance

- [ ] **UX-01 · P0 · D2 — Catalogue de modules.** Activer/désactiver cartes, prix, collection, marché, échanges, familles et notifications depuis une page de réglages cohérente.
- [ ] **UX-02 · P0 · D2 — Toolbox par page utile.** Réutiliser le panneau dynamique existant sur collection, marché et échanges uniquement lorsqu'il apporte des actions ou un état pertinent.
- [ ] **UX-03 · P1 · D2 — Préférences sans rechargement inutile.** Appliquer les bascules visuelles immédiatement et recharger seulement les modules qui l'exigent.
- [ ] **UX-04 · P1 · D3 — Accessibilité clavier et lecteur d'écran.** Focus visibles, modales fermables, annonces d'état discrètes et libellés pour prix, progression et actions groupées.
- [ ] **UX-05 · P1 · D2 — États de chargement sobres.** Utiliser des repères courts comme `…`, limiter les textes permanents et conserver le détail dans l'infobulle ou un panneau d'aide.
- [ ] **UX-06 · P1 · D2 — Thème visuel cohérent.** Réutiliser couleurs, espacements, typographie et comportements du panneau `/pulls` sur tous les nouveaux outils.
- [ ] **UX-07 · P1 · D3 — Support Firefox/Chromium.** Adapter manifeste, stockage, presse-papiers et scripts de page ; vérifier les différences sans élargir inutilement les permissions.
- [ ] **UX-08 · P1 · D2 — Observabilité locale.** Ajouter un diagnostic exportable des erreurs Toolbox, sans cookie, jeton, messages privés ni données sensibles.
- [ ] **UX-09 · P1 · D3 — Tests de parcours à risque.** Couvrir ID de copie, sélection multi-pages, annulation, prix incomplet, compte changé et erreurs réseau ; réserver les tests navigateur aux parcours réellement critiques.
- [ ] **UX-10 · P2 · D3 — Raccourcis clavier configurables.** Ouvrir Toolbox, chercher une carte, changer de vue ou afficher les filtres avec des touches choisies ; éviter les conflits avec le jeu et désactiver les raccourcis pendant la saisie.
- [ ] **UX-11 · P2 · D2 — Internationalisation des textes Toolbox.** Français et anglais, formats locaux des montants, dates et durées, sans traduire le contenu des cartes.
- [ ] **UX-12 · P2 · D3 — Guide intégré.** Aide brève par page : signification des prix, limites des données, actions sur la collection et liens vers la documentation.
- [ ] **UX-13 · P2 · D2 — Page de confidentialité claire.** Lister les données stockées localement et permettre leur suppression par compte et par catégorie.
- [ ] **UX-14 · P2 · D3 — Mesure de performance locale.** Surveiller temps de rendu, taille du cache et nombre de requêtes pour garder la collection fluide même avec de grands inventaires.

## Découpage conseillé des premiers lots

1. **Fondations collection** : DATA-01 à DATA-05, puis COL-06 et COL-09.
2. **Défausse sûre** : COL-01 à COL-05 ; commencer par l'analyse du flux natif et un aperçu sans action.
3. **Prix exploitables** : PRICE-01 à PRICE-05, PRICE-09 et PRICE-10 ; afficher systématiquement les données manquantes.
4. **Décisions de marché et d'échange** : MARKET-01 à MARKET-05, TRADE-01 à TRADE-05.
5. **Album personnalisé** : FAM-01 à FAM-07, puis partage et recherche groupée.

## Références de travail

Les parcours non examinés en session connectée reposent sur les pages publiques du jeu et le code des extensions. Leurs actions natives, permissions et données disponibles restent à vérifier au moment de leur réalisation.

- [WikiMasters](https://www.wiki-masters.com/) : parcours publics du jeu ; la collection connectée a été examinée le 30 septembre 2026.
- [WikiMastersTools-kzfamily, révision `39d9c1f`](https://github.com/qkerman/WikiMastersTools-kzfamily/tree/39d9c1f) : manifeste, modules, interface et flux de données examinés le 30 septembre 2026.
- [README de WikiMasters Toolbox](README.md) : fonctions déjà présentes et limites connues.
