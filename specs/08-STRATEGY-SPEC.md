# Strategy Spec — ICHIMOKU_TREND_BREAKOUT_V1

## Nature

Baseline de recherche, pas stratégie validée.

## Moment de décision

La stratégie est évaluée après clôture et disponibilité de la bougie H1.

```txt
decisionAt >= H1.availableAt
```

## Trend Regime H4

Utiliser uniquement le dernier H4 clôturé disponible.

### BULLISH

- `H4.close > H4.currentCloudTop`
- `H4.kijunSlope > 0`
- `H4.projectedCloudDirection = BULLISH`

### BEARISH

- `H4.close < H4.currentCloudBottom`
- `H4.kijunSlope < 0`
- `H4.projectedCloudDirection = BEARISH`

Sinon `NEUTRAL`.

## LONG Mandatory Filters H1

- H4 regime = BULLISH
- H1 close > H1 currentCloudTop
- H1 Kijun slope > 0
- H1 close > plus haut des N bougies H1 **précédentes**

Défaut de recherche :

```txt
N = 20
```

## SHORT

Inverse strict.

## Breakout

LONG :

```ts
const previousHigh = max(high[t-N .. t-1])
const breakoutLong = close[t] > previousHigh
```

SHORT :

```ts
const previousLow = min(low[t-N .. t-1])
const breakoutShort = close[t] < previousLow
```

La bougie `t` est exclue de la fenêtre.

## Confirmations

- Tenkan/Kijun alignment
- Chikou rule
- ATR/volatility rule
- projected Kumo
- distance à Kijun

Les confirmations peuvent alimenter le score, mais ne remplacent pas les filtres obligatoires sauf nouvelle version de stratégie.

## Signal

Un signal contient :

- `decisionAt`
- `signalCandleCloseTime`
- `trendCandleCloseTime`
- mandatory filters
- confirmations
- setupScore
- proposedStop
- strategyVersion

## Expiration

Un signal doit avoir un TTL configurable.

Si le marché ouvre avec un gap ou si le contexte change avant exécution, le Risk/Execution Engine peut le refuser.

## Position Policy Baseline

- une seule position ouverte par instrument pour cette stratégie
- une seule intention d'entrée active par instrument
- pyramiding interdit
- aucun hedge LONG/SHORT simultané sur le même instrument
- un nouveau signal est enregistré mais rejeté avec `POSITION_ALREADY_OPEN` ou `ENTRY_INTENT_ALREADY_ACTIVE`

Toute politique de pyramiding ou de retournement immédiat exige une nouvelle version de stratégie et de modèle d'exécution.
