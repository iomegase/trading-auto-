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
MAX_STRATEGY_CAPITAL_EUR=1000
```

L'application ne peut pas passer en live si `ALLOW_LIVE_TRADING` n'est pas explicitement activé côté serveur.

Dans la V1 de recherche, `SEMI_AUTO` et `AUTO` restent tous deux indisponibles même si une variable locale est modifiée. Une future activation nécessite une version post-V1 et une décision explicite.

`MAX_STRATEGY_CAPITAL_EUR` est un plafond serveur : une configuration utilisateur peut le réduire mais jamais l'augmenter. Les fonds d'autres stratégies ou du reste du compte ne peuvent pas être utilisés implicitement.

Le démarrage échoue si cette valeur n'est pas strictement positive ou dépasse `1000`. Le maximum absolu de `1 000 EUR` est également validé dans le code de domaine et ne dépend pas uniquement d'une variable d'environnement.

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
- capital effectif ou plafond de stratégie

## Immutable Strategy Versions

Une configuration utilisée par un signal/backtest ne peut plus être modifiée.

Créer une nouvelle version.

## Reconciliation Safety

Après timeout réseau, l'état d'un ordre devient `UNKNOWN` tant que le broker n'a pas été interrogé.

Ne jamais resoumettre automatiquement sur la seule base d'un timeout.

## Limites des protections

- un stop applicatif ne garantit pas la perte maximale lors d'un gap
- la marge disponible ne constitue pas un budget de risque
- la protection contre solde négatif éventuellement fournie par un broker ne remplace aucun contrôle interne
- tout produit à levier exige des limites explicites de marge et d'exposition avant paper trading
