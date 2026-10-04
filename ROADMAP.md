# Feuille de route — WikiMasters Toolbox

Mise à jour : 4 octobre 2026.

WikiMasters Toolbox se concentre uniquement sur les prix des cartes. L’objectif est de donner les références les plus justes possibles avec les données accessibles gratuitement, leur âge et leurs limites. Les lectures et rafraîchissements de prix peuvent être automatisés. Les actions de jeu restent dans l’interface native ; aucun module de gestion de collection ou d’action sur le compte n’entre dans ce périmètre.

L’extension est indépendante et n’est pas approuvée par WikiMasters. Ses lectures automatiques et son observation des réponses natives ne constituent pas une garantie d’autorisation au regard des [règles du jeu](https://www.wiki-masters.com/rules).

## Fonctions présentes

- [x] Prix moyens natifs liés à l’ID du catalogue et à la rareté exacte, sans emprunter le prix d’une autre rareté.
- [x] Prix sous les cartes identifiées de la collection, du catalogue, du marché et des échanges ; chargement des cartes visibles via une file partagée.
- [x] Panneau **Prix** : périmètre de la page, filtres par rareté, plafond de requêtes, progression et arrêt.
- [x] Cache de 24 h, date de lecture visible, absence de ventes, rareté inconnue, carte introuvable et erreurs distinctes.
- [x] Fraîcheur de décision de 15 min dans le marché et les échanges ; actualisation ciblée disponible. Un échec conserve le dernier prix et son âge original.
- [x] Détail du prix et graphe local sur 90 jours : une observation par jour UTC et rareté ; les jours manquants restent des trous.
- [x] Échantillon local par compte des seules ventes explicitement conclues : variante exacte, montant final, fin d’enchère, déduplication et rétention de 30 jours.
- [x] Médiane après 5 ventes sur 3 jours UTC distincts ; fourchette indicative Q1–Q3 après 10 ventes sur 3 jours. Échantillon incomplet et méthode visibles.
- [x] Comparaison annonce / moyenne avec écart en W et en pourcentage, sans confondre mise de départ, offre et vente conclue.
- [x] Alertes locales par compte et rareté sur les seules lectures fraîches réussies ; aucune surveillance continue.
- [x] Diagnostics des prix manquants et relance manuelle limitée ; tableau de bord des références et de l’évolution observées localement.
- [x] Déduplication, espacement, budget commun de 200 lectures / heure par onglet, délais, annulation et pauses serveur ; transport Toolbox limité aux GET autorisés.
- [x] Contrôles de caches, isolation par compte des alertes et échantillons, interface française compacte et accessible.

## Améliorations de précision et de lisibilité

- [ ] **PRICE-01 · P0 — Fraîcheur au moment d’une décision.** Vérifier sur les parcours de marché et d’échange que la date de lecture, le seuil de 15 min et une actualisation échouée restent visibles ensemble.
- [ ] **PRICE-02 · P0 — Identités ambiguës.** Renforcer la correspondance entre carte affichée, catalogue et rareté ; afficher un état inconnu lorsqu’un titre ou une variante ne peut pas être résolu avec certitude.
- [ ] **PRICE-03 · P1 — Graphes plus lisibles.** Ajouter échelle en W, dates au survol et distinction visuelle entre jour non observé et absence de données de vente, avec navigation au clavier.
- [ ] **PRICE-04 · P1 — Comparaison des sources.** Présenter ensemble moyenne native et médiane des ventes conclues quand l’échantillon suffit, avec dates, taille, dispersion et limites ; ne jamais fusionner les sources en un prix certain.
- [ ] **PRICE-05 · P1 — Couverture de l’échantillon.** Rendre plus visible le nombre de ventes, les jours représentés, les valeurs extrêmes et les variantes non évaluées.
- [ ] **PRICE-06 · P1 — Prix des brillantes.** Ne proposer une estimation distincte que si des ventes conclues de la variante exacte suffisent ; la moyenne native seule ne justifie aucune surcote.
- [ ] **PRICE-07 · P2 — Export des observations de prix.** Exporter les références publiques locales et leur méthode en CSV/JSON, sans données de compte ni inventaire.
- [ ] **PRICE-08 · P2 — Accessibilité et performance.** Vérifier focus, lecteur d’écran, contraste, longs titres et fluidité des badges et graphes sur les grandes pages.
- [ ] **PRICE-09 · P2 — Départ et activité des enchères.** Dans « Mes ventes », afficher sous chaque annonce le prix de départ, le nombre d’enchères et, lorsque deux observations permettent la comparaison, la hausse en W et les enchères supplémentaires depuis la dernière visite. Idée inspirée de la [PR #39 de WikiMastersTools-kzfamily](https://github.com/qkerman/WikiMastersTools-kzfamily/pull/39). Lire d’abord les informations déjà présentes dans la page ; compléter les annonces visibles par des GET via la file et le budget partagés. Prévoir un cache par compte et annonce, un âge visible, des états inconnus explicites et une actualisation limitée lorsque la mise affichée change ou que les données vieillissent. Distinguer mise de départ, mise actuelle et vente conclue ; ces observations ne rejoignent pas l’échantillon des ventes conclues. Aucun placement d’enchère ni aucune modification d’annonce.

## Principes de données

Les 24 h décrivent la fraîcheur du cache, pas la fenêtre de calcul du jeu. Les moyennes natives ne précisent ni volume ni dispersion. Les graphes retracent les lectures locales ; aucun jour manquant n’est inventé. Les médianes et quartiles reposent uniquement sur des résultats de ventes explicitement conclus, par catalogue, rareté et variante brillante. Une fourchette indicative n’est ni une prédiction ni un intervalle de confiance. Un compte restreint ou un serveur indisponible doit produire un état explicite, sans contournement.

Le [README](README.md) décrit l’installation et la contribution, [PRIVACY.md](PRIVACY.md) décrit les données conservées, et [AGENTS.md](AGENTS.md) définit les consignes du dépôt. Les futures PR ciblent `develop`, avec tests de régression, paquet Chrome et vérification des prix dans Chrome lorsque le compte le permet.
