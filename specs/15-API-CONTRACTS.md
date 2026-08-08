# API Contracts

## GET /api/markets

Retourne l'état synthétique des marchés.

## GET /api/markets/:id

Retourne :

- candles
- Ichimoku aligné
- projected Kumo
- regime
- last signal
- risk state
- data freshness

## GET /api/signals

Filtres :

- instrument
- from/to
- direction
- score range
- status
- strategyVersion

## POST /api/backtests

Crée un job immuable.

```json
{
  "strategyKey": "ICHIMOKU_TREND_BREAKOUT_V1",
  "datasetVersion": "dataset-2026-08-08",
  "instrumentIds": ["dax"],
  "dateFrom": "2018-01-01",
  "dateTo": "2026-01-01",
  "config": {}
}
```

Réponse :

```json
{
  "backtestId": "..."
}
```

## GET /api/backtests/:id

Retourne :

- status
- reproducibility metadata
- metrics
- trades
- equity curve
- drawdown
- diagnostics

## POST /api/orders/:signalId/approve

Seulement `SEMI_AUTO`.

Avant ordre :

1. charger signal
2. vérifier expiration
3. obtenir prix frais
4. recalculer Risk Engine
5. utiliser idempotency key
6. soumettre

Une validation frontend ne vaut jamais autorisation définitive.
