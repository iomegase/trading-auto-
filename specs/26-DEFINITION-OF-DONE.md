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

Une feature d'exécution exige en plus :

- idempotence
- state machine
- partial-fill handling
- reconciliation
- stale-data handling
