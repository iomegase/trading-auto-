import {
  createFuturesContract,
  createFuturesProduct,
} from '@trading-auto/domain';

export const syntheticFdxsProduct = createFuturesProduct({
  productCode: 'FDXS',
  exchange: 'EUREX',
  underlyingId: 'DAX',
  quoteCurrency: 'EUR',
  pnlCurrency: 'EUR',
  tickSize: '0.5',
  tickValue: '0.5',
  monetaryValuePerPriceUnit: '1',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'EU_EQUITY_INDEX',
});

export const syntheticFdxsContract = createFuturesContract(
  {
    contractId: 'FDXSH26',
    productCode: 'FDXS',
    firstTradeAt: '2025-12-19T00:00:00Z',
    lastTradeAt: '2026-03-20T12:00:00Z',
    expiryAt: '2026-03-20T13:00:00Z',
    settlementType: 'CASH',
  },
  syntheticFdxsProduct,
);

export const syntheticMesProduct = createFuturesProduct({
  productCode: 'MES',
  exchange: 'CME',
  underlyingId: 'SP500',
  quoteCurrency: 'USD',
  pnlCurrency: 'USD',
  tickSize: '0.25',
  tickValue: '1.25',
  monetaryValuePerPriceUnit: '5',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'US_EQUITY_INDEX',
});

export const syntheticMesContract = createFuturesContract(
  {
    contractId: 'MESH26',
    productCode: 'MES',
    firstTradeAt: '2025-12-19T00:00:00Z',
    lastTradeAt: '2026-03-20T13:30:00Z',
    expiryAt: '2026-03-20T14:00:00Z',
    settlementType: 'CASH',
  },
  syntheticMesProduct,
);
