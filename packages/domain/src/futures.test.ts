import { Decimal } from 'decimal.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createFuturesContract,
  createFuturesProduct,
  DomainValidationError,
  type DecimalString,
  type FuturesContractInput,
  type FuturesProduct,
  type FuturesProductInput,
  type SettlementType,
} from './index.js';

const validProductInput: FuturesProductInput = {
  productCode: 'FDXS',
  exchange: 'XEUR',
  underlyingId: 'DAX',
  quoteCurrency: 'EUR',
  pnlCurrency: 'EUR',
  tickSize: '0.5',
  tickValue: '0.5',
  monetaryValuePerPriceUnit: '1',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'EUROPE_EQUITY_INDEX',
};

const validContractInput: FuturesContractInput = {
  contractId: 'FDXS-2026-09',
  productCode: 'FDXS',
  firstTradeAt: '2026-01-01T09:00:00+01:00',
  lastTradeAt: '2026-09-18T10:00:00+02:00',
  expiryAt: '2026-09-18T09:00:00Z',
  settlementType: 'CASH',
};

function expectDomainValidationError(
  action: () => unknown,
  code: string,
  details?: Readonly<Record<string, unknown>>,
): void {
  let received: unknown;

  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(DomainValidationError);
  expect(received).toMatchObject({
    code,
    ...(details === undefined ? {} : { details }),
  });
}

function validProduct(): Readonly<FuturesProduct> {
  return createFuturesProduct(validProductInput);
}

describe('createFuturesProduct', () => {
  it('creates the cash-settled product economic definition exactly', () => {
    const product = createFuturesProduct(validProductInput);

    expect(product).toEqual(validProductInput);
    expectTypeOf(product.tickSize).toEqualTypeOf<DecimalString>();
    expect(Object.isFrozen(product)).toBe(true);
  });

  it('does not mutate product input and freezes its output', () => {
    const input = { ...validProductInput };
    const product = createFuturesProduct(input);

    expect(input).toEqual(validProductInput);
    expect(() => {
      (product as { productCode: string }).productCode = 'OTHER';
    }).toThrow(TypeError);
  });

  it('constructs from a single snapshot of accessor-backed product input', () => {
    const reads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(validProductInput) as Array<
      keyof FuturesProductInput
    >) {
      const value = validProductInput[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(
      createFuturesProduct(input as unknown as FuturesProductInput),
    ).toEqual(validProductInput);
    expect(reads).toEqual(
      Object.fromEntries(
        Object.keys(validProductInput).map((field) => [field, 1]),
      ),
    );
  });

  it('converts a throwing product-input getter into a domain validation error', () => {
    const input = new Proxy(validProductInput, {
      get: () => {
        throw new Error('unexpected property access');
      },
    });

    expectDomainValidationError(
      () => createFuturesProduct(input),
      'INVALID_FUTURES_PRODUCT',
      { field: 'productCode' },
    );
  });

  it.each([null, [], 0, 'product', true, undefined])(
    'rejects a runtime non-object product input: %s',
    (input) => {
      expectDomainValidationError(
        () => createFuturesProduct(input as unknown as FuturesProductInput),
        'INVALID_FUTURES_PRODUCT',
        { field: 'input' },
      );
    },
  );

  it.each(['productCode', 'exchange', 'underlyingId', 'riskGroup'] as const)(
    'rejects a blank %s without normalizing it',
    (field) => {
      expectDomainValidationError(
        () => createFuturesProduct({ ...validProductInput, [field]: ' \t\n ' }),
        'INVALID_FUTURES_PRODUCT',
        { field, value: ' \t\n ' },
      );
    },
  );

  it('rejects a runtime non-string product property', () => {
    expectDomainValidationError(
      () =>
        createFuturesProduct({
          ...validProductInput,
          productCode: 42 as unknown as string,
        }),
      'INVALID_FUTURES_PRODUCT',
      { field: 'productCode', value: 42 },
    );
  });

  it.each(['quoteCurrency', 'pnlCurrency'] as const)(
    'rejects an invalid %s',
    (field) => {
      expectDomainValidationError(
        () => createFuturesProduct({ ...validProductInput, [field]: 'eur' }),
        'INVALID_CURRENCY',
        { value: 'eur' },
      );
    },
  );

  it.each([
    ['tickSize', '1e0'],
    ['tickValue', '1e0'],
    ['monetaryValuePerPriceUnit', '1e0'],
    ['tickSize', '0'],
    ['tickValue', '0'],
    ['monetaryValuePerPriceUnit', '0'],
    ['tickSize', '-1'],
    ['tickValue', '-1'],
    ['monetaryValuePerPriceUnit', '-1'],
  ] as const)(
    'rejects a noncanonical or non-positive %s: %s',
    (field, value) => {
      expectDomainValidationError(
        () => createFuturesProduct({ ...validProductInput, [field]: value }),
        'INVALID_FUTURES_PRODUCT',
        { field, value },
      );
    },
  );

  it.each([
    ['quantityStep', '0'],
    ['quantityStep', '0.5'],
    ['quantityStep', '-1'],
    ['quantityStep', '1e0'],
    ['minQuantity', '0'],
    ['minQuantity', '1.5'],
    ['minQuantity', '-1'],
    ['minQuantity', '1e0'],
  ] as const)('rejects a non-positive or fractional %s: %s', (field, value) => {
    expectDomainValidationError(
      () => createFuturesProduct({ ...validProductInput, [field]: value }),
      'INVALID_FUTURES_PRODUCT',
      { field, value },
    );
  });

  it('rejects a futures economic decimal over the 256-digit metadata bound', () => {
    const tooManyDigits = '1'.repeat(257);

    expectDomainValidationError(
      () =>
        createFuturesProduct({
          ...validProductInput,
          tickSize: tooManyDigits,
          tickValue: tooManyDigits,
        }),
      'INVALID_FUTURES_PRODUCT',
      { field: 'tickSize', value: tooManyDigits },
    );
  });

  it('rejects a futures economic decimal over the 128-digit fractional-scale bound', () => {
    const tooMuchScale = `0.${'0'.repeat(128)}1`;

    expectDomainValidationError(
      () =>
        createFuturesProduct({
          ...validProductInput,
          tickSize: tooMuchScale,
          tickValue: tooMuchScale,
        }),
      'INVALID_FUTURES_PRODUCT',
      { field: 'tickSize', value: tooMuchScale },
    );
  });

  it('accepts futures economic decimals at the documented metadata bounds', () => {
    const maximumDigits = '1'.repeat(256);
    const maximumScale = `0.${'0'.repeat(127)}1`;

    expect(
      createFuturesProduct({
        ...validProductInput,
        tickSize: maximumDigits,
        tickValue: maximumDigits,
      }),
    ).toMatchObject({ tickSize: maximumDigits, tickValue: maximumDigits });
    expect(
      createFuturesProduct({
        ...validProductInput,
        tickSize: maximumScale,
        tickValue: maximumScale,
      }),
    ).toMatchObject({ tickSize: maximumScale, tickValue: maximumScale });
  });

  it('requires minimum quantity to be divisible by quantity step', () => {
    expectDomainValidationError(
      () =>
        createFuturesProduct({
          ...validProductInput,
          quantityStep: '2',
          minQuantity: '3',
        }),
      'INVALID_FUTURES_PRODUCT',
      { quantityStep: '2', minQuantity: '3' },
    );
  });

  it('checks maximum-length quantity divisibility with exact integer arithmetic', () => {
    const quantityStep = '9'.repeat(256);

    expect(
      createFuturesProduct({
        ...validProductInput,
        quantityStep,
        minQuantity: quantityStep,
      }),
    ).toMatchObject({ quantityStep, minQuantity: quantityStep });
  });

  it('requires tick economics to be coherent', () => {
    expectDomainValidationError(
      () => createFuturesProduct({ ...validProductInput, tickValue: '1' }),
      'INVALID_FUTURES_PRODUCT',
      {
        tickSize: '0.5',
        tickValue: '1',
        monetaryValuePerPriceUnit: '1',
      },
    );
  });

  it('rejects tick economics that only match after Decimal division rounding', () => {
    expectDomainValidationError(
      () =>
        createFuturesProduct({
          ...validProductInput,
          tickSize: '3',
          tickValue: '1',
          monetaryValuePerPriceUnit: '0.33333333333333333333',
        }),
      'INVALID_FUTURES_PRODUCT',
      {
        tickSize: '3',
        tickValue: '1',
        monetaryValuePerPriceUnit: '0.33333333333333333333',
      },
    );
  });

  it('accepts exactly coherent tick economics with trailing fractional zeros', () => {
    expect(
      createFuturesProduct({
        ...validProductInput,
        tickSize: '0.50',
        tickValue: '1.000',
        monetaryValuePerPriceUnit: '2.0',
      }),
    ).toMatchObject({
      tickSize: '0.50',
      tickValue: '1.000',
      monetaryValuePerPriceUnit: '2.0',
    });
  });

  it('is isolated from ambient Decimal configuration', () => {
    const originalConfig = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      minE: Decimal.minE,
      maxE: Decimal.maxE,
      crypto: Decimal.crypto,
      modulo: Decimal.modulo,
    };

    try {
      Decimal.set({ maxE: 1, minE: -1, precision: 1 });

      const largeEconomics = {
        ...validProductInput,
        tickSize: '0.0000000001',
        tickValue: '1000000000',
        monetaryValuePerPriceUnit: '10000000000000000000',
      };

      expect(createFuturesProduct(largeEconomics)).toEqual(largeEconomics);
      expectDomainValidationError(
        () =>
          createFuturesProduct({
            ...largeEconomics,
            tickValue: '1000000001',
          }),
        'INVALID_FUTURES_PRODUCT',
      );
    } finally {
      Decimal.set(originalConfig);
    }
  });
});

describe('createFuturesContract', () => {
  it('creates a dated contract with canonical instants', () => {
    const contract = createFuturesContract(validContractInput, validProduct());

    expect(contract).toEqual({
      ...validContractInput,
      firstTradeAt: '2026-01-01T08:00:00Z',
      lastTradeAt: '2026-09-18T08:00:00Z',
      expiryAt: '2026-09-18T09:00:00Z',
    });
    expectTypeOf(contract.settlementType).toEqualTypeOf<SettlementType>();
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('does not mutate contract input and freezes its output', () => {
    const input = { ...validContractInput };
    const contract = createFuturesContract(input, validProduct());

    expect(input).toEqual(validContractInput);
    expect(() => {
      (contract as { contractId: string }).contractId = 'OTHER';
    }).toThrow(TypeError);
  });

  it('constructs from a single snapshot of accessor-backed contract input', () => {
    const reads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(validContractInput) as Array<
      keyof FuturesContractInput
    >) {
      const value = validContractInput[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(
      createFuturesContract(
        input as unknown as FuturesContractInput,
        validProduct(),
      ),
    ).toEqual({
      ...validContractInput,
      firstTradeAt: '2026-01-01T08:00:00Z',
      lastTradeAt: '2026-09-18T08:00:00Z',
      expiryAt: '2026-09-18T09:00:00Z',
    });
    expect(reads).toEqual(
      Object.fromEntries(
        Object.keys(validContractInput).map((field) => [field, 1]),
      ),
    );
  });

  it('reads the supplied product code only once at the contract boundary', () => {
    let productCodeReads = 0;
    const product = {
      get productCode() {
        productCodeReads += 1;
        return productCodeReads === 1 ? 'FDXS' : 'CHANGED';
      },
    } as unknown as FuturesProduct;

    expect(createFuturesContract(validContractInput, product).productCode).toBe(
      'FDXS',
    );
    expect(productCodeReads).toBe(1);
  });

  it('accepts physical settlement', () => {
    expect(
      createFuturesContract(
        { ...validContractInput, settlementType: 'PHYSICAL' },
        validProduct(),
      ).settlementType,
    ).toBe('PHYSICAL');
  });

  it.each([null, [], 0, 'contract', true, undefined])(
    'rejects a runtime non-object contract input: %s',
    (input) => {
      expectDomainValidationError(
        () =>
          createFuturesContract(
            input as unknown as FuturesContractInput,
            validProduct(),
          ),
        'INVALID_FUTURES_CONTRACT',
        { field: 'input' },
      );
    },
  );

  it.each([null, [], 0, 'product', true, undefined])(
    'rejects a runtime non-object product argument: %s',
    (product) => {
      expectDomainValidationError(
        () =>
          createFuturesContract(
            validContractInput,
            product as unknown as FuturesProduct,
          ),
        'INVALID_FUTURES_CONTRACT',
        { field: 'product' },
      );
    },
  );

  it.each(['contractId', 'productCode'] as const)(
    'rejects a blank %s without normalizing it',
    (field) => {
      expectDomainValidationError(
        () =>
          createFuturesContract(
            { ...validContractInput, [field]: ' \t\n ' },
            validProduct(),
          ),
        'INVALID_FUTURES_CONTRACT',
        { field, value: ' \t\n ' },
      );
    },
  );

  it('rejects a runtime non-string contract property', () => {
    expectDomainValidationError(
      () =>
        createFuturesContract(
          {
            ...validContractInput,
            firstTradeAt: 42 as unknown as string,
          },
          validProduct(),
        ),
      'INVALID_FUTURES_CONTRACT',
      { field: 'firstTradeAt', value: 42 },
    );
  });

  it.each(['firstTradeAt', 'lastTradeAt', 'expiryAt'] as const)(
    'rejects an invalid %s instant',
    (field) => {
      expectDomainValidationError(
        () =>
          createFuturesContract(
            { ...validContractInput, [field]: 'not-an-instant' },
            validProduct(),
          ),
        'INVALID_INSTANT',
        { value: 'not-an-instant' },
      );
    },
  );

  it.each([
    [
      'first trade equal to last trade',
      { lastTradeAt: validContractInput.firstTradeAt },
    ],
    ['first trade after last trade', { firstTradeAt: '2026-09-18T10:00:01Z' }],
  ] as const)(
    'requires firstTradeAt to precede lastTradeAt: %s',
    (_description, override) => {
      expectDomainValidationError(
        () =>
          createFuturesContract(
            { ...validContractInput, ...override },
            validProduct(),
          ),
        'INVALID_FUTURES_CONTRACT',
      );
    },
  );

  it('requires lastTradeAt not to exceed expiryAt', () => {
    expectDomainValidationError(
      () =>
        createFuturesContract(
          { ...validContractInput, lastTradeAt: '2026-09-18T09:00:01Z' },
          validProduct(),
        ),
      'INVALID_FUTURES_CONTRACT',
    );
  });

  it('requires the contract product code to equal the product code', () => {
    expectDomainValidationError(
      () =>
        createFuturesContract(
          { ...validContractInput, productCode: 'OTHER' },
          validProduct(),
        ),
      'INVALID_FUTURES_CONTRACT',
      { productCode: 'OTHER', expectedProductCode: 'FDXS' },
    );
  });

  it('rejects an unsupported settlement type through a runtime cast', () => {
    expectDomainValidationError(
      () =>
        createFuturesContract(
          {
            ...validContractInput,
            settlementType: 'DELIVERY' as unknown as SettlementType,
          },
          validProduct(),
        ),
      'INVALID_FUTURES_CONTRACT',
      { field: 'settlementType', value: 'DELIVERY' },
    );
  });
});
