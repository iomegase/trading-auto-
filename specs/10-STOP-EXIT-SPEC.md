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

## Arrondi au tick

Le stop proposé est aligné sur `tickSize` avant le sizing :

- LONG : arrondi vers le haut, donc vers l'entrée
- SHORT : arrondi vers le bas, donc vers l'entrée

Après arrondi, le moteur revalide que le stop reste strictement du bon côté du prix d'entrée. Toute autre politique d'arrondi doit être versionnée et le risque recalculé avec le prix réellement soumis.

## Important : prix d'entrée

Le prix d'entrée réel n'est connu qu'à l'exécution.

Le Risk Engine doit recalculer le risque avec le prix exécutable/fill attendu.

Ce calcul inclut les coûts d'entrée, les coûts estimés d'une sortie au stop et un slippage adverse versionné. Le moteur ne peut pas supposer que le stop borne parfaitement la perte.

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

La différence entre le fill réel/simulé et le stop est comptabilisée dans le P&L et peut faire dépasser le budget de risque prévu. Le plafond de sizing défini par ADR-011 ne doit donc jamais être présenté comme une garantie de perte maximale.

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

## Ordre des événements bar-based

Pour une position déjà ouverte :

1. appliquer un éventuel gap de stop à l'open
2. évaluer le stop intrabar
3. évaluer à la clôture la règle de sortie de tendance
4. exécuter cette sortie au prochain prix tradable

Une sortie de tendance connue seulement au close ne peut pas annuler un stop qui a été touché auparavant dans la même bougie.

## Variantes

Chaque combinaison stop/exit reçoit un `exitPolicyVersion` distinct.
