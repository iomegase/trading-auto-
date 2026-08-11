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
- equity réalisée et P&L non réalisé attribués à la stratégie
- `maxSizingCapital` de la `RiskPolicyVersion` active
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
asymmetricEquityAccount =
  realizedEquityAccount + min(0, unrealizedPnlAccount)

sizingEquityAccount =
  min(max(0, asymmetricEquityAccount), maxSizingCapitalAccount)

riskRate =
  riskPerTradePct / 100

riskBudgetAccount =
  sizingEquityAccount * riskRate

stopDistance =
  abs(entryPrice - roundedExecutableStopPrice)

riskPerUnitQuote =
  stopDistance * monetaryValuePerPriceUnit

riskPerUnitAccount =
  riskPerUnitQuote * fxPnlToAccount

allowedMargin =
  sizingEquityAccount * maxMarginUsagePct / 100

allowedGrossExposure =
  sizingEquityAccount * maxGrossExposurePct / 100

allowedOpenRisk =
  sizingEquityAccount * maxOpenRiskPct / 100

allowedRiskGroupExposure =
  sizingEquityAccount * riskGroupMaxExposurePct[product.riskGroup] / 100
```

La quantité approuvée est la plus grande quantité sur la grille `quantityStep` qui satisfait simultanément :

```txt
worstCaseBudgetedLoss(quantity) <= riskBudgetAccount
marginAfterOrder <= allowedMargin
grossExposureAfterOrder <= allowedGrossExposure
openRiskAfterOrder <= allowedOpenRisk
riskGroupExposureAfterOrder <= allowedRiskGroupExposure
availableFundsAfterOrder >= budgetedCostsAndCashReserve
```

où `worstCaseBudgetedLoss` inclut la perte au stop, le spread, les commissions, les frais, le financement prévisible et le slippage adverse d'entrée/sortie. Cette recherche sur la grille est obligatoire lorsque les commissions minimales ou paliers rendent la formule non linéaire.

`grossExposureAfterOrder` est la somme des notionnels absolus, convertis dans la devise du compte. Les positions opposées ne se compensent pas dans cette mesure.

La clé `riskGroupMaxExposurePct[product.riskGroup]` est obligatoire. Son absence
est une erreur typée `INVALID_RISK_INPUT` signalant une politique gouvernée
incomplète; aucune valeur par défaut n'est appliquée. L'égalité exacte avec
`allowedRiskGroupExposure` est admissible.

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
- equity asymétrique, capital de sizing ou `RiskPolicyVersion` indisponible
- capital de sizing supérieur au `maxSizingCapital` après erreur de configuration
- quantity < minQuantity
- max positions dépassé
- position ou intention d'entrée déjà active sur l'instrument
- max open risk dépassé
- max risk group dépassé
- marge insuffisante
- fonds disponibles insuffisants après réserve des coûts
- limite explicite de marge ou d'exposition brute absente pour tout instrument à levier
- coûts estimés supérieurs ou égaux au budget de risque
- daily loss guard atteint
- drawdown guard atteint
- kill switch actif
- signal expiré

Réduire si :

Une quantité demandée supérieure à `maxContractsPerPosition` produit
`REDUCE_SIZE` avec la raison stable `MAX_CONTRACTS_PER_POSITION` lorsqu'une
quantité plafonnée est admissible. Si aucune ne l'est, `REJECT` conserve cette
raison ainsi que les contraintes applicables à la quantité minimale. Lorsque la
quantité n'est pas demandée explicitement, le plafond borne seulement la
recherche et n'ajoute pas cette raison.

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
initialMaxSizingCapital = 1 000 EUR
```

La factory `RiskPolicyVersion` est propriétaire de la validation de baseline 2A :
elle accepte uniquement le décimal canonique `initialCapital = 1000` avec compte
et référence EUR. Elle rejette notamment `900`, `1000.01` et toute représentation
mal formée. La baseline interdit toute injection de cash. Le capital de sizing
est l'equity réalisée diminuée immédiatement des pertes latentes, sans inclure
les gains latents, puis bornée par le `maxSizingCapital` de la
`RiskPolicyVersion` active. Le plafond initial vaut `1 000 EUR`; une nouvelle
version manuellement approuvée peut ensuite définir un plafond positif supérieur
ou inférieur au capital initial.

Les paramètres de risque peuvent être réduits et ne sont pas optimaux par définition. Tout produit à levier exige des limites explicites d'exposition brute et de marge. En complément, toute `RiskPolicyVersion` futures doit fournir explicitement `maxGrossExposurePct` et `maxMarginUsagePct`; aucune valeur par défaut ne peut approuver un ordre futures. Respecter la marge ne remplace jamais les limites de risque au stop, coûts ou notionnel.

La `RiskPolicyVersion` résolue par son identifiant est l'unique autorité. Les
copies de capital initial/plafond, devises, modes, pourcentages de risque,
comptages, limites d'exposition brute/marge et carte de risk groups sont des
dénormalisations validées : toute différence avec la politique résolue est une
erreur d'entrée, jamais une surcharge ou une règle de priorité.

Les champs suivants ne sont pas des miroirs de `RiskPolicyVersion`; ce sont des
assertions de sécurité et métadonnées moteur fixes du jalon 2A :

```txt
futuresEligibility = RESEARCH_ONLY
requireExplicitGrossExposureLimit = true
includeEstimatedExitCosts = true
rejectIfMinQuantityExceedsRiskBudget = true
```

Le parseur de configuration exige exactement ces constantes. Une divergence
produit `INVALID_CONFIG`; un objet forgé qui atteint la frontière publique du
Risk Engine produit `INVALID_RISK_INPUT`. Ces assertions ne fusionnent pas avec
la politique et ne peuvent jamais la surcharger. La note d'éligibilité FDXS/MES
vit dans l'objet top-level `research` et reste une métadonnée non gouvernée.

Avec la baseline EUR à `1 000 EUR`, `0.50%` correspond à un budget maximal de `5 EUR` par trade, coûts et slippage budgétés inclus. Si aucune quantité négociable ne respecte ce budget, le résultat attendu est `REJECT`.
