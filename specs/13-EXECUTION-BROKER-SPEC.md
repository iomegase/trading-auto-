# Execution & Broker Spec

## Broker Adapter

```ts
interface BrokerAdapter {
  getAccount(accountId: string): Promise<AccountSnapshot>
  getPositions(accountId: string): Promise<BrokerPosition[]>
  getOpenOrders(accountId: string): Promise<BrokerOrder[]>
  getQuote(accountId: string, instrumentId: string): Promise<Quote>
  placeOrder(order: OrderRequest): Promise<OrderResult>
  cancelOrder(request: CancelOrderRequest): Promise<void>
  closePosition(request: ClosePositionRequest): Promise<OrderResult>
}
```

`CancelOrderRequest` et `ClosePositionRequest` transportent les identifiants broker/client requis. Un `positionId` interne seul ne doit jamais être envoyé au broker comme s'il s'agissait d'un identifiant externe.

## Execution Responsibilities

- fresh quote validation
- signal TTL
- server-side risk recheck
- tick rounding
- quantity step
- capital de sizing calculé selon ADR-011 : `asymmetricEquity = realizedEquity + min(0, unrealizedPnl)` ; `sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)`
- marge et exposition après ordre
- perte au stop estimée frais inclus
- idempotency
- order state reconciliation
- partial fills
- retry uniquement lorsque sûr
- broker pacing/rate limit
- audit

Le prix du stop soumis doit être exactement celui utilisé par le dernier calcul de risque. Si l'adapter broker modifie l'arrondi ou refuse le tick, l'ordre d'entrée est rejeté ou la protection est recalculée avant toute nouvelle exposition.

## State Machine

```txt
CREATED
RISK_APPROVED
EXPIRED
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

La clé est dérivée d'un `orderIntentId` immuable et inclut le compte, le broker et le type d'intention (`ENTRY`, `PROTECTIVE_STOP`, `EXIT`). Toutes les tentatives de soumission du même intent réutilisent strictement la même clé.

Une clé fondée uniquement sur instrument/timeframe/direction est insuffisante : elle peut entrer en collision entre comptes, brokers ou ordres d'entrée et de sortie.

## Partial Fills

Conserver une table/collection de fills.

La position moyenne doit être dérivée des fills réels.

Le risque et la marge sont recalculés sur la quantité cumulée. Le reliquat non rempli est annulé si son exécution ferait dépasser une limite.

## Protective Stop

Après un fill d'entrée, le stop protecteur doit être soumis dans le même mécanisme bracket/OCO lorsque le broker le permet. Sinon, son accusé de réception doit être confirmé immédiatement. L'échec de protection place le système en incident, bloque toute nouvelle entrée et applique une politique explicite de réduction/fermeture ; aucune position non protégée ne doit rester silencieusement ouverte.

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

`SEMI_AUTO` est également désactivé dans la livraison V1 de recherche. Seuls `DISABLED` et `PAPER` peuvent soumettre des ordres dans cette version.
