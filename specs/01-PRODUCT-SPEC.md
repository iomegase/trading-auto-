# Product Spec

## Produit

Plateforme de recherche et d'automatisation progressive d'une stratégie Ichimoku sur marchés indiciels.

## Objectif V1

Répondre statistiquement à la question :

> La stratégie Ichimoku Trend Breakout H4/H1 possède-t-elle un avantage robuste après coûts, slippage et contraintes d'exécution ?

La V1 n'a pas pour objectif de maximiser le rendement ni d'optimiser automatiquement les paramètres.

## Capital de référence

- devise de référence : `EUR`
- capital initial des backtests baseline : `1 000 EUR`
- plafond absolu alloué à la stratégie : `1 000 EUR`
- aucune recharge automatique ou injection de cash pendant un backtest

Le capital effectif utilisé pour le sizing est le minimum entre l'equity réellement attribuée à la stratégie et l'équivalent de `1 000 EUR`. Un solde broker supérieur ne doit jamais augmenter automatiquement la taille des positions de cette stratégie.

Le plafond de `1 000 EUR` ne constitue pas une garantie de perte maximale. Les gaps, positions short, produits dérivés et incidents d'exécution peuvent produire une perte supérieure au risque calculé au stop. Tout instrument doit donc réussir un contrôle d'éligibilité portant au minimum sur la quantité minimale, la marge, le notionnel, les coûts et le risque de gap.

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

La livraison V1 n'autorise que `RESEARCH`, `SIGNAL` et `PAPER`. `SEMI_AUTO` et `AUTO` sont des modes post-V1 nécessitant une décision et une activation serveur explicites.

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
