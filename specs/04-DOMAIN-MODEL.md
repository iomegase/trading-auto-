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
  accountCurrency: "EUR"
  initialCapitalAccountCcy: DecimalString
  maxSizingCapitalAccountCcy: DecimalString
  realizedEquityAccountCcy: DecimalString
  unrealizedPnlAccountCcy: DecimalString
  asymmetricEquityAccountCcy: DecimalString
  sizingEquityAccountCcy: DecimalString
  riskPolicyVersion: string
}
```

Invariant :

```txt
initialCapitalAccountCcy = 1000
maxSizingCapitalAccountCcy > 0
asymmetricEquityAccountCcy = realizedEquityAccountCcy + min(0, unrealizedPnlAccountCcy)
sizingEquityAccountCcy = min(max(0, asymmetricEquityAccountCcy), maxSizingCapitalAccountCcy)
```

La baseline 2A exige `referenceCurrency = accountCurrency = "EUR"`. Le plafond
de capital n'est soumis à aucune conversion FX : les contextes de compte non EUR
sont rejetés. Cette restriction ne change pas la comptabilisation des produits :
le P&L MES en USD est converti causalement en EUR avec le snapshot FX observable
à la décision avant d'être intégré au compte EUR.

## RiskPolicyVersion

```ts
type RiskPolicyVersion = Readonly<{
  version: string
  approvalStatus: "APPROVED"
  referenceCurrency: "EUR"
  accountCurrency: "EUR"
  initialCapital: DecimalString
  maxSizingCapital: DecimalString
  riskPerTradePct: DecimalString
  maxOpenRiskPct: DecimalString
  maxOpenPositions: number
  maxContractsPerPosition: DecimalString
  maxGrossExposurePct: DecimalString
  maxMarginUsagePct: DecimalString
  cashReservePct: DecimalString
  dailyLossLimitPct: DecimalString
  maxDrawdownPct: DecimalString
  riskGroupMaxExposurePct: Readonly<Record<string, DecimalString>>
  allowCashInjection: false
  sizingEquityMode: "REALIZED_PLUS_UNREALIZED_LOSSES"
  capIncreaseMode: "MANUAL_VERSIONED"
  approvedBy: string
  approvedAt: Instant
  activatedAt: Instant
}>
```

Le type runtime et sa ligne persistée représentent uniquement une version
`APPROVED` et immuable. Les brouillons vivent hors de ce type et de la table
`risk_policy_versions`; l'approbation manuelle crée la version immuable. Un objet
runtime forgé avec un autre statut est rejeté à la frontière.

Une version possède un approbateur non vide et des instants canoniques tels que
`approvedAt <= activatedAt`. Le jalon 2A exige en outre
`initialCapital === "1000"` et `referenceCurrency = accountCurrency = "EUR"`.
`maxSizingCapital` reste strictement positif et versionné; une nouvelle version
manuellement approuvée peut le placer au-dessus ou en dessous du capital initial.

```ts
type RiskPolicyUseMode = "HISTORICAL_RESEARCH" | "FORWARD"

type RiskPolicyUseContext = Readonly<{
  riskPolicyUseMode: RiskPolicyUseMode
  riskPolicyUseAt: InstantString
  backtestId: string | null
  runCreatedAt: InstantString | null
}>
```

Toute utilisation exige
`approvedAt <= activatedAt <= riskPolicyUseAt`. En mode `FORWARD`,
`riskPolicyUseAt === decisionAt`, `backtestId === null` et
`runCreatedAt === null`. En mode
`HISTORICAL_RESEARCH`, `backtestId` est non vide,
`riskPolicyUseAt === runCreatedAt`, reste immuable pour tout le run et peut être
postérieur aux `decisionAt` historiques. La persistance vérifie en plus que le
`backtestId` référence le run dont `createdAt === riskPolicyUseAt`.

Dans `specs/23-STRATEGY-CONFIG.example.json`, `risk.policyVersion` sérialise la
valeur canonique de `RiskPolicyVersion.version`; ce n'est pas un second
identifiant de politique. La version résolue est la seule autorité. Les copies de
capital initial/plafond, devises, modes, pourcentages de risque, comptages,
exposition brute/marge et carte de risk groups sont des dénormalisations validées
pour la lisibilité : chaque valeur doit être égale à la politique résolue, sinon
la frontière rejette l'entrée. Elles n'établissent aucune priorité et ne peuvent
jamais surcharger la politique.

```ts
type M2ARiskSafetyAssertions = Readonly<{
  futuresEligibility: "RESEARCH_ONLY"
  requireExplicitGrossExposureLimit: true
  includeEstimatedExitCosts: true
  rejectIfMinQuantityExceedsRiskBudget: true
}>
```

Ces quatre champs ne sont pas des miroirs de `RiskPolicyVersion`. Ce sont des
assertions/métadonnées moteur fixes du jalon 2A, validées exactement aux constantes
ci-dessus. Une divergence produit `INVALID_CONFIG` au parsing de configuration ou
`INVALID_RISK_INPUT` à la frontière publique du Risk Engine; elle ne peut jamais
surcharger la politique. `research.researchEligibilityNote` est une métadonnée
top-level non gouvernée.

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
