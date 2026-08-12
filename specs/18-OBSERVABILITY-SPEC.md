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
- riskPolicyVersion
- riskPolicyUseMode
- riskPolicyUseAt
- signalId
- orderId

## Metrics

- candles_ingested_total
- candles_invalid_total
- data_gap_total
- data_staleness_seconds
- signals_total
- risk_decisions_total{status,reason}
- risk_rejections_total
- risk_rejections_no_sizing_equity_total
- risk_rejections_min_quantity_total
- risk_rejections_risk_budget_total
- risk_rejections_available_funds_total
- risk_rejections_margin_total
- risk_rejections_risk_group_exposure_total
- risk_rejections_max_contracts_per_position_total
- risk_reductions_max_contracts_per_position_total
- orders_submitted_total
- partial_fills_total
- orders_unknown_total
- broker_reconciliation_errors_total
- engine_lag_ms
- strategy_sizing_equity_account_ccy
- strategy_asymmetric_equity_account_ccy
- strategy_max_sizing_capital_account_ccy
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

Les métriques monétaires doivent porter la devise et le `riskPolicyVersion` actif. Le capital de sizing observé suit ADR-011 : equity réalisée et pertes latentes, sans gains latents, bornée par le `maxSizingCapital` versionné.

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

Les raisons de décision conservent les valeurs numériques utiles à l'audit sans exposer de secret ou d'identifiant broker sensible. La raison stable
`MAX_CONTRACTS_PER_POSITION` est comptabilisée séparément selon le statut
`REDUCE_SIZE` ou `REJECT` lorsqu'une quantité explicitement demandée dépasse le
plafond; un sizing sans quantité demandée n'émet pas cette raison.

Les métriques groupent les `RiskDecisionReason` par `status` et `reason` :
`APPROVE` n'a aucune raison, une raison de `REDUCE_SIZE` n'incrémente jamais un
compteur de rejet, et `REJECT` reste comptabilisé séparément.
