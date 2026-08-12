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

Il doit aussi exposer :

- capital de sizing utilisé, calculé selon ADR-011 et borné par le `maxSizingCapital` de la `RiskPolicyVersion` active
- budget de risque brut et net de coûts
- quantité demandée et quantité approuvée
- perte budgétée au stop, frais et slippage inclus
- marge et exposition après ordre

Une quantité minimale non compatible avec le budget est rejetée, jamais arrondie à la hausse.

## F-009 — Backtest

Le moteur doit être causal, séquentiel et reproductible.

La baseline démarre avec `initialCapital = 1 000 EUR` et interdit toute injection de cash. Le capital de sizing est l'equity réalisée diminuée immédiatement des pertes latentes, sans inclure les gains latents, puis bornée par le `maxSizingCapital` de la `RiskPolicyVersion` active. Le plafond initial vaut `1 000 EUR`; toute augmentation est manuelle, auditée et versionnée.

## F-010 — Paper Execution

Le paper engine doit simuler les mêmes transitions d'ordre que l'exécution réelle, sans prétendre reproduire parfaitement les fills live.

## F-011 — Audit

Chaque décision doit être persistée avec :

- timestamp de décision
- données connues à cet instant
- version de stratégie
- version de dataset
- raisons
