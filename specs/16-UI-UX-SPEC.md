# UI/UX Spec

## Dashboard

- equity
- drawdown
- remaining/open risk
- positions
- today's signals
- data freshness
- system health
- trading mode

## Market Scanner

- market
- latest closed H4 regime
- H1 setup
- setup score
- breakout
- volatility
- signal age
- status

## Market Detail

Graphique :

- candles
- Tenkan
- Kijun
- **current Kumo**
- projected Kumo si souhaité
- Chikou
- fills
- stop
- exits

L'UI doit visuellement distinguer le Kumo actuel du Kumo projeté.

## Explainability

```txt
Mandatory
✓ H4 close > current Kumo
✓ H4 Kijun rising
✓ projected Kumo bullish
✓ H1 close > current Kumo
✓ breakout previous 20

Confirmations
✓ Tenkan > Kijun
✗ Chikou confirmation
```

## Strategy Lab

- trend timeframe
- signal timeframe
- Ichimoku periods
- displacement
- breakout lookback
- score config
- stop policy
- exit policy
- execution model
- cost model
- risk parameters

## Backtest

Afficher :

- gross vs net return
- costs
- max drawdown
- Sharpe/Sortino
- expectancy R
- profit factor
- trade count
- equity
- drawdown
- score buckets
- out-of-sample markers

## Terminologie

Interdit :

`Confidence 84%`

Correct :

`Setup score 84/100`
