# Ichimoku Indicator Spec

## Paramètres baseline

```txt
tenkanPeriod = 9
kijunPeriod = 26
senkouBPeriod = 52
displacement = 26
```

Configurables et versionnés.

## Valeurs brutes calculées à t

```txt
tenkan[t] =
  (highestHigh(t-8..t) + lowestLow(t-8..t)) / 2

kijun[t] =
  (highestHigh(t-25..t) + lowestLow(t-25..t)) / 2

senkouA_raw[t] =
  (tenkan[t] + kijun[t]) / 2

senkouB_raw[t] =
  (highestHigh(t-51..t) + lowestLow(t-51..t)) / 2
```

## Nuage projeté

Les valeurs :

```txt
senkouA_raw[t]
senkouB_raw[t]
```

sont visuellement projetées à :

```txt
t + displacement
```

Elles sont cependant connues à `t`.

## Nuage visible au temps t

Pour comparer le prix au Kumo **actuel** :

```txt
currentCloudA[t] = senkouA_raw[t - displacement]
currentCloudB[t] = senkouB_raw[t - displacement]
```

Puis :

```txt
currentCloudTop = max(currentCloudA, currentCloudB)
currentCloudBottom = min(currentCloudA, currentCloudB)
```

Il est incorrect de comparer `close[t]` directement à `senkouA_raw[t]` / `senkouB_raw[t]` en prétendant que ces valeurs représentent le nuage visible à `t`.

## Kumo projeté

```txt
projectedCloudTop[t] =
  max(senkouA_raw[t], senkouB_raw[t])

projectedCloudBottom[t] =
  min(senkouA_raw[t], senkouB_raw[t])
```

Direction :

```txt
BULLISH si senkouA_raw[t] > senkouB_raw[t]
BEARISH si senkouA_raw[t] < senkouB_raw[t]
NEUTRAL sinon
```

## Historique minimum

Pour disposer du `currentCloudB[t]` avec les paramètres 52/26, il faut suffisamment d'historique pour calculer Senkou B à `t-26`.

Avec une série indexée à partir de zéro et les paramètres 52/26, le premier `currentCloudB` valide est obtenu à l'index `77`, c'est-à-dire sur la 78e bougie. Ce cas doit faire l'objet d'un test explicite d'absence d'erreur off-by-one.

Index initiaux attendus pour la baseline :

| Valeur | Premier index valide |
|---|---:|
| Tenkan | 8 |
| Kijun | 25 |
| Senkou A raw / projetée | 25 |
| Senkou B raw / projetée | 51 |
| Current Cloud A | 51 |
| Current Cloud B | 77 |

Une règle nécessitant le Kumo complet retourne `INSUFFICIENT_DATA` avant l'index `77`.

## Chikou

La Chikou est le `close[t]` représenté à `t - displacement`.

La V1 de confirmation LONG utilise :

```txt
close[t] > high[t - displacement]
```

SHORT :

```txt
close[t] < low[t - displacement]
```

Ce choix est une règle de stratégie, pas la définition mathématique de Chikou.

## Kijun Slope

```txt
kijunSlope[t] =
  kijun[t] - kijun[t - slopeLookback]
```

## Anti-look-ahead

Le modèle de données ne doit jamais matérialiser des valeurs futures accessibles à la stratégie via un simple index de graphique.

Séparer :

- valeur calculée
- timestamp de calcul
- offset d'affichage
