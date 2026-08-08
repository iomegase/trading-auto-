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
- [ ] une seule position/intention active par instrument, aucun pyramiding baseline

## Backtest

- [ ] signal on close ≠ fill rétroactif same close
- [ ] gap handling défini
- [ ] intrabar conflict policy définie
- [ ] frais/spread/slippage inclus
- [ ] Sharpe basé sur portfolio returns
- [ ] reproductibilité totale

## Risk

- [ ] capital effectif toujours `<= 1 000 EUR`
- [ ] budget à `0.50%` = `5 EUR` maximum sur la baseline, coûts inclus
- [ ] aucune quantité minimale forcée au-dessus du budget
- [ ] valeur monétaire par unité de prix correcte
- [ ] aucune double application point value / contract multiplier
- [ ] FX conversion
- [ ] quantity step
- [ ] stale data guard
- [ ] margin guard
- [ ] portfolio/risk group limits
- [ ] marge et exposition explicites pour tout produit à levier

## Capital / Backtest

- [ ] capital initial baseline `1 000 EUR`
- [ ] aucune injection de cash ou mise à l'échelle silencieuse
- [ ] rejets liés aux contraintes de taille comptabilisés
- [ ] P&L et R-multiple nets de tous les coûts imputables

## Execution

- [ ] idempotence
- [ ] partial fills
- [ ] UNKNOWN/reconciliation
- [ ] paper operational
- [ ] stop protecteur confirmé ou incident explicite
- [ ] `SEMI_AUTO` indisponible en V1
- [ ] AUTO interdit en V1
