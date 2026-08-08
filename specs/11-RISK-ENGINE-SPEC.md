# Risk Engine Spec

## Responsabilité

Le Risk Engine ne prédit pas le marché.

Il protège le portefeuille et transforme un setup en quantité autorisée.

## Résultat

- `APPROVE`
- `REJECT`
- `REDUCE_SIZE`

## Entrées

- account equity
- account currency
- current portfolio
- entry reference / executable price
- stop price
- quote currency
- contract multiplier / point value
- FX conversion
- tick size
- quantity step
- min/max quantity
- margin requirement si disponible
- risk-group exposure
- strategy limits

## Position Sizing

```txt
riskAmountAccount =
  equityAccount * riskPercent

stopDistance =
  abs(entryPrice - stopPrice)

riskPerUnitQuote =
  stopDistance * pointValueQuote

riskPerUnitAccount =
  riskPerUnitQuote * fxQuoteToAccount

rawQuantity =
  riskAmountAccount / riskPerUnitAccount

quantity =
  floorToStep(rawQuantity, quantityStep)
```

## Important

`pointValueQuote` doit avoir une définition instrument-spécifique.

Pour les futures, inclure le multiplicateur du contrat.
Pour actions/ETF, une unité de prix par action doit être correctement convertie.
Pour CFD, suivre la convention du broker.

## Guards

Refuser si :

- données stales
- stop invalide
- prix exécutable invalide
- point value invalide
- FX stale/invalide
- quantity < minQuantity
- max positions dépassé
- max open risk dépassé
- max risk group dépassé
- marge insuffisante
- daily loss guard atteint
- drawdown guard atteint
- kill switch actif
- signal expiré

## Open Risk

Calculer le risque restant vers les stops, en tenant compte des positions existantes.

Un stop ne garantit pas le montant maximal de perte en cas de gap.

## Valeurs de recherche initiales

```txt
riskPerTrade = 0.50%
maxOpenRisk = 2.00%
maxOpenPositions = 4
```

Ces valeurs sont configurables et non optimales par définition.
