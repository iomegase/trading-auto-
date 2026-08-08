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

- compte EUR à `800` → capital effectif `800`
- compte EUR à `2 500` → capital effectif `1 000`
- compte non-EUR → conversion conservative et fraîche du plafond `1 000 EUR`
- `riskPerTradePct = 0.5` sur `1 000 EUR` → budget total maximal `5 EUR`
- coûts fixes/variables et slippage inclus dans le budget de `5 EUR`
- quantité minimale au-dessus du budget → `REJECT`, jamais arrondi à la hausse
- valeur monétaire par unité de prix
- cohérence tick value / tick size sans double application du contract multiplier
- FX conversion
- quantity step
- min quantity
- arrondi du stop au tick dans la direction définie, puis nouveau calcul de risque
- stale quote
- insufficient margin
- risk group limit
- marge/exposition obligatoire pour instrument à levier
- capital effectif ne dépasse jamais `1 000 EUR` après arrondis

## Capital de backtest

- capital initial `1 000 EUR`
- rejet de toute valeur supérieure
- aucune injection de cash
- aucun scaling a posteriori depuis un compte plus grand
- comptabilisation des signaux devenus non exécutables à cause des contraintes de petite taille

## Execution Safety

- deux signaux consécutifs sur le même instrument → une seule intention active
- position ouverte + signal de même sens/opposé → rejet baseline, aucun pyramiding/hedge
- aucune collision d'idempotency entre comptes, brokers, entrées, stops et sorties
- fill partiel qui atteint une limite → reliquat annulé
- échec d'accusé de réception du stop protecteur → incident et blocage des entrées

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
