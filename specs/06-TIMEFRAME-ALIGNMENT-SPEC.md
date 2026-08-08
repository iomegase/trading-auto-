# Timeframe Alignment Spec

## Objectif

Empêcher toute fuite d'information lors du mélange H4/H1.

## Règle fondamentale

Pour un signal H1 décidé à `decisionAt`, le régime H4 doit provenir de :

```txt
latest H4 candle
WHERE H4.availableAt <= decisionAt
AND H4.isClosed = true
```

Jamais de la bougie H4 en cours.

## Exemple

Si une bougie H4 couvre 08:00 → 12:00 et que le signal H1 est décidé à 10:00 :

```txt
H4 08:00→12:00 = INTERDITE
```

Le moteur utilise la dernière H4 clôturée avant 10:00.

## Resampling

Si H4 est dérivé de H1 :

- utiliser le calendrier/session de l'instrument
- définir l'origine des fenêtres
- ne pas agréger arbitrairement sur des multiples UTC
- ne pas mélanger deux sessions distinctes sans règle explicite
- calculer `H4.availableAt = max(availableAt)` des bougies H1 réellement utilisées
- ne marquer H4 `isClosed = true` qu'après la fin de la fenêtre et la validation de toutes les bougies attendues ou des absences autorisées par le calendrier
- retourner `INSUFFICIENT_DATA` si une bougie attendue manque sans justification de calendrier

## Synchronisation multi-instruments

Si `signalInstrumentId != executionInstrumentId` :

- les deux flux ont leur propre `availableAt`
- aucune donnée d'exécution future ne peut influencer le signal
- un mapping de session doit être défini

## Tests

- H1 au milieu d'une H4
- H1 exactement à la clôture H4
- changement DST
- session interrompue
- jour férié
- dernière H1 constitutive reçue avec retard
- H1 manquante non justifiée → H4 inutilisable
