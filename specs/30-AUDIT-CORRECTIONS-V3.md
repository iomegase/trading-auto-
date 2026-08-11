# Audit des spécifications — Corrections V3

## Périmètre

Audit statique des fichiers `README.md` et `specs/00` à `specs/29`. Cet audit vérifie la cohérence fonctionnelle, temporelle, financière, de persistance et d'exécution. Il ne valide pas la rentabilité de la stratégie.

Politique de sizing appliquée : voir ADR-011. La baseline démarre avec `initialCapital = 1 000 EUR`, interdit toute injection de cash et borne le sizing selon l'equity asymétrique et le `maxSizingCapital` de la `RiskPolicyVersion` active.

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

## Corrections critiques appliquées

### 1 — Capital absent des contrats

Avant audit, aucun capital initial ni plafond n'était défini. Un même backtest pouvait donc produire des résultats avec une taille de compte arbitraire.

Correction : baseline `initialCapital = 1 000 EUR`, `initialMaxSizingCapital = 1 000 EUR`, aucune injection de cash et aucun scaling a posteriori. Le capital de sizing suit désormais ADR-011 : equity réalisée plus les seules pertes latentes, bornée par le `maxSizingCapital` de la `RiskPolicyVersion` active; toute hausse est manuelle, auditée et versionnée.

### 2 — Pourcentage de risque ambigu

La formule utilisait `equity × riskPercent` tandis que la configuration stockait `0.5` pour signifier `0.50%`. Une implémentation littérale aurait risqué `50%` du capital.

Correction : `riskRate = riskPerTradePct / 100`. Sur `1 000 EUR`, le budget baseline est `5 EUR` par trade.

### 3 — Frais exclus du sizing

La perte au stop seule déterminait la quantité. Sur un petit compte, commissions minimales, spread et slippage peuvent dépasser le budget.

Correction : la quantité maximale doit respecter une fonction de perte budgétée incluant stop, coûts et slippage d'entrée/sortie. Une quantité minimale trop grande est rejetée.

### 4 — Double comptage possible de la valeur du point

Les specs mélangeaient `pointValue` et `contractMultiplier` sans invariant. Selon le provider, `pointValue` peut déjà inclure le multiplicateur.

Correction : champ canonique `monetaryValuePerPriceUnit`, contrôlé par `tickValue / tickSize`. Le multiplicateur ne peut pas être appliqué deux fois.

### 5 — Marge et exposition incomplètes

La marge était optionnelle et aucune limite d'exposition brute n'était exigée. Un stop étroit pouvait autoriser un notionnel disproportionné.

Correction : marge et exposition obligatoires pour tout produit à levier. Toute `RiskPolicyVersion` futures fournit explicitement ces deux limites; aucune politique absente ne peut approuver un ordre futures. La baseline de recherche fixe toutes deux à `100%` du capital de sizing ; tout levier supérieur requiert une nouvelle politique versionnée.

### 6 — Backtest incompatible avec le petit capital

Les contraintes de quantité minimale, coûts et marge pouvaient être ignorées ou masquées.

Correction : comptabilité réelle sur `1 000 EUR`, aucune quantité fractionnaire inventée, chaque rejet d'exécution est persisté et le taux de faisabilité est une métrique obligatoire.

### 7 — Modèles domaine/base de données désalignés

Les exigences de market data demandaient timezone source et ingestion time, absents des modèles persistés. Les positions ne conservaient pas toutes les données nécessaires au risque initial.

Correction : ajout des timestamps/timezones, données de capital, devise de P&L, coûts, marge, exposition et contraintes décimales.

### 8 — Idempotence broker trop faible

La clé proposée pouvait entrer en collision entre comptes ou entre une entrée et une sortie. L'adapter pouvait aussi recevoir un identifiant de position interne à la place d'un identifiant broker.

Correction : `orderIntentId` immuable, clé scindée par compte/broker/type d'intention et requêtes broker explicites.

### 9 — Position non protégée après fill

La spec n'indiquait pas quoi faire si le stop protecteur ne pouvait pas être confirmé.

Correction : bracket/OCO lorsque disponible ; sinon accusé de réception immédiat, incident bloquant et politique de réduction/fermeture explicite.

### 10 — Ordre d'implémentation incohérent

La roadmap plaçait le Risk Engine après le Backtest Engine alors que le backtest devait déjà réutiliser le Risk Engine.

Correction : Risk Engine en phase 6, backtest en phase 7.

### 11 — Agrégation H4 incomplètement définie

Une H4 dérivée de H1 n'avait pas de règle d'`availableAt` ni de comportement explicite en cas de constituante manquante.

Correction : `availableAt` est le maximum des constituantes ; une H4 incomplète non justifiée par le calendrier reste inutilisable.

### 12 — Accumulation involontaire de positions

Des signaux successifs pouvaient créer plusieurs entrées sur le même instrument sans décision de pyramiding.

Correction : une position et une intention d'entrée active maximum par instrument ; pyramiding et hedge simultané interdits dans la baseline.

## Points déjà corrects et conservés

- Kumo actuel aligné sur les spans calculés à `t - displacement`
- H4 entièrement clôturé et disponible
- breakout excluant la bougie courante
- signal au close exécuté au prochain prix tradable
- causalité, versionnage, out-of-sample et stress des coûts
- distinction score descriptif / probabilité
- `AUTO` interdit en V1

## Bloquants restant ouverts

La spécification logique est plus sûre, mais un backtest réaliste reste bloqué tant que ne sont pas définis :

- instrument réellement exécuté pour chaque marché logique
- broker, source de données, sessions et règles de roll
- coûts et marges datés par instrument
- seuils de daily loss, drawdown et réserve de marge
- univers réellement négociable avec un budget de `5 EUR` par trade

Jusqu'à résolution et validation, le système reste `RESEARCH`/`SIGNAL`/`PAPER` uniquement.
