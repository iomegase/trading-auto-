# Milestone 1 — Core Research

La première milestone installe un monorepo TypeScript strict et livre le noyau
pur de la stratégie Ichimoku H4/H1. Elle transforme les règles des
[spécifications](../../specs/00-README.md) en primitives testables, sans ajouter
d'exécution de marché.

## Capacités livrées

- Validation runtime de bougies immuables, décimaux canoniques et instants ISO.
- Comparaisons décimales isolées de la configuration globale de `decimal.js`.
- Sélection de la dernière bougie clôturée réellement disponible à l'instant de
  décision.
- Calcul Ichimoku causal : Tenkan, Kijun, Senkou A/B, Kumo courant déplacé,
  Chikou de référence et pente Kijun.
- Détection stricte des breakouts H1, classification du régime H4 et évaluation
  déterministe des candidats LONG/SHORT avec raisons stables.
- Proposition d'un stop initial Kijun uniquement lorsqu'il est positif et placé
  du bon côté du prix d'entrée.

## Invariants vérifiés

- Une bougie future ajoutée après la décision ne modifie aucun résultat calculé
  à cette décision.
- Le Kumo utilisé pour décider est le Kumo courant issu des spans calculés
  `displacement` périodes auparavant, jamais le nuage projeté brut.
- Les comparaisons de prix métier restent exactes même pour des décimaux hors de
  la plage sûre des nombres JavaScript.
- Toute conversion nécessaire au calcul numérique de l'indicateur refuse les
  dépassements et sous-dépassements de la représentation `number`.
- Les sorties de candidature et leurs raisons sont immuables, ordonnées et sans
  doublon.

Le test d'intégration causal exécute deux fois toute la chaîne — sélection
temporelle, Ichimoku, breakout, régime, candidature et stop — avec puis sans les
données futures, et exige une égalité profonde.

## Vérification locale

```bash
corepack enable
pnpm install
pnpm check
pnpm test:coverage
```

La configuration utilise TypeScript 7 (`@typescript/native`) pour compiler. Un
alias TypeScript 6 est conservé pour l'API de `typescript-eslint`, qui ne prend
pas encore en charge l'API native de TypeScript 7.

## Hors périmètre

Cette milestone ne contient pas de gestion du risque ou du capital, moteur de
backtest, UI, base de données, file de messages, paper trading, intégration
broker, placement d'ordre ou activation live. Ces couches devront consommer le
noyau sans affaiblir ses invariants temporels.

Références : [design](../superpowers/specs/2026-08-09-core-research-milestone-design.md),
[plan](../superpowers/plans/2026-08-09-core-research-milestone.md),
[modèle de domaine](../../specs/04-DOMAIN-MODEL.md) et
[alignement temporel](../../specs/06-TIMEFRAME-ALIGNMENT-SPEC.md).
