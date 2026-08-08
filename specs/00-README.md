# Trading Automatisé — Spec-Driven V2

## Objectif

Construire une plateforme de recherche, backtest, paper trading et, seulement après validation, exécution automatisée d'une stratégie Ichimoku.

La V1 de recherche est basée sur :

- filtre de tendance H4
- signal H1
- Ichimoku 9/26/52
- breakout
- filtre/score de qualité
- Risk Engine indépendant
- exécution désactivée par défaut

## Principe

Séparer strictement :

```txt
Market Data
→ Timeframe Alignment
→ Indicators
→ Market Regime
→ Strategy
→ Setup Score
→ Risk
→ Execution
```

Le backtest doit réutiliser exactement les mêmes fonctions métier que le moteur temps réel.

## Corrections majeures V2

1. Le Kumo visible au temps `t` utilise les Senkou calculées à `t - 26`.
2. Les Senkou calculées à `t` décrivent le Kumo projeté à `t + 26`.
3. Le signal H1 ne peut utiliser que le dernier H4 entièrement clôturé.
4. Un signal connu à la clôture d'une bougie ne doit pas être rempli rétroactivement sur cette même clôture.
5. Les conflits intrabar stop/target doivent avoir une politique explicite.
6. Le stop et la sortie font maintenant partie de la stratégie versionnée.
7. Le sizing tient compte de la valeur du point, de la devise et des contraintes de quantité.
8. Les datasets, coûts, configuration et code doivent être versionnés pour reproduire un backtest.
9. Le score n'est pas une probabilité de succès.
10. Le paper trading n'est pas une preuve de qualité d'exécution live.

## Structure cible

```txt
apps/
  dashboard/
  engine/

packages/
  domain/
  market-data/
  calendars/
  indicators/
  strategy-ichimoku/
  scoring/
  risk/
  backtester/
  execution/
  broker/
  database/
  observability/
```

## Règles non négociables

- aucune fuite de données futures
- aucune utilisation d'une bougie non clôturée pour une règle `ON_CLOSE`
- timestamps et disponibilité des données explicitement définis
- même logique indicateur/stratégie en backtest et live
- coûts de transaction intégrés
- modèle d'exécution explicitement défini
- décision et raisons persistées
- Risk Engine obligatoire avant ordre
- mode live désactivé par défaut
