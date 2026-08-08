# Market Data Spec

## MD-001 — Normalisation

Stocker :

- timestamp source
- timezone source
- timestamp UTC
- exchange timezone
- ingestion time
- provider
- instrument
- timeframe

Ne pas supposer que le fournisseur renvoie déjà UTC.

## MD-002 — OHLC Validation

```txt
high >= max(open, close)
low <= min(open, close)
high >= low
```

Les prix doivent être finis et strictement positifs lorsque l'instrument l'exige.

## MD-003 — Unicité

Clé logique :

```txt
provider + instrumentId + timeframe + openTime
```

## MD-004 — Gaps

Un gap de timestamp n'est pas automatiquement une erreur.

La détection doit utiliser le calendrier de marché :

- jours ouvrés
- jours fériés
- sessions
- pauses intraday
- changements DST

## MD-005 — Donnée clôturée

Une stratégie `ON_CLOSE` ne peut utiliser une bougie que si :

```txt
isClosed = true
AND availableAt <= decisionAt
```

## MD-006 — Métadonnées instrument

Minimum :

- symbol
- providerSymbol
- exchange
- assetClass
- quoteCurrency
- pnlCurrency
- exchangeTimezone
- tickSize
- tickValue
- quantityStep
- minQuantity
- contractMultiplier
- monetaryValuePerPriceUnit
- sessionCalendarId
- riskGroup

`monetaryValuePerPriceUnit` est la valeur monétaire d'un mouvement de prix de `1.0` pour une unité/contrat, dans `pnlCurrency`. Il peut être dérivé de `tickValue / tickSize` ou du multiplicateur, mais jamais obtenu en multipliant à nouveau deux champs qui représentent déjà la même valeur économique.

Les métadonnées doivent vérifier :

```txt
tickSize > 0
tickValue > 0
monetaryValuePerPriceUnit > 0
abs(tickValue / tickSize - monetaryValuePerPriceUnit) <= tolerance
```

## MD-007 — Reproductibilité

Chaque backtest référence un `datasetVersion` immuable.

## MD-008 — Futures

Si des futures sont utilisés :

- conserver le contrat réel
- conserver l'échéance
- définir explicitement la règle de roll
- ne pas utiliser naïvement une série back-adjusted pour calculer un P&L exécutable

## MD-009 — Adjustments

Pour ETF/actions, indiquer explicitement :

- raw
- split-adjusted
- total-return adjusted

Le signal et le modèle d'exécution doivent utiliser des séries compatibles.
