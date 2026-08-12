# API Contracts

## GET /api/markets

Retourne l'état synthétique des marchés.

## GET /api/markets/:id

Retourne :

- candles
- Ichimoku aligné
- projected Kumo
- regime
- last signal
- risk state
- data freshness

## GET /api/signals

Filtres :

- instrument
- from/to
- direction
- score range
- status
- strategyVersion

## POST /api/backtests

Crée un job immuable.

```json
{
  "strategyKey": "ICHIMOKU_TREND_BREAKOUT_V1",
  "riskPolicyVersion": "RISK_FUTURES_V1_RESEARCH",
  "riskPolicyUseMode": "HISTORICAL_RESEARCH",
  "datasetVersion": "dataset-2026-08-08",
  "instrumentIds": ["dax"],
  "dateFrom": "2018-01-01",
  "dateTo": "2026-01-01",
  "capital": {
    "referenceCurrency": "EUR",
    "accountCurrency": "EUR",
    "initialCapital": "1000",
    "initialMaxSizingCapital": "1000",
    "allowCashInjection": false,
    "sizingEquityMode": "REALIZED_PLUS_UNREALIZED_LOSSES",
    "capIncreaseMode": "MANUAL_VERSIONED"
  },
  "config": {}
}
```

Le contrat applique ADR-011 :

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

L'API et la factory de politique rejettent toute baseline différente du décimal
canonique `initialCapital = 1000`, notamment `900`, `1000.01` ou une valeur mal
formée, toute injection de capital au cours du run, ou une demande d'augmentation
du `maxSizingCapital` sans nouvelle `RiskPolicyVersion` manuellement approuvée.
Une nouvelle version peut définir un plafond positif inférieur ou supérieur au
capital initial. L'API rejette aussi tout compte non EUR en 2A :
`referenceCurrency` et `accountCurrency` doivent toutes deux valoir `EUR`, sans
conversion FX du plafond de capital. La conversion causale du P&L MES USD vers le
compte EUR reste obligatoire.

La `RiskPolicyVersion` résolue par `riskPolicyVersion` est l'unique autorité. Le
bloc `capital` et toute limite de risque répétée dans `config` sont des
dénormalisations validées pour la lisibilité et la compatibilité du contrat : le
parseur rejette toute valeur différente de la politique résolue. Aucun champ
répété ne possède de priorité et aucun ne peut surcharger la politique.

`futuresEligibility`, `requireExplicitGrossExposureLimit`,
`includeEstimatedExitCosts` et `rejectIfMinQuantityExceedsRiskBudget` ne sont pas
des miroirs de politique. Ce sont des assertions fixes 2A, respectivement
`RESEARCH_ONLY`, `true`, `true` et `true`; une divergence produit
`INVALID_CONFIG`. La note FDXS/MES reste une métadonnée non gouvernée sous
`research.researchEligibilityNote`.

Le service enregistre un `runCreatedAt` canonique. Pour cette requête historique,
il fixe `riskPolicyUseMode = HISTORICAL_RESEARCH` et
`riskPolicyUseAt = runCreatedAt`, immuables pendant le run. Il exige
`approvedAt <= activatedAt <= riskPolicyUseAt`; les `decisionAt` de marché entre
2018 et 2026 peuvent donc précéder cet instant de contrôle sans prétendre que la
politique existait historiquement. En mode `FORWARD`, le contrat exige
`riskPolicyUseAt = decisionAt`; une politique n'est jamais appliquée avant son
activation. Chaque décision historique persiste le `backtestId` de ce run et
exige `riskPolicyUseAt = runCreatedAt`; une décision `FORWARD` n'a aucun lien de
backtest historique.

Réponse :

```json
{
  "backtestId": "...",
  "riskPolicyUseMode": "HISTORICAL_RESEARCH",
  "riskPolicyUseAt": "2026-08-10T12:00:00Z",
  "runCreatedAt": "2026-08-10T12:00:00Z"
}
```

## GET /api/backtests/:id

Retourne :

- status
- reproducibility metadata
- metrics
- trades
- equity curve
- drawdown
- diagnostics

## POST /api/orders/:signalId/approve

Seulement `SEMI_AUTO`.

Dans la V1 de recherche, cet endpoint répond `409 LIVE_MODE_DISABLED` car `SEMI_AUTO` n'est pas activable.

Avant ordre :

1. charger signal
2. vérifier expiration
3. obtenir prix frais
4. recalculer Risk Engine
5. vérifier capital de sizing, coûts, marge et exposition
6. utiliser idempotency key
7. soumettre

Une validation frontend ne vaut jamais autorisation définitive.
