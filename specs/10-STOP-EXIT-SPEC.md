# Stop & Exit Spec

## Problème

Un backtest n'est pas défini tant que l'entrée, le stop et la sortie ne sont pas explicitement spécifiés.

## Baseline V1

Pour limiter les paramètres arbitraires, la baseline teste d'abord une logique Ichimoku simple.

### LONG

Au timestamp du signal :

```txt
proposedInitialStop = Kijun H1 du signal
```

Le signal est invalide si :

```txt
proposedInitialStop >= referenceEntryPrice
```

### SHORT

```txt
proposedInitialStop = Kijun H1 du signal
```

Invalide si :

```txt
proposedInitialStop <= referenceEntryPrice
```

## Important : prix d'entrée

Le prix d'entrée réel n'est connu qu'à l'exécution.

Le Risk Engine doit recalculer le risque avec le prix exécutable/fill attendu.

Si un gap rend le stop invalide ou le risque excessif :

```txt
REJECT
```

## Protective Stop

La baseline conserve le stop initial fixe après le fill.

Les variantes suivantes sont des expériences séparées :

- ATR stop
- swing stop
- Kumo stop
- trailing Kijun
- trailing ATR

## Trend Exit Baseline

LONG :

```txt
si close H1 < Kijun H1 sur une bougie clôturée
→ créer intention de sortie
→ exécuter selon le modèle NEXT_TRADABLE_PRICE
```

SHORT : inverse.

## Take Profit

Aucun take-profit fixe dans la baseline.

## Break-even

Aucun passage automatique au break-even dans la baseline.

## Gaps

Un stop n'est pas garanti d'être exécuté exactement au niveau demandé.

En simulation bar-based, si le prochain prix tradable dépasse le stop :

```txt
fill au prix disponible selon le modèle d'exécution
```

et non au stop théorique.

## Variantes

Chaque combinaison stop/exit reçoit un `exitPolicyVersion` distinct.
