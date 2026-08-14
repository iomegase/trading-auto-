# Implementation Roadmap

## Phase 0

- monorepo
- TS strict
- test runner
- CI
- config validation
- `RiskPolicyVersion` versionnée avec `initialMaxSizingCapital = 1 000 EUR`
- types décimaux pour prix/quantités/montants

## Phase 1 — Domain + Calendars

- types
- instrument metadata
- session calendars
- timestamps/availableAt

## Phase 2 — Market Data

- ingestion
- normalization
- quality
- dataset versioning

## Phase 3 — Ichimoku

- raw spans
- current Kumo alignment
- projected Kumo
- tests anti-look-ahead

## Phase 4 — Multi-timeframe

- H1/H4 alignment
- session-aware aggregation

## Phase 5 — Strategy

- regime
- breakout
- confirmations
- score
- stop/exit baseline

## Phase 6 — Risk

- capital de sizing asymétrique selon ADR-011, borné par le `maxSizingCapital` de la politique active : `asymmetricEquity = realizedEquity + min(0, unrealizedPnl)` ; `sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)`
- sizing frais inclus
- FX
- quantité minimale/pas de quantité
- marge et exposition
- tests de faisabilité par instrument

## Phase 7A — Exécution futures sur barres (Milestone 2B — implémentée)

- simulateur pur `BAR_BASED_H1_V1`
- signal on close, exécution au prochain open H1 négociable
- schedules versionnés, pauses de maintenance et fenêtres de contrats datés
- gaps, stops fixes et politique intrabar `STOP_FIRST`
- revalidation complète du risque avant fill
- coûts, slippage, settlements et variation margin
- roll explicite avec sortie, nouveau stop et réentrée conditionnelle
- tests d'acceptation synthétiques FDXS/MES et causalité par ajout de futur

## Phase 7B — Backtest séquentiel (Milestone 2C — planifiée)

- sequential portfolio clock
- orchestration strategy/risk/execution
- run lifecycle and invalid-data propagation
- metrics
- comptabilité initialisée à `1 000 EUR` sans injection de cash ni augmentation automatique du plafond

## Phase 8 — Persistence + API

- DB
- jobs
- audit
- contracts

## Phase 9 — Dashboard

- scanner
- chart
- explainability
- Strategy Lab

## Phase 10 — Paper Engine

- order state machine
- reconciliation
- monitoring

## Phase 11 — Broker Adapter

- account
- quotes
- orders
- fills
- pacing

## Phase 12 — Validation

- OOS
- walk-forward
- sensitivity
- cost stress
- forward paper

## Phase 13 — Live

Hors V1 et uniquement après décision explicite. `SEMI_AUTO` et `AUTO` restent indisponibles dans la livraison V1.
