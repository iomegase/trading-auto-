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

- [ ] capital de sizing calculé selon ADR-011 et borné par le `maxSizingCapital` actif : `asymmetricEquity = realizedEquity + min(0, unrealizedPnl)` ; `sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)`
- [ ] budget à `0.50%` = `5 EUR` maximum sur la baseline, coûts inclus
- [ ] valeur monétaire par unité de prix correcte
- [ ] aucune double application point value / contract multiplier
- [ ] FX conversion
- [ ] quantity step
- [ ] stale data guard
- [ ] margin guard
- [ ] portfolio/risk group limits
- [ ] clé de limite du risk group obligatoire et frontière exacte testée
- [ ] `MAX_CONTRACTS_PER_POSITION` observable pour une quantité demandée au-dessus du plafond

## Capital / Backtest

- [ ] capital initial exactement `1 000 EUR`
- [ ] aucune injection de cash
- [ ] plafond initial de capital de sizing exactement `1 000 EUR`
- [ ] les pertes latentes réduisent immédiatement le capital de sizing
- [ ] les gains latents n'augmentent jamais le capital de sizing
- [ ] toute hausse du plafond exige une nouvelle version de politique de risque approuvée manuellement
- [ ] les limites d'exposition brute et de marge des futures sont toutes deux explicites
- [ ] une quantité nulle n'est jamais arrondie à un contrat
- [ ] rejets liés aux contraintes de taille comptabilisés
- [ ] P&L et R-multiple nets de tous les coûts imputables
- [ ] la `RiskPolicyVersion` résolue est l'unique autorité; toute dénormalisation divergente est rejetée
- [ ] les quatre assertions de sécurité fixes 2A sont validées séparément des miroirs de politique
- [ ] `approvedAt <= activatedAt <= riskPolicyUseAt` et invariants propres aux modes `FORWARD`/`HISTORICAL_RESEARCH` testés
- [ ] toute décision `HISTORICAL_RESEARCH` référence un backtest et partage son `createdAt`; toute décision `FORWARD` exclut ce lien

## Execution

- [ ] idempotence
- [ ] partial fills
- [ ] UNKNOWN/reconciliation
- [ ] paper operational
- [ ] stop protecteur confirmé ou incident explicite
- [ ] `SEMI_AUTO` indisponible en V1
- [ ] AUTO interdit en V1
