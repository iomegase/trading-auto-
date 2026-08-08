# Signal Scoring Spec

## Définition

`setupScore` est un score descriptif interne compris entre 0 et 100.

Il ne représente pas :

- une probabilité de gain
- un niveau de confiance statistique
- un win rate
- un rendement attendu

## Ordre logique

```txt
mandatory filters
  ↓
PASS ?
  ├─ non → NO_TRADE
  └─ oui → calculate setupScore
```

Le score n'est pas le déclencheur principal de la baseline.

## Features candidates

Regrouper les features pour éviter le double comptage :

### Trend
- distance au Kumo
- Kijun slope
- projected Kumo

### Momentum
- Tenkan/Kijun
- Chikou

### Breakout
- distance au niveau cassé
- nombre de clôtures au-dessus/dessous

### Volatility
- ATR relatif
- ATR percentile causal

### Extension
- distance prix/Kijun normalisée par ATR

## ATR percentile

Le percentile à `t` doit utiliser uniquement un historique disponible à `t`.

Interdiction :

```txt
percentile calculé sur tout le dataset
```

car cela fuit de l'information future.

## Calibration

Analyser par tranche :

- trade count
- expectancy R
- profit factor
- win rate
- MAE
- MFE
- confidence interval / bootstrap si échantillon suffisant

## Threshold

Aucun seuil `75` n'est considéré comme optimal.

Un seuil ne peut être retenu qu'après validation out-of-sample et robustesse.
