# Milestone 2B — Bar-Based Futures Execution

Status: RESEARCH_ONLY

Cette milestone ajoute un simulateur pur d'exécution futures sur barres H1. Il
consomme les décisions de stratégie, les contrats datés, les policies et
snapshots du moteur de risque, ainsi que des schedules versionnés. Il ne place
aucun ordre, ne contacte aucun broker et ne constitue pas une preuve de qualité
d'exécution réelle.

## Contrats livrés

- `@trading-auto/execution` expose un modèle immuable
  `BAR_BASED_H1_V1` : signal à la clôture, entrée au prochain open négociable,
  fill complet ou rejet, et politique intrabar conservatrice `STOP_FIRST`.
  Chaque résultat d'exécution conserve les limites `NO_INTRABAR_PATH`,
  `NO_PARTIAL_FILLS` et `NO_ORDER_BOOK`.
- Les événements H1 distinguent l'instant économique `occurredAt` de l'instant
  causal `availableAt`. Une ouverture n'est jamais utilisée avant sa
  disponibilité, même si son prix de marché appartient à un instant antérieur.
  Une barre fermée H1 couvre exactement une heure.
- Les schedules immuables décrivent les intervalles tradables, les pauses de
  maintenance et les fenêtres de contrats en UTC. Le simulateur n'infère aucun
  jour férié ni règle DST depuis le calendrier civil.
- Une intention conserve la disponibilité de la décision du signal, ne peut
  être exécutée avant elle, attend le prochain open H1 négociable et revalide
  alors l'intégralité du risque avec le prix et les snapshots causaux de cet
  open. Le résultat est `ENTRY_FILLED`, `ENTRY_REDUCED_AND_FILLED` ou
  `ENTRY_CANCELLED`.
- Une position conserve un stop protecteur fixe. Un gap au-delà du stop utilise
  le prix disponible défavorable ; un stop touché intrabar précède toute sortie
  de tendance connue seulement à la clôture. L'intention de sortie est ensuite
  validée et remplie au premier open H1 ultérieur que le schedule versionné
  déclare négociable, avec slippage adverse.
- Les settlements quotidiens officiels appliquent la variation margin,
  actualisent le cash et la base comptable, mais préservent le prix d'entrée
  économique destiné aux métriques du trade. La position conserve le dernier
  instant de settlement appliqué et refuse tout replay ou settlement antérieur.
- Le rollover ferme explicitement le contrat expirant, comptabilise son P&L,
  ses coûts et son slippage, construit un nouveau stop versionné, puis relance
  le moteur de risque avant toute réentrée sur le contrat daté suivant. Le
  contrat cible doit déjà être actif à l'instant économique du roll.

## Causalité et disponibilité

Le prix d'un open peut être horodaté à `occurredAt`, mais le contrôle de risque
est évalué à son `availableAt`. Le mode `FORWARD` utilise donc cet instant de
disponibilité comme `decisionAt` et `riskPolicyUseAt`. Le mode
`HISTORICAL_RESEARCH` conserve le `runCreatedAt` et le `backtestId` validés de la
policy historique.

Les sélecteurs routent d'abord par identité, intervalle et disponibilité avant
de lire les champs économiques. Ajouter après coup des opens, snapshots de
risque, settlements ou barres H1 futurs ne modifie aucun résultat déjà obtenu à
un instant `T`.

## Stops et sorties

Le stop d'entrée est le Kijun exact, aligné au tick, fourni par la décision de
stratégie. Il n'est ni déplacé par une valeur Ichimoku future, ni converti en
break-even, ni suivi par un trailing stop. Pour une position ouverte, l'ordre
conservateur est :

1. gap d'ouverture à travers le stop ;
2. stop fixe touché intrabar ;
3. publication de la clôture H1 ;
4. éventuelle sortie de tendance au prochain prix négociable.

Un conflit dans le chemin OHLC reste résolu par `STOP_FIRST`. La baseline ne
contient aucun take-profit fixe.

## Settlements et rollovers

Un settlement est sélectionné uniquement s'il concerne le contrat, est observé
et valide au moment demandé, et provient de la série versionnée attendue. Une
donnée obligatoire absente n'est jamais remplacée par une clôture H1.

Un roll ne renomme jamais une position existante. L'ancien contrat est fermé,
puis le nouveau contrat suit un nouveau cycle indépendant de stop et de risque.
Si la réentrée est refusée ou réduite à zéro, le portefeuille reste à plat. Les
symboles continus sont refusés à toutes les frontières exécutables.

## Fixtures synthétiques FDXS et MES

Les scénarios d'acceptation couvrent FDXS en EUR et MES avec P&L USD converti
causalement vers un compte EUR. Ils exercent le prochain open, une pause de
maintenance, les gaps de stop, les coûts, le slippage, la conversion FX, le
settlement et les limites de risque. La conversion FX est vérifiée lors de la
revalidation du risque ; les settlements et la variation margin sont vérifiés
par des scénarios dédiés.

Ces produits, horaires, prix, coûts, marges et taux FX sont des fixtures de
recherche. Ils ne prouvent ni la négociabilité chez un broker, ni une marge
réelle, ni une liquidité disponible.

## Décimaux exacts et frontières publiques

Prix, quantités, coûts, P&L, cash et bases de settlement restent des chaînes
décimales canoniques. Les calculs utilisent un clone privé et borné de
`decimal.js` ; modifier la configuration globale ne change pas les résultats.
Les entrées runtime forgées, getters hostiles, proxies révoqués, séries creuses,
objets hérités et valeurs hors bornes sont rejetés par des erreurs typées.

L'API publique compilée expose uniquement `ExecutionInputError`, son type de
code public `ExecutionInputErrorCode`, ainsi que les factories et transitions
stables du modèle, des événements H1, schedules, entrées, positions,
settlements et rollovers. `ExecutionInputErrorCode` est un export TypeScript
sans valeur runtime. Les helpers décimaux internes et builders de tests restent
privés.

## Critères et commandes de validation

La gate locale de la milestone est :

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test:coverage
pnpm audit --prod
git diff --check
```

La suite `@trading-auto/execution` doit couvrir 100 % des statements, branches,
fonctions et lignes du code de production du package. Les résultats locaux de
formatage, ESLint, typage TypeScript strict, tests Vitest, compilation,
couverture et inspection de la frontière publique doivent réussir. L'audit
réseau `pnpm audit --prod` ne doit signaler aucune vulnérabilité connue dans les
dépendances de production au moment de la vérification.

## Différé à 2C

Milestone 2C doit encore fournir l'horloge séquentielle de portefeuille,
l'orchestration complète stratégie/risque/exécution, le cycle de vie d'un run,
la propagation globale des données invalides, les statistiques, la persistance
des runs, décisions et trades, ainsi que leur restitution reproductible.

Le resampling automatique H1→H4 reste également différé : les deux datasets
causaux sont fournis séparément.

## Non exécutable sans données broker datées

Milestone 2B reste `RESEARCH_ONLY`. Le modèle ne possède aucune donnée minute,
tick, carnet d'ordres, profondeur, latence réseau ou fill partiel. Il ne gère ni
soumission idempotente chez un broker, ni accusé de réception, ni état
`UNKNOWN`, ni réconciliation.

Le paper trading, la connexion broker, l'interface et toute activation live
restent interdits. Un résultat bar-based est une hypothèse de recherche
conservatrice, pas une promesse de fill, de performance ou de risque maximal.
