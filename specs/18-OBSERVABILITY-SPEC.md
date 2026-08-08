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
- orders_submitted_total
- partial_fills_total
- orders_unknown_total
- broker_reconciliation_errors_total
- engine_lag_ms

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
