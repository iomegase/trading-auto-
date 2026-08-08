# Test Plan

## Indicators

- Tenkan exact
- Kijun exact
- Senkou A raw
- Senkou B raw
- projected cloud
- current cloud using `t - displacement`
- first valid index
- Chikou reference
- Kijun slope

## Critical Ichimoku Regression

Créer un dataset synthétique où :

```txt
senkou_raw[t] != senkou_raw[t-26]
```

Vérifier que `close[t] > currentCloudTop[t]` utilise bien les spans de `t-26`.

## Timeframe Alignment

- H1 inside unfinished H4
- H1 exactly at H4 close
- H4 available with latency
- DST
- holiday
- session break

## Breakout

- current candle excluded
- equal-to-high is not strict breakout
- long and short
- insufficient history

## Causality Test

Pour chaque décision à T :

1. calcul avec dataset tronqué à T
2. calcul avec dataset complet
3. comparer le résultat à T

Le résultat doit être identique.

Le test doit couvrir :

- indicators
- ATR percentile
- H4 alignment
- scoring
- exits

## Execution

- signal at close cannot fill same close under NEXT_BAR_OPEN
- next bar gap
- stop gap-through
- stop/target same bar
- partial fill
- duplicate submit
- disconnect after submit → UNKNOWN + reconciliation

## Risk

- point value
- FX conversion
- quantity step
- min quantity
- stale quote
- insufficient margin
- risk group limit

## Backtest Reproducibility

Dataset + config + code hash identiques :

- mêmes signals
- mêmes fills simulés
- mêmes trades
- mêmes métriques

## Gate

Paper trading interdit si les suites :

- causality
- indicator
- alignment
- execution
- risk
- reproducibility

ne sont pas vertes.
