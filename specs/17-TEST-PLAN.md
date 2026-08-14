# Test Plan

## Indicators

- Tenkan exact
- Kijun exact
- Senkou A raw
- Senkou B raw
- projected cloud
- current cloud using `t - displacement`
- first valid index
- Chikou reference
- Kijun slope

## Critical Ichimoku Regression

Créer un dataset synthétique où :

```txt
senkou_raw[t] != senkou_raw[t-26]
```

Vérifier que `close[t] > currentCloudTop[t]` utilise bien les spans de `t-26`.

## Timeframe Alignment

- H1 inside unfinished H4
- H1 exactly at H4 close
- H4 available with latency
- DST
- holiday
- session break

## Breakout

- current candle excluded
- equal-to-high is not strict breakout
- long and short
- insufficient history

## Causality Test

Pour chaque décision à T :

1. calcul avec dataset tronqué à T
2. calcul avec dataset complet
3. comparer le résultat à T

Le résultat doit être identique.

Le test doit couvrir :

- indicators
- ATR percentile
- H4 alignment
- scoring
- exits

## Execution

Milestone 2B `BAR_BASED_H1_V1` :

- [x] un signal à la clôture ne peut pas être rempli à cette même clôture
- [x] prochain open H1 négociable sélectionné par un schedule versionné
- [x] pause de maintenance et intervalles UTC de forme DST
- [x] gap d'entrée puis revalidation complète du risque
- [x] fill complet, fill réduit ou annulation après revalidation
- [x] stop traversé à l'ouverture et stop touché intrabar
- [x] ambiguïté OHLC résolue par `STOP_FIRST`
- [x] sortie de tendance connue à la clôture et remplie au prochain prix
- [x] settlement officiel causal et variation margin
- [x] roll explicite : sortie de l'ancien contrat, nouveau stop et réentrée
  conditionnelle sur le nouveau contrat daté
- [x] rejet des symboles continus aux frontières exécutables
- [x] invariance à l'ajout de barres, snapshots et settlements futurs
- [x] coûts, slippage et P&L calculés en décimaux exacts
- [x] scénarios synthétiques FDXS EUR et MES USD→EUR

Hors Milestone 2B et requis avant tout paper trading :

- [ ] partial fills broker
- [ ] duplicate submit broker
- [ ] disconnect after submit → UNKNOWN + reconciliation

## Risk

Politique ADR-011 testée :

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

- equity réalisée `800`, P&L latent `0` → capital de sizing `800`
- equity réalisée `1 000`, gain latent `500` → capital de sizing `1 000`
- equity réalisée `1 000`, perte latente `200` → capital de sizing `800` immédiatement
- `riskPerTradePct = 0.5` sur `1 000 EUR` → budget total maximal `5 EUR`
- coûts fixes/variables et slippage inclus dans le budget de `5 EUR`
- quantité minimale au-dessus du budget → `REJECT`, jamais arrondi à la hausse
- valeur monétaire par unité de prix
- cohérence tick value / tick size sans double application du contract multiplier
- FX conversion
- quantity step
- min quantity
- arrondi du stop au tick dans la direction définie, puis nouveau calcul de risque
- stale quote
- insufficient margin
- risk group limit
- égalité exacte avec la limite du risk group admise
- clé `riskGroupMaxExposurePct[product.riskGroup]` absente → `INVALID_RISK_INPUT`
- requête au-dessus de `maxContractsPerPosition` → raison stable
  `MAX_CONTRACTS_PER_POSITION` en réduction ou rejet selon faisabilité
- marge/exposition obligatoire pour instrument à levier
- capital de sizing ne dépasse jamais le `maxSizingCapital` après arrondis
- contexte `accountCurrency != EUR` rejeté en 2A
- P&L MES en USD converti causalement vers le compte EUR avec le snapshot FX
  observable, sans conversion FX du plafond de capital
- factory 2A rejette `initialCapital` égal à `900`, `1000.01` ou mal formé, mais
  accepte une nouvelle politique à capital initial `1000` avec plafond positif
  inférieur à `1000`
- objet runtime forgé avec statut brouillon/non approuvé rejeté, ainsi qu'une
  politique sans approbateur ou avec `approvedAt > activatedAt`
- `approvedAt <= activatedAt <= riskPolicyUseAt` dans les deux modes
- `FORWARD` exige `riskPolicyUseAt = decisionAt`; tout écart est rejeté
- `FORWARD` exige `backtestId = null`; `HISTORICAL_RESEARCH` exige un
  `backtestId` non nul et `riskPolicyUseAt = runCreatedAt`, puis accepte des
  décisions de marché historiques antérieures à cet instant
- persistance historique : FK `risk_decisions.backtest_id` valide et
  `risk_policy_use_at = referenced backtests.created_at`; lien interdit en
  `FORWARD`
- politique activée après `riskPolicyUseAt` rejetée dans les deux modes
- toute dénormalisation de capital ou de risque différente de la
  `RiskPolicyVersion` résolue est rejetée
- chaque divergence des quatre assertions fixes 2A est testée séparément :
  `INVALID_CONFIG` au parsing, `INVALID_RISK_INPUT` à la frontière risque
- `research.researchEligibilityNote` reste une métadonnée non gouvernée et ne
  participe ni à l'égalité de politique ni aux assertions fixes

## Capital de backtest

- capital initial `1 000 EUR`
- aucune injection de cash
- gains latents exclus du sizing et pertes latentes appliquées immédiatement
- augmentation du plafond seulement par nouvelle `RiskPolicyVersion` manuellement approuvée
- aucun scaling a posteriori depuis un compte plus grand
- comptabilisation des signaux devenus non exécutables à cause des contraintes de petite taille

## Execution Safety

- deux signaux consécutifs sur le même instrument → une seule intention active
- position ouverte + signal de même sens/opposé → rejet baseline, aucun pyramiding/hedge
- aucune collision d'idempotency entre comptes, brokers, entrées, stops et sorties
- fill partiel qui atteint une limite → reliquat annulé
- échec d'accusé de réception du stop protecteur → incident et blocage des entrées

## Backtest Reproducibility

Dataset + config + code hash identiques :

- mêmes signals
- mêmes fills simulés
- mêmes trades
- mêmes métriques

## Gate

Paper trading interdit si les suites applicables :

- causality
- indicator
- alignment
- execution
- risk
- reproducibility

ne sont pas vertes.

La gate locale de Milestone 2B couvre en plus l'API publique compilée du package
`@trading-auto/execution`. La réussite de cette gate ne lève pas le statut
`RESEARCH_ONLY` et ne remplace pas les données broker datées.
