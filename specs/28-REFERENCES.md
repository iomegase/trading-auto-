# Technical References

Ces références servent à vérifier les conventions techniques. Elles ne constituent pas une validation de la rentabilité de la stratégie.

## Ichimoku

QuantConnect / LEAN — Ichimoku Kinko Hyo documentation.

Point vérifié :
les Senkou utilisées à la position courante correspondent à des valeurs issues d'un nombre de périodes antérieur, ce qui impose de distinguer valeur calculée maintenant et valeur du Kumo visible maintenant.

https://www.quantconnect.com/docs/v2/writing-algorithms/indicators/supported-indicators/ichimoku-kinko-hyo

## Interactive Brokers — Historical Bars

Point vérifié :
les timestamps de barres historiques peuvent dépendre du timezone choisi dans TWS ; la normalisation UTC doit donc être explicite.

https://www.interactivebrokers.com/docs/tws-api/doc/market-data-historical/historical-bars/receiving-historical-bars

## Interactive Brokers — Paper Trading

Points vérifiés :

- environnement simulé
- fills simulés depuis le top of book
- absence de profondeur de carnet pour les fills
- certains stops/ordres complexes sont simulés différemment du live

https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/

## Règle du projet

Une référence technique externe peut confirmer une convention d'API ou d'indicateur.

Elle ne doit jamais être utilisée pour conclure qu'une règle de trading possède un edge. Seules nos validations causales, out-of-sample et forward peuvent étayer cette conclusion.

## CME Group — Micro E-mini S&P 500

Point vérifié : un même point d'indice n'a pas la même valeur économique selon le contrat. Le Micro E-mini S&P 500 vaut `5 USD × index` avec un tick de `0.25`, soit `1.25 USD` par tick. Ces valeurs illustrent pourquoi `tickValue`, `tickSize` et multiplicateur ne doivent pas être comptés deux fois.

https://www.cmegroup.com/markets/equities/sp/micro-e-mini-sandp-500.contractSpecs.html

## Interactive Brokers — Futures Margin

Point vérifié : les exigences de marge futures sont fondées sur le risque, exprimées dans la devise du produit et peuvent changer. Elles doivent être obtenues/versionnées et ne peuvent pas être codées comme constantes permanentes.

https://investors.interactivebrokers.com/en/trading/margin-futures-fops.php

## ESMA — Protections CFD retail

Points vérifiés : les mesures européennes comprennent limites de levier, clôture sur marge et protection contre solde négatif au niveau du compte. Ces protections broker/réglementaires ne remplacent pas le Risk Engine et doivent être vérifiées pour le broker et le statut de client réels.

https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors

## AMF — Restrictions CFD en France

Point vérifié : l'AMF a pérennisé en France les restrictions applicables aux CFD pour les investisseurs non professionnels, notamment les limites de levier et la protection contre solde négatif. L'éligibilité exacte dépend toujours du produit, du broker et du statut réel du client.

https://www.amf-france.org/fr/actualites-publications/communiques/communiques-de-lamf/options-binaires-et-cfd-lamf-adopte-des-mesures-dintervention-lechelle-nationale
