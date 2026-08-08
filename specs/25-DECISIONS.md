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

`SEMI_AUTO` est également indisponible dans la livraison V1 de recherche.

## ADR-011 — Capital de stratégie

```txt
referenceCurrency = EUR
hardCapitalCap = 1 000 EUR
effectiveCapital = min(strategyEquity, convertedHardCap)
```

Le solde total du compte broker ne peut pas augmenter automatiquement ce capital effectif. Le backtest baseline démarre avec `1 000 EUR` et interdit toute injection de cash.

## ADR-012 — Risque frais inclus

Le budget de risque par trade inclut perte au stop, spread, commissions, frais et slippage adverse budgété. Avec `0.50%` et `1 000 EUR`, le total ne peut pas dépasser `5 EUR`.

Une quantité minimale qui dépasse ce budget est rejetée.

## ADR-013 — Valeur monétaire d'un point

Le champ canonique est `monetaryValuePerPriceUnit` dans la devise de P&L. `tickValue / tickSize` sert de contrôle de cohérence. Le multiplicateur de contrat n'est jamais appliqué une seconde fois.

## ADR-014 — Exposition baseline

La configuration de recherche limite l'exposition brute à `100%` du capital effectif et l'utilisation de marge à `100%`. Toute utilisation de levier supérieure exige une nouvelle décision versionnée ; le respect de la marge ne remplace pas le budget de risque.

## ADR-015 — Pyramiding

La baseline autorise au maximum une position et une intention d'entrée active par instrument. Pyramiding et hedge simultané sur le même instrument sont interdits.
