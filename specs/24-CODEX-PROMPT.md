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

- backtest sequential clock
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
