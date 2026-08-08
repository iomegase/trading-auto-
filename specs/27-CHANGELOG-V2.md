# Changelog V2

Ce fichier reste l'historique de la V2. Les corrections issues de l'audit capital/risque sont décrites dans `30-AUDIT-CORRECTIONS-V3.md`.

## Corrections critiques

### 1 — Kumo

Ancienne spec :
comparaison possible du prix avec les Senkou calculées au même instant.

Correction :
le Kumo visible à `t` utilise les Senkou calculées à `t-26`.

### 2 — Multi-timeframe

Ajout :
le H4 doit être entièrement clôturé et disponible au moment du signal H1.

### 3 — Exécution backtest

Ajout :
un signal connu au close de `t` n'est pas rempli rétroactivement à ce close.

Baseline :
`NEXT_BAR_OPEN`.

### 4 — Intrabar

Ajout d'une politique explicite en cas d'ambiguïté OHLC.

Baseline :
`STOP_FIRST`.

### 5 — Stop / Exit

Ajout d'une spec complète.
Baseline :
stop Kijun fixe + sortie de tendance sur clôture contre Kijun.

### 6 — Risk

Ajout :

- FX
- quantity step
- min quantity
- margin
- stale quotes
- risk groups

### 7 — Reproductibilité

Ajout :

- datasetVersion
- configHash
- codeHash
- executionModelVersion
- costModelVersion

### 8 — Futures / adjusted data

Ajout des règles de roll et de compatibilité des séries.

### 9 — Paper Trading

Clarification :
le paper valide le pipeline mais ne garantit pas des fills similaires au live.

### 10 — Fichier manquant

Le fichier `23-STRATEGY-CONFIG.example.json` est bien inclus dans cette V2.
