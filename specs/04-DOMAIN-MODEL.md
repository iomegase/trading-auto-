# Domain Model

## Candle

```ts
type Candle = {
  instrumentId: string
  timeframe: Timeframe
  openTime: Instant
  closeTime: Instant
  availableAt: Instant
  open: number
  high: number
  low: number
  close: number
  volume?: number
  isClosed: boolean
  provider: string
}
```

`closeTime` décrit la période économique.
`availableAt` décrit quand la donnée est réellement utilisable.

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

## Signal

```ts
type Signal = {
  id: string
  instrumentId: string
  context: DecisionContext
  direction: "LONG" | "SHORT" | "NONE"
  status: "CANDIDATE" | "REJECTED" | "APPROVED"
  setupScore: number | null
  reasons: SignalReason[]
}
```

## Position

```ts
type Position = {
  id: string
  instrumentId: string
  side: "LONG" | "SHORT"
  quantity: number
  averageEntryPrice: number
  protectiveStopPrice: number | null
  initialRiskAmountAccountCcy: number
  initialRiskPoints: number
  openedAt: Instant
  closedAt?: Instant
  realizedPnlAccountCcy?: number
}
```

## R Multiple

```txt
R = realizedPnL / initialRiskAmount
```

Le dénominateur est figé à l'entrée.
