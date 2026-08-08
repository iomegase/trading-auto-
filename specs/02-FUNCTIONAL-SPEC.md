# Functional Spec

## F-001 — Market Data

Le système doit ingérer, normaliser, valider et versionner les bougies.

## F-002 — Timeframe Alignment

À chaque décision H1, le moteur doit sélectionner le dernier H4 **entièrement clôturé et disponible** au timestamp de décision.

## F-003 — Ichimoku

Le moteur doit produire séparément :

- Tenkan
- Kijun
- Senkou A calculée maintenant
- Senkou B calculée maintenant
- Kumo visible maintenant
- Kumo projeté
- référence Chikou
- Kijun slope

## F-004 — Market Regime

Résultat :

- `BULLISH`
- `BEARISH`
- `NEUTRAL`
- `INSUFFICIENT_DATA`

## F-005 — Strategy

Résultat :

- `LONG_CANDIDATE`
- `SHORT_CANDIDATE`
- `NO_TRADE`

avec raisons structurées.

## F-006 — Setup Score

Le score qualifie le setup après validation des filtres obligatoires.

Il ne doit jamais être exposé comme probabilité.

## F-007 — Stop & Exit

Chaque version de stratégie doit définir :

- stop initial
- règle de sortie
- éventuel trailing
- règle de gap
- politique intrabar

## F-008 — Risk

Le Risk Engine retourne :

- `APPROVE`
- `REJECT`
- `REDUCE_SIZE`

avec motif.

## F-009 — Backtest

Le moteur doit être causal, séquentiel et reproductible.

## F-010 — Paper Execution

Le paper engine doit simuler les mêmes transitions d'ordre que l'exécution réelle, sans prétendre reproduire parfaitement les fills live.

## F-011 — Audit

Chaque décision doit être persistée avec :

- timestamp de décision
- données connues à cet instant
- version de stratégie
- version de dataset
- raisons
