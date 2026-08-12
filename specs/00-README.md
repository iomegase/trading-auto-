# Trading Automatisé — Spec-Driven V3

## Objectif

Construire une plateforme de recherche, backtest, paper trading et, seulement après validation, exécution automatisée d'une stratégie Ichimoku.

La baseline démarre avec `initialCapital = 1 000 EUR` et interdit toute injection de cash. Le capital de sizing est l'equity réalisée diminuée immédiatement des pertes latentes, sans inclure les gains latents, puis bornée par le `maxSizingCapital` de la `RiskPolicyVersion` active. Le plafond initial vaut `1 000 EUR`; toute augmentation est manuelle, auditée et versionnée.

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

## Corrections majeures V2 et audit V3

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
11. Le sizing applique l'equity asymétrique et le `maxSizingCapital` de la `RiskPolicyVersion` active, même si le compte broker contient davantage.
12. Les frais et le slippage budgétés font partie du risque par trade.
13. `pointValue` et `contractMultiplier` ne peuvent pas être multipliés deux fois.
14. Un instrument dont la quantité minimale, la marge ou les coûts dépassent les limites est non éligible ; aucun arrondi à la hausse n'est permis.
15. Le plafond de capital ne garantit pas une perte maximale : gaps, levier et défaillances d'exécution restent possibles.

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
- capital de sizing borné par le `maxSizingCapital` de la `RiskPolicyVersion` active
- aucune injection de capital implicite dans un backtest
- aucune quantité minimale forcée si elle dépasse le budget de risque
- mode live désactivé par défaut

## Version de l'audit

Les corrections de cohérence et de risque introduites après la V2 sont consignées dans `30-AUDIT-CORRECTIONS-V3.md`.
