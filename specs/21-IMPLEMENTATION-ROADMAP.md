# Implementation Roadmap

## Phase 0

- monorepo
- TS strict
- test runner
- CI
- config validation

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

## Phase 6 — Backtest

- sequential clock
- next-bar execution
- gaps
- intrabar policy
- costs
- metrics

## Phase 7 — Risk

- sizing
- FX
- margin
- exposure

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

Hors V1 et uniquement après décision explicite.
