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

## ADR-011 — Capital initial et plafond de sizing

initialCapital = 1 000 EUR
initialMaxSizingCapital = 1 000 EUR
cashInjection = FORBIDDEN

asymmetricEquity =
  realizedEquity + min(0, unrealizedPnl)

sizingEquity =
  min(max(0, asymmetricEquity), maxSizingCapital)

Les gains latents n'augmentent jamais le sizing. Les pertes latentes le réduisent immédiatement. `maxSizingCapital` ne peut augmenter que par activation manuelle d'une nouvelle `RiskPolicyVersion`; le solde broker, une stratégie ou un backtest ne peuvent pas l'augmenter automatiquement.

Le jalon 2A valide exactement `initialCapital = 1 000 EUR`; une nouvelle version
conserve ce capital initial mais peut définir un `maxSizingCapital` strictement
positif supérieur ou inférieur. Une `RiskPolicyVersion` est approuvée et immuable;
les brouillons sont hors de son type et de sa table, et l'approbation crée la
version persistée. La version résolue par identifiant est la seule autorité; toute
valeur de capital ou de risque répétée par une API ou une configuration doit lui
être exactement égale.

L'utilisation porte `riskPolicyUseMode` et `riskPolicyUseAt`, avec
`approvedAt <= activatedAt <= riskPolicyUseAt`. `FORWARD` impose
`riskPolicyUseAt = decisionAt`; `HISTORICAL_RESEARCH` impose
`riskPolicyUseAt = runCreatedAt`, immuable, même si les décisions de marché sont
antérieures.

## ADR-012 — Risque frais inclus

Le budget de risque par trade inclut perte au stop, spread, commissions, frais et slippage adverse budgété. Avec `0.50%` et `1 000 EUR`, le total ne peut pas dépasser `5 EUR`.

Une quantité minimale qui dépasse ce budget est rejetée.

## ADR-013 — Valeur monétaire d'un point

Le champ canonique est `monetaryValuePerPriceUnit` dans la devise de P&L. `tickValue / tickSize` sert de contrôle de cohérence. Le multiplicateur de contrat n'est jamais appliqué une seconde fois.

## ADR-014 — Exposition et levier futures

Le notionnel brut reste mesuré indépendamment de la marge. Toute `RiskPolicyVersion` futures fournit explicitement `maxGrossExposurePct` et `maxMarginUsagePct`. Une politique absente ne reçoit aucune valeur par défaut et ne peut approuver aucun ordre futures. Respecter la marge ne remplace jamais les limites de risque au stop, coûts ou notionnel.

Chaque produit exige aussi
`riskGroupMaxExposurePct[product.riskGroup]`. L'allocation vaut exactement
`sizingEquity * riskGroupMaxExposurePct[product.riskGroup] / 100`; une clé absente
est une entrée gouvernée invalide, sans valeur par défaut.

## ADR-015 — Pyramiding

La baseline autorise au maximum une position et une intention d'entrée active par instrument. Pyramiding et hedge simultané sur le même instrument sont interdits.
