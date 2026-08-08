# Backtest Engine Spec

## Objectif

Simuler causalement le comportement du système.

## Clock

Le backtest avance événement par événement.

À l'instant `T`, il n'expose que les données telles que :

```txt
availableAt <= T
```

## Pipeline

À la clôture d'une bougie de signal :

1. publier la bougie clôturée
2. mettre à jour les indicateurs
3. sélectionner le dernier trend timeframe clôturé
4. évaluer régime
5. évaluer setup
6. créer `ORDER_INTENT` si éligible
7. attendre l'événement d'exécution autorisé
8. refaire le risk check avec le prix exécutable
9. simuler fill
10. gérer stops/sorties
11. enregistrer portfolio/equity

## Default Entry Model

Baseline bar-based :

```txt
SIGNAL_ON_CLOSE
+
FILL_AT_NEXT_BAR_OPEN
```

Un signal créé à la clôture de la bougie `t` ne peut pas être rempli rétroactivement au close de `t`.

Une autre convention est possible uniquement si elle est explicitement modélisée et justifiée.

## Intrabar Ambiguity

Avec OHLC, si plusieurs niveaux sont touchés dans la même bougie et que l'ordre temporel est inconnu :

- utiliser des données de timeframe inférieur, ou
- appliquer une politique déterministe conservatrice

Baseline :

```txt
intrabarConflictPolicy = STOP_FIRST
```

si stop et target/trailing event sont simultanément possibles.

## Gap Handling

Un stop traversé par un gap n'est pas rempli automatiquement au stop théorique.

## Coûts

- commission
- bid/ask spread
- slippage
- exchange/broker fees si connus
- financement overnight pour instruments concernés

Les coûts doivent être timestampés/versionnés.

## Metrics

- total return
- CAGR si période suffisante
- max drawdown
- daily Sharpe
- daily Sortino
- profit factor
- expectancy R
- trade count
- win rate
- avg/median R
- avg winner/loser
- exposure
- holding time
- MAE
- MFE
- turnover
- costs as % gross PnL

## Sharpe/Sortino

Calculer à partir d'une série de rendements portfolio à fréquence définie (baseline quotidienne), pas directement à partir des R-multiples de trades.

## Reproducibility

Un backtest doit stocker :

- datasetVersion
- strategyVersion
- codeCommit/codeHash
- configHash
- costModelVersion
- executionModelVersion
- randomSeed si applicable

## Validation

- in-sample
- untouched out-of-sample
- walk-forward
- parameter sensitivity
- stress costs/slippage
- trade sequence bootstrap / block bootstrap selon usage
