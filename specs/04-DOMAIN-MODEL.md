# Domain Model

## Candle

```ts
type Candle = {
  instrumentId: string
  timeframe: Timeframe
  sourceTimestamp: string
  sourceTimezone: string
  exchangeTimezone: string
  openTime: Instant
  closeTime: Instant
  availableAt: Instant
  ingestedAt: Instant
  open: DecimalString
  high: DecimalString
  low: DecimalString
  close: DecimalString
  volume?: DecimalString
  isClosed: boolean
  provider: string
}
```

`closeTime` décrit la période économique.
`availableAt` décrit quand la donnée est réellement utilisable.
`ingestedAt` décrit l'arrivée dans notre système et ne remplace pas `availableAt`.

## IchimokuSnapshot

```ts
type IchimokuSnapshot = {
  computedAt: Instant

  tenkan: number | null
  kijun: number | null

  // valeurs calculées à t, projetées visuellement à t + displacement
  projectedSenkouA: number | null
  projectedSenkouB: number | null

  // nuage réellement visible à t = spans calculées à t - displacement
  currentCloudA: number | null
  currentCloudB: number | null
  currentCloudTop: number | null
  currentCloudBottom: number | null

  projectedCloudTop: number | null
  projectedCloudBottom: number | null
  projectedCloudDirection:
    | "BULLISH"
    | "BEARISH"
    | "NEUTRAL"
    | "INSUFFICIENT_DATA"

  chikouReferenceIndex: number | null
  chikouReferenceClose: number | null
  chikouReferenceHigh: number | null
  chikouReferenceLow: number | null

  kijunSlope: number | null
}
```

## DecisionContext

```ts
type DecisionContext = {
  decisionAt: Instant
  signalCandleCloseTime: Instant
  trendCandleCloseTime: Instant
  datasetVersion: string
  strategyVersion: string
}
```

## StrategyCapitalContext

```ts
type StrategyCapitalContext = {
  referenceCurrency: "EUR"
  hardCapEur: DecimalString
  strategyEquityAccountCcy: DecimalString
  hardCapAccountCcy: DecimalString
  effectiveCapitalAccountCcy: DecimalString
  fxAsOf: Instant | null
}
```

Invariant :

```txt
effectiveCapitalAccountCcy =
  min(strategyEquityAccountCcy, hardCapAccountCcy)

0 < hardCapEur <= 1000.00
```

## Signal

```ts
type Signal = {
  id: string
  instrumentId: string
  context: DecisionContext
  direction: "LONG" | "SHORT" | "NONE"
  status: "CANDIDATE" | "REJECTED" | "APPROVED" | "EXPIRED"
  setupScore: number | null
  reasons: SignalReason[]
}
```

## Position

```ts
type Position = {
  id: string
  accountId: string
  instrumentId: string
  strategyVersion: string
  side: "LONG" | "SHORT"
  quantity: DecimalString
  averageEntryPrice: DecimalString
  protectiveStopPrice: DecimalString | null
  initialRiskAmountAccountCcy: DecimalString
  initialRiskPoints: DecimalString
  openedAt: Instant
  closedAt?: Instant
  realizedPnlAccountCcy?: DecimalString
}
```

## R Multiple

```txt
R = realizedPnL / initialRiskAmount
```

`realizedPnL` est net de commissions, spread, slippage, financement et autres frais imputables au trade. Le dénominateur est le risque initial budgété, lui aussi frais inclus, et reste figé après le premier fill.

## Types numériques

`DecimalString` représente une valeur décimale canonique. Les montants, prix exécutables et quantités ne doivent pas être persistés comme nombres binaires flottants.
