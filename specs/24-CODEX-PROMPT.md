# Codex Implementation Prompt

Tu implémentes la V1 de recherche décrite dans ce dossier.

Lis l'intégralité des specs avant de coder.

## Priorités absolues

1. causalité temporelle
2. current Kumo correctement aligné
3. H4 clôturé uniquement
4. signal-on-close séparé du fill
5. tests avant UI
6. stratégie et backtest partagent le même code
7. aucune exécution live
8. capital de sizing asymétrique selon ADR-011, borné par le `maxSizingCapital` de la politique active : `asymmetricEquity = realizedEquity + min(0, unrealizedPnl)` ; `sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)`
9. sizing frais/slippage inclus et quantité minimale jamais forcée
10. prix, quantités et montants exécutables en décimal exact

## Première milestone

Implémente uniquement :

- domain types
- session/timeframe alignment primitives
- Ichimoku raw spans
- current Kumo = spans t-displacement
- projected Kumo
- breakout previous N excluding current candle
- H4 regime
- H1 candidate
- initial Kijun stop proposal
- unit tests
- causality tests

## Test critique

Construis un dataset où les spans calculées à `t` sont très différentes de celles de `t-26`.

Le test doit échouer si le code compare le prix au projected Kumo au lieu du current Kumo.

## Deuxième milestone

- Risk Engine avec capital de sizing asymétrique et `RiskPolicyVersion`
- contrôles quantité minimale, FX, coûts, marge et exposition
- backtest sequential clock sur `1 000 EUR` sans injection de cash
- NEXT_BAR_OPEN fills
- gap rules
- STOP_FIRST ambiguity policy
- cost model
- Risk Engine

## Interdictions

- pas de broker réel
- pas de code de stratégie dans Next.js
- pas de percentile calculé sur dataset complet
- pas de fill au close du signal sous NEXT_BAR_OPEN
- pas de resubmission aveugle après timeout
- pas de redimensionnement d'un backtest à gros capital pour simuler `1 000 EUR`
- pas de double multiplication `pointValue × contractMultiplier`
- pas d'arrondi à `minQuantity` si le budget de risque est dépassé
