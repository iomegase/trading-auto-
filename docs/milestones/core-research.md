# Milestone 1 — Core Research

La première milestone installe un monorepo TypeScript strict et livre le noyau
pur de la stratégie Ichimoku H4/H1. Elle transforme les règles des
[spécifications](../../specs/00-README.md) en primitives testables, sans ajouter
d'exécution de marché.

## Capacités livrées

- Validation runtime de bougies immuables, décimaux canoniques, instants ISO
  normalisés en UTC et séries denses/homogènes/non chevauchantes.
- Comparaisons décimales isolées de la configuration globale de `decimal.js`.
- Sélection stricte de la dernière paire bougie/snapshot H4 clôturée, complète
  et réellement disponible à l'instant de décision.
- Calcul Ichimoku causal : Tenkan, Kijun, Senkou A/B, Kumo courant déplacé,
  Chikou de référence et pente Kijun, avec version et provenance sur chaque
  snapshot.
- Détection stricte des breakouts H1, classification du régime H4 et évaluation
  déterministe des candidats LONG/SHORT avec raisons stables.
- Proposition d'un stop initial depuis le Kijun décimal exact, arrondi au tick
  vers le haut pour LONG et vers le bas pour SHORT, puis revalidé strictement du
  bon côté du prix d'entrée.
- Orchestration publique unique `evaluateIchimokuDecision`, qui conserve les
  versions dataset, stratégie et configuration dans chaque décision évaluée.

## Invariants vérifiés

- Une bougie future ajoutée après la décision ne modifie aucun résultat calculé
  à cette décision et n'est pas convertie par l'indicateur.
- Une bougie H1 ouverte, tardive ou future, un snapshot mal apparié et une heure
  H4 future ne peuvent jamais produire une approbation.
- Toute bougie du préfixe ayant produit un snapshot H1/H4 doit être clôturée et
  disponible ; une H4 tardive est écartée avant toute conversion numérique.
- Le Kumo utilisé pour décider est le Kumo courant issu des spans calculés
  `displacement` périodes auparavant, jamais le nuage projeté brut.
- Les comparaisons de prix métier restent exactes même pour des décimaux hors de
  la plage sûre des nombres JavaScript.
- Toute conversion nécessaire au calcul numérique de l'indicateur refuse les
  dépassements et sous-dépassements de la représentation `number`.
- Les sorties de décision, leurs stops et leurs raisons sont immuables,
  ordonnées et sans doublon.

Le test d'intégration causal exécute deux fois toute la chaîne publique avec de
vraies grilles distinctes H1 et H4. La décision tombe dans la fenêtre H4 encore
ouverte, la dernière H4 clôturée est publiée trop tard, puis des prix futurs de
plus de 400 chiffres sont ajoutés aux deux séries. Le résultat doit rester
strictement identique et sélectionner la H4 antérieure disponible.

## Contrat de décision

Seule `evaluateIchimokuDecision` peut retourner `APPROVED`. Les primitives de
breakout, régime et stop restent publiques pour la recherche, mais
`evaluateH1Candidate` est interne : un consommateur ne peut donc pas injecter
un régime H4 non lié à un snapshot sélectionné causalement.

Les résultats `APPROVED` et `REJECTED` contiennent le contexte complet de
décision (`decisionAt`, clôtures H1/H4, versions dataset et stratégie), la
version de configuration Ichimoku, le régime, les raisons et le stop. Les
résultats `UNAVAILABLE` propagent précisément `NO_CLOSED_TREND_CANDLE` ou
`INSUFFICIENT_DATA`.

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

Cette milestone ne contient pas de calendrier de session, jours fériés ou DST,
resampling H1→H4, gestion du risque ou du capital, moteur de backtest, UI, base
de données, file de messages, paper trading, intégration broker, placement
d'ordre ou activation live. Ces couches devront consommer le noyau sans
affaiblir ses invariants temporels.

Références : [design](../superpowers/specs/2026-08-09-core-research-milestone-design.md),
[plan](../superpowers/plans/2026-08-09-core-research-milestone.md),
[modèle de domaine](../../specs/04-DOMAIN-MODEL.md) et
[alignement temporel](../../specs/06-TIMEFRAME-ALIGNMENT-SPEC.md).
