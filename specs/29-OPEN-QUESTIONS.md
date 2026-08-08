# Open Questions Before Implementation Beyond Milestone 1

Ces questions ne bloquent pas l'implémentation du moteur Ichimoku et des tests causaux, mais doivent être résolues avant un backtest réaliste complet ou toute intégration broker.

## OQ-001 — Instrument réellement tradé

Pour chaque marché logique :

- DAX
- CAC 40
- S&P 500
- Nasdaq 100

choisir explicitement :

- future
- ETF
- CFD
- autre

Le `pointValue`, les horaires, les frais, le spread et le margin model en dépendent.

## OQ-002 — Source Market Data

Choisir le provider principal et définir :

- historique disponible
- qualité des H1/H4
- bid/ask disponible ou non
- timezone
- pacing
- coût
- politique de correction des données

## OQ-003 — Signal instrument vs execution instrument

Décider si les indicateurs sont calculés :

- directement sur l'instrument tradé
- sur l'indice cash puis exécutés sur un dérivé

Cette décision modifie le backtest et doit être versionnée.

## OQ-004 — Sessions

Définir pour chaque instrument :

- RTH seulement
- session étendue
- session future complète

Ne pas comparer des backtests utilisant des sessions différentes comme s'ils utilisaient la même stratégie.

## OQ-005 — Cost Model

Définir par instrument :

- commissions
- exchange fees
- spread
- slippage
- overnight financing si applicable

## OQ-006 — Exit Experiments

La baseline est :

- stop Kijun H1 initial fixe
- sortie sur clôture H1 contre Kijun

Les variantes ATR, Kumo, swing, trailing Kijun doivent être des expériences séparées.

## OQ-007 — Risk Group Limits

Définir les groupes initiaux, par exemple :

- EUROPE_EQUITY_INDEX
- US_EQUITY_INDEX

et leurs limites avant paper trading multi-position.

## OQ-008 — Minimum Statistical Evidence

Définir avant optimisation les critères nécessaires pour considérer une variante comme candidate :

- nombre minimum de trades
- durée minimale
- robustesse aux coûts
- comportement out-of-sample
- stabilité des paramètres

Éviter de fixer ces critères après avoir observé les meilleurs résultats.
