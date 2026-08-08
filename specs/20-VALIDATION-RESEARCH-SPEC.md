# Validation & Research Spec

## Objectif

Évaluer si la stratégie possède un edge robuste, pas trouver le meilleur résultat historique.

## Baselines à comparer

- Ichimoku Trend Breakout baseline
- sans score
- sans breakout
- breakout seul
- buy-and-hold lorsque comparable

## Data Splits

Définir avant optimisation :

- train/in-sample
- validation
- final untouched out-of-sample

Le jeu final ne doit pas servir à choisir les paramètres.

## Walk Forward

Toute optimisation doit être effectuée uniquement sur le passé de chaque fenêtre.

## Parameter Sensitivity

Tester des plages locales autour des paramètres.

Une stratégie dont la performance n'existe que sur un point précis est suspecte.

## Cost Stress

Tester au minimum plusieurs scénarios :

- base spread/slippage
- 1.5× coûts
- 2× coûts

Chaque scénario doit être simulé avec le capital réel de `1 000 EUR`, les pas de quantité, commissions minimales et contraintes de marge. Il est interdit de backtester sur un gros capital puis de diviser linéairement le résultat.

## Sample Size

Ne pas conclure sur le score ou un sous-groupe avec trop peu de trades.

Afficher systématiquement le nombre d'observations.

Afficher aussi :

- signaux bruts
- trades réellement exécutables
- rejets `MIN_QUANTITY`, `COSTS`, `MARGIN`, `CAPITAL_CAP`
- taux de faisabilité pour un compte de `1 000 EUR`

## Multiple Testing

Plus le Strategy Lab teste de variantes, plus le risque de sélectionner un faux positif augmente.

Conserver :

- nombre de configurations testées
- historique des expériences
- métriques out-of-sample

## Regimes

Analyser séparément :

- bullish
- bearish
- high volatility
- low volatility
- crisis/stress periods

sans réécrire les règles après observation du test final.

## Paper → Live

Le paper trading valide surtout le fonctionnement du pipeline.

Avant live :

- comparer backtest vs forward paper
- examiner slippage/fill assumptions
- tester incidents réseau
- tester stale data
- tester broker rejection

Avant de conclure à l'éligibilité d'un instrument, stresser aussi les gaps, la hausse de marge, la conversion FX et le coût minimum par ordre. Une stratégie statistiquement positive mais inexécutable avec `1 000 EUR` est rejetée pour ce périmètre.
