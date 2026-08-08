# Execution & Broker Spec

## Broker Adapter

```ts
interface BrokerAdapter {
  getAccount(): Promise<AccountSnapshot>
  getPositions(): Promise<BrokerPosition[]>
  getOpenOrders(): Promise<BrokerOrder[]>
  getQuote(instrumentId: string): Promise<Quote>
  placeOrder(order: OrderRequest): Promise<OrderResult>
  cancelOrder(orderId: string): Promise<void>
  closePosition(positionId: string): Promise<OrderResult>
}
```

## Execution Responsibilities

- fresh quote validation
- signal TTL
- server-side risk recheck
- tick rounding
- quantity step
- idempotency
- order state reconciliation
- partial fills
- retry uniquement lorsque sûr
- broker pacing/rate limit
- audit

## State Machine

```txt
CREATED
RISK_APPROVED
SUBMITTING
SUBMITTED
ACKNOWLEDGED
PARTIALLY_FILLED
FILLED
CANCEL_REQUESTED
CANCELLED
REJECTED
FAILED
UNKNOWN
```

`UNKNOWN` est nécessaire après timeout/disconnexion : ne jamais resoumettre aveuglément sans réconciliation.

## Idempotency Key

```txt
strategyVersion
+ instrumentId
+ signalTimeframe
+ signalCandleCloseTime
+ direction
```

## Partial Fills

Conserver une table/collection de fills.

La position moyenne doit être dérivée des fills réels.

## Paper Trading

Le paper broker est utile pour vérifier :

- connectivité
- state machine
- orchestration
- logique
- ergonomie

Il ne doit pas être considéré comme une reproduction fidèle de la liquidité ou des fills live.

## Broker-Specific Constraints

Les limitations, pacing, market-data subscriptions et comportements paper/live sont encapsulés dans l'adapter, pas dans la stratégie.

## Modes

- DISABLED
- PAPER
- SEMI_AUTO
- AUTO

AUTO interdit en V1.
