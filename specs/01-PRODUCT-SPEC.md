# Product Spec

## Produit

Plateforme de recherche et d'automatisation progressive d'une stratégie Ichimoku sur marchés indiciels.

## Objectif V1

Répondre statistiquement à la question :

> La stratégie Ichimoku Trend Breakout H4/H1 possède-t-elle un avantage robuste après coûts, slippage et contraintes d'exécution ?

La V1 n'a pas pour objectif de maximiser le rendement ni d'optimiser automatiquement les paramètres.

## Univers logique initial

- DAX
- CAC 40
- S&P 500
- Nasdaq 100

Un `Market` logique doit être séparé de l'instrument réellement utilisé :

- indice cash pour analyse éventuelle
- future
- ETF
- CFD

Toute utilisation de deux instruments différents pour signal et exécution doit être explicite et testée avec des séries temporelles synchronisées.

## Modes

- `RESEARCH` : backtest uniquement
- `SIGNAL` : génération de signaux, aucun ordre
- `PAPER` : exécution simulée
- `SEMI_AUTO` : validation humaine avant soumission
- `AUTO` : automatisation complète

`AUTO` est interdit en V1 et désactivé par défaut.

## Timeframes baseline

- Trend : H4
- Signal : H1

Hypothèse de recherche uniquement. Paramètres configurables et versionnés.

## Pages

- Dashboard
- Market Scanner
- Market Detail
- Strategy Lab
- Backtests
- Signals
- Positions
- Risk
- Data Quality
- System Health
- Settings
