# Architecture Decision Records

## ADR-001 — H4/H1 baseline

H4 = filtre de régime.
H1 = signal.

Statut : hypothèse de recherche.

## ADR-002 — Ichimoku 9/26/52

Baseline standard pour éviter l'optimisation prématurée.

## ADR-003 — Kumo actuel vs projeté

Décision critique :

```txt
current Kumo at t = raw spans computed at t-26
projected Kumo from t = raw spans computed at t
```

Le prix est comparé au `current Kumo`.

## ADR-004 — Breakout

Close actuel comparé au range des N bougies précédentes, sans bougie courante.

## ADR-005 — Score

Score calculé mais non bloquant initialement.

Aucun seuil 75 présumé optimal.

## ADR-006 — Initial Stop Baseline

Kijun H1 au moment du signal, fixe après entrée.

Comparaison avec ATR/swing/Kumo dans des expériences séparées.

## ADR-007 — Trend Exit Baseline

Cross de clôture H1 contre Kijun, exécution au prochain prix tradable selon modèle.

## ADR-008 — Execution Timing

Baseline :

```txt
signal on close
fill next bar open
```

Pas de fill rétroactif au close du signal.

## ADR-009 — Intrabar

Sans données plus fines :

```txt
STOP_FIRST
```

pour les conflits ambigus.

## ADR-010 — Live

AUTO hors V1.
