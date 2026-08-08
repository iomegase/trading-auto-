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
