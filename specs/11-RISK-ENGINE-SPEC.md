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
- equity attribuée à la stratégie
- plafond de capital de référence (`1 000 EUR`)
- account currency
- current portfolio
- entry reference / executable price
- stop price
- P&L currency
- valeur monétaire canonique par unité de mouvement de prix
- FX conversion
- tick size
- quantity step
- min/max quantity
- initial/maintenance margin et marge déjà engagée pour tout instrument à levier
- coûts d'entrée et de sortie au stop
- slippage adverse budgété
- exposition brute/notionnelle
- risk-group exposure
- strategy limits

## Position Sizing

```txt
hardCapAccount =
  conservativeFxConvert(1 000 EUR, accountCurrency)

effectiveCapitalAccount =
  min(strategyEquityAccount, hardCapAccount)

riskRate =
  riskPerTradePct / 100

riskBudgetAccount =
  effectiveCapitalAccount * riskRate

stopDistance =
  abs(entryPrice - roundedExecutableStopPrice)

riskPerUnitQuote =
  stopDistance * monetaryValuePerPriceUnit

riskPerUnitAccount =
  riskPerUnitQuote * fxPnlToAccount

allowedMargin =
  effectiveCapitalAccount * maxMarginUsagePct / 100

allowedGrossExposure =
  effectiveCapitalAccount * maxGrossExposurePct / 100

allowedOpenRisk =
  effectiveCapitalAccount * maxOpenRiskPct / 100
```

La quantité approuvée est la plus grande quantité sur la grille `quantityStep` qui satisfait simultanément :

```txt
worstCaseBudgetedLoss(quantity) <= riskBudgetAccount
marginAfterOrder <= allowedMargin
grossExposureAfterOrder <= allowedGrossExposure
openRiskAfterOrder <= allowedOpenRisk
availableFundsAfterOrder >= budgetedCostsAndCashReserve
```

où `worstCaseBudgetedLoss` inclut la perte au stop, le spread, les commissions, les frais, le financement prévisible et le slippage adverse d'entrée/sortie. Cette recherche sur la grille est obligatoire lorsque les commissions minimales ou paliers rendent la formule non linéaire.

`grossExposureAfterOrder` est la somme des notionnels absolus, convertis dans la devise du compte. Les positions opposées ne se compensent pas dans cette mesure.

Si la plus grande quantité admissible sur la grille est inférieure à `minQuantity`, la décision est `REJECT`. Il est interdit d'arrondir à `minQuantity` car cela dépasserait le budget de risque.

## Important

`monetaryValuePerPriceUnit` doit avoir une définition instrument-spécifique et être exprimé dans `pnlCurrency`.

Pour les futures, il inclut déjà le multiplicateur économique du contrat.
Pour actions/ETF, une unité de prix par action doit être correctement convertie.
Pour CFD, suivre la convention du broker.

Le moteur valide la cohérence `tickValue / tickSize`. Il ne multiplie jamais à la fois une valeur du point déjà complète et `contractMultiplier`.

## Guards

Refuser si :

- données stales
- stop invalide
- prix exécutable invalide
- valeur monétaire par unité de prix invalide ou incohérente
- prix ou stop non aligné sur le tick après arrondi contrôlé
- FX stale/invalide
- capital effectif ou conversion du plafond indisponible
- capital effectif supérieur au plafond après erreur de configuration
- quantity < minQuantity
- max positions dépassé
- position ou intention d'entrée déjà active sur l'instrument
- max open risk dépassé
- max risk group dépassé
- marge insuffisante
- fonds disponibles insuffisants après réserve des coûts
- limite de marge ou d'exposition brute absente pour un produit à levier
- coûts estimés supérieurs ou égaux au budget de risque
- daily loss guard atteint
- drawdown guard atteint
- kill switch actif
- signal expiré

## Open Risk

Calculer le risque restant vers les stops, en tenant compte des positions existantes et des coûts estimés de liquidation.

Pour une position dont le stop protège déjà un gain, le risque directionnel restant est borné à zéro avant ajout des coûts :

```txt
remainingDirectionalRisk = max(0, lossToStop)
remainingOpenRisk = remainingDirectionalRisk + estimatedExitCosts
```

Un stop ne garantit pas le montant maximal de perte en cas de gap.

## Valeurs de recherche initiales

```txt
riskPerTrade = 0.50%
maxOpenRisk = 2.00%
maxOpenPositions = 4
maxGrossExposure = 100.00%
maxMarginUsage = 100.00%
hardCapitalCap = 1 000 EUR
```

Les paramètres de risque peuvent être réduits et ne sont pas optimaux par définition. Le plafond de capital constitue une borne supérieure non augmentable.

Le plafond `hardCapitalCap` ne peut pas être augmenté par une configuration de stratégie. Le réduire crée une nouvelle version valide ; le dépasser est une erreur de validation.

Avec la baseline EUR à `1 000 EUR`, `0.50%` correspond à un budget maximal de `5 EUR` par trade, coûts et slippage budgétés inclus. Si aucune quantité négociable ne respecte ce budget, le résultat attendu est `REJECT`.
