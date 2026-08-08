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
- capital effectif `<= 1 000 EUR` démontré par tests de frontière
- coûts et slippage inclus dans le sizing
- quantité minimale, marge et exposition testées
- aucune injection de cash ou mise à l'échelle implicite

Une feature d'exécution exige en plus :

- idempotence
- state machine
- partial-fill handling
- reconciliation
- stale-data handling
- protective-stop acknowledgement ou incident explicite
