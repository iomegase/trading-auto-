# Security & Trading Safety Spec

## Secrets

Jamais dans Git :

- broker credentials
- API tokens
- database credentials

## Default

```txt
TRADING_MODE=DISABLED
ALLOW_LIVE_TRADING=false
```

L'application ne peut pas passer en live si `ALLOW_LIVE_TRADING` n'est pas explicitement activé côté serveur.

## Kill Switch

Actions séparées :

1. block new entries
2. cancel pending entry orders
3. cancel all cancellable orders
4. flatten positions

`flatten positions` doit être une action distincte et explicite.

## Server Authority

Le frontend ne peut jamais modifier directement :

- approved quantity
- broker destination
- risk result
- live permission

## Immutable Strategy Versions

Une configuration utilisée par un signal/backtest ne peut plus être modifiée.

Créer une nouvelle version.

## Reconciliation Safety

Après timeout réseau, l'état d'un ordre devient `UNKNOWN` tant que le broker n'a pas été interrogé.

Ne jamais resoumettre automatiquement sur la seule base d'un timeout.
