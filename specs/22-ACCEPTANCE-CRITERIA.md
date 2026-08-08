# Acceptance Criteria

## Data

- [ ] timestamps source et UTC conservés
- [ ] `availableAt` présent
- [ ] session calendar utilisé pour gaps
- [ ] dataset versionné

## Ichimoku

- [ ] current Kumo utilise spans `t-26`
- [ ] projected Kumo utilise spans calculées à `t`
- [ ] Chikou causal
- [ ] first valid indexes testés
- [ ] aucune fuite de futur

## Multi-timeframe

- [ ] H1 ne lit jamais H4 non clôturé
- [ ] DST/session tests verts

## Strategy

- [ ] breakout exclut candle courante
- [ ] stop policy définie
- [ ] exit policy définie
- [ ] score non présenté comme probabilité
- [ ] signal TTL défini

## Backtest

- [ ] signal on close ≠ fill rétroactif same close
- [ ] gap handling défini
- [ ] intrabar conflict policy définie
- [ ] frais/spread/slippage inclus
- [ ] Sharpe basé sur portfolio returns
- [ ] reproductibilité totale

## Risk

- [ ] point value correct
- [ ] FX conversion
- [ ] quantity step
- [ ] stale data guard
- [ ] margin guard
- [ ] portfolio/risk group limits

## Execution

- [ ] idempotence
- [ ] partial fills
- [ ] UNKNOWN/reconciliation
- [ ] paper operational
- [ ] AUTO interdit en V1
