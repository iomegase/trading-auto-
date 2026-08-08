# Observability Spec

## Structured Logs

Inclure lorsque disponible :

- timestamp
- eventTime
- availableAt
- service
- correlationId
- instrumentId
- timeframe
- strategyVersion
- datasetVersion
- signalId
- orderId

## Metrics

- candles_ingested_total
- candles_invalid_total
- data_gap_total
- data_staleness_seconds
- signals_total
- risk_rejections_total
- risk_rejections_capital_cap_total
- risk_rejections_min_quantity_total
- risk_rejections_costs_total
- risk_rejections_margin_total
- orders_submitted_total
- partial_fills_total
- orders_unknown_total
- broker_reconciliation_errors_total
- engine_lag_ms
- strategy_effective_capital_account_ccy
- strategy_open_risk_account_ccy
- strategy_margin_used_account_ccy

## Health

- DB
- provider
- broker
- engine heartbeat
- queue
- data freshness
- clock skew

## Audit

Journaliser :

- signal
- risk decision
- order transition
- kill switch
- mode change
- config/version change

Les métriques monétaires doivent porter la devise. Les raisons de rejet conservent les valeurs numériques utiles à l'audit sans exposer de secret ou d'identifiant broker sensible.
