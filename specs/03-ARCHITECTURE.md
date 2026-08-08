# Architecture

## Pipeline métier

```txt
Provider
  ↓
Raw Market Data
  ↓
Normalizer + Data Quality
  ↓
Candle Store
  ↓
Timeframe Alignment
  ↓
Indicator Engine
  ↓
Regime Engine
  ↓
Strategy Engine
  ↓
Scoring Engine
  ↓
Risk Engine
  ↓
Execution Engine
  ↓
Broker Adapter
```

## Backtest

Le Backtest Engine ne réimplémente pas la stratégie.

Il fournit un environnement temporel simulé au même pipeline métier :

```txt
Historical Dataset
  ↓
Sequential Clock
  ↓
same Indicators
  ↓
same Strategy
  ↓
same Risk
  ↓
Simulation Execution Adapter
```

## Frontend

Next.js App Router.

Aucune formule de trading, de sizing ou d'indicateur ne doit être dupliquée dans le frontend.

## Engine

Service Node.js/TypeScript indépendant.

## Persistance

PostgreSQL.

Redis peut servir pour :

- queue
- distributed lock
- cache
- events
- idempotency

## Précision numérique

- prix, quantités, devises, frais, marge et P&L persistés utilisent un type décimal exact
- les arrondis de tick et de quantité sont réalisés côté domaine/exécution, jamais dans le frontend
- les nombres IEEE-754 peuvent être utilisés pour des indicateurs de recherche uniquement si aucune valeur monétaire ou quantité exécutable n'en dépend sans conversion décimale contrôlée

## Événements principaux

```txt
CANDLE_CLOSED
INDICATORS_COMPUTED
REGIME_EVALUATED
SIGNAL_EVALUATED
RISK_EVALUATED
ORDER_INTENT_CREATED
ORDER_SUBMITTED
ORDER_FILLED
POSITION_UPDATED
```

Tous portent `eventTime`, `availableAt`, `correlationId`.
