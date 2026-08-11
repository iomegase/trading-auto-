# Definition of Done

Une feature métier est terminée seulement si :

- requirement/spec identifié
- types stricts
- cas nominal testé
- cas limites testés
- causalité démontrée
- timestamps/availability corrects
- raisons observables
- config versionnée
- comportement reproductible
- erreur explicite
- aucun changement silencieux des hypothèses de backtest
- capital de sizing selon ADR-011 démontré par tests de frontière : `asymmetricEquity = realizedEquity + min(0, unrealizedPnl)` ; `sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)`
- coûts et slippage inclus dans le sizing
- capital initial exactement `1 000 EUR`
- aucune injection de cash
- plafond initial de capital de sizing exactement `1 000 EUR`
- les pertes latentes réduisent immédiatement le capital de sizing
- les gains latents n'augmentent jamais le capital de sizing
- toute hausse du plafond exige une nouvelle version de politique de risque approuvée manuellement
- les limites d'exposition brute et de marge des futures sont toutes deux explicites
- une quantité nulle n'est jamais arrondie à un contrat
- l'autorité unique de `RiskPolicyVersion` et le rejet des dénormalisations divergentes sont testés
- les assertions fixes 2A sont classées et testées indépendamment des miroirs de politique
- les deux modes de `riskPolicyUseAt` et leur chronologie sont testés
- le lien backtest des décisions historiques, son FK et son absence en `FORWARD` sont testés
- les limites de risk group et de contrats ont des raisons stables et observables

Une feature d'exécution exige en plus :

- idempotence
- state machine
- partial-fill handling
- reconciliation
- stale-data handling
- protective-stop acknowledgement ou incident explicite
