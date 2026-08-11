import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createRiskAccountState,
  createRiskPortfolioState,
  RiskInputError,
  type ActiveEntryIntent,
  type RiskAccountState,
  type RiskPortfolioState,
  type RiskPosition,
} from '@trading-auto/risk';

const accountInput = {
  accountCurrency: 'EUR',
  realizedEquity: '1000',
  unrealizedPnl: '-100',
  availableFunds: '700',
  usedMargin: '200',
  grossExposure: '500',
  openRisk: '10',
  dailyLoss: '5',
  drawdownPct: '1',
  killSwitchActive: false,
} as const;

const position = {
  positionId: 'POSITION_1',
  instrumentId: 'FDXS',
  contractId: 'FDXS-202609',
  direction: 'LONG',
  quantity: '2',
  remainingOpenRisk: '10',
  margin: '200',
  grossExposure: '500',
  riskGroup: 'EUROPE_EQUITY_INDEX',
} as const;

const intent = {
  intentId: 'INTENT_1',
  instrumentId: 'MES',
  contractId: 'MES-202609',
  direction: 'SHORT',
} as const;

function invalid(run: () => unknown, field?: string): RiskInputError {
  let received: unknown;
  try {
    run();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(RiskInputError);
  expect(received).toMatchObject({ code: 'INVALID_RISK_INPUT' });
  if (field !== undefined) {
    expect((received as RiskInputError).details).toMatchObject({ field });
  }
  return received as RiskInputError;
}

function withInheritedProperties(
  properties: Readonly<Record<string, unknown>>,
  run: () => void,
): void {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [key, value] of Object.entries(properties)) {
      previous.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        value,
      });
    }
    run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, key);
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe('createRiskAccountState', () => {
  it('creates a frozen exact EUR account satisfying the accounting invariant', () => {
    const account = createRiskAccountState(accountInput);
    expect(account).toEqual(accountInput);
    expectTypeOf(account).toEqualTypeOf<RiskAccountState>();
    expect(Object.isFrozen(account)).toBe(true);
  });

  it('accepts signed realized equity, unrealized PnL, and available funds', () => {
    expect(
      createRiskAccountState({
        ...accountInput,
        realizedEquity: '-100',
        unrealizedPnl: '50',
        availableFunds: '-250',
        usedMargin: '200',
      }),
    ).toMatchObject({
      realizedEquity: '-100',
      unrealizedPnl: '50',
      availableFunds: '-250',
    });
  });

  it.each([
    ['accountCurrency', 'USD'],
    ['usedMargin', '-0'],
    ['grossExposure', '-1'],
    ['openRisk', '-0'],
    ['dailyLoss', '-1'],
    ['realizedEquity', '1e3'],
    ['realizedEquity', 1000],
    ['killSwitchActive', 'false'],
  ])('rejects invalid %s=%s', (field, value) => {
    invalid(
      () => createRiskAccountState({ ...accountInput, [field]: value }),
      field,
    );
  });

  it('rejects contradictory accounting totals exactly', () => {
    invalid(
      () =>
        createRiskAccountState({
          ...accountInput,
          availableFunds: '700.0000000000000000001',
        }),
      'availableFunds',
    );
  });

  it.each([null, [], 'account'])('rejects runtime nonobjects', (value) => {
    invalid(() => createRiskAccountState(value as never), 'input');
  });

  it('rejects non-plain and hostile account objects but accepts null-prototype records', () => {
    class ForgedAccount {
      readonly forged = true;
    }
    Object.assign(ForgedAccount.prototype, accountInput);
    invalid(
      () => createRiskAccountState(new ForgedAccount() as never),
      'input',
    );
    invalid(
      () =>
        createRiskAccountState(
          new Proxy(
            { ...accountInput },
            {
              getPrototypeOf() {
                throw new Error('boom');
              },
            },
          ),
        ),
      'input',
    );
    expect(
      createRiskAccountState(
        Object.assign(Object.create(null) as object, accountInput) as never,
      ),
    ).toEqual(accountInput);
  });

  it('reads each account property once and maps throwing accessors', () => {
    const reads = new Map<string, number>();
    const input = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(accountInput)) {
      Object.defineProperty(input, key, {
        enumerable: true,
        configurable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    expect(createRiskAccountState(input as never)).toEqual(accountInput);
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
    Object.defineProperty(input, 'accountCurrency', {
      get() {
        throw new Error('boom');
      },
    });
    invalid(() => createRiskAccountState(input as never), 'accountCurrency');
  });

  it('rejects inherited required account fields', () => {
    const input = { ...accountInput } as Record<string, unknown>;
    Reflect.deleteProperty(input, 'accountCurrency');
    withInheritedProperties({ accountCurrency: 'EUR' }, () => {
      invalid(() => createRiskAccountState(input as never), 'accountCurrency');
    });
  });

  it('maps unreadable required ownership checks to RiskInputError', () => {
    const input = new Proxy(
      { ...accountInput },
      {
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
      },
    );
    invalid(() => createRiskAccountState(input), 'accountCurrency');
  });
});

describe('createRiskPortfolioState', () => {
  it('validates and deeply freezes positions and active intents', () => {
    const portfolio = createRiskPortfolioState({
      positions: [position],
      activeEntryIntents: [intent],
    });
    expect(portfolio).toEqual({
      positions: [position],
      activeEntryIntents: [intent],
    });
    expectTypeOf(portfolio).toEqualTypeOf<RiskPortfolioState>();
    const firstPosition = portfolio.positions[0];
    const firstIntent = portfolio.activeEntryIntents[0];
    expect(firstPosition).toBeDefined();
    expect(firstIntent).toBeDefined();
    if (firstPosition === undefined || firstIntent === undefined) {
      throw new Error('Expected validated portfolio items.');
    }
    expectTypeOf(firstPosition).toEqualTypeOf<Readonly<RiskPosition>>();
    expectTypeOf(firstIntent).toEqualTypeOf<Readonly<ActiveEntryIntent>>();
    expect(Object.isFrozen(portfolio)).toBe(true);
    expect(Object.isFrozen(portfolio.positions)).toBe(true);
    expect(Object.isFrozen(portfolio.positions[0])).toBe(true);
    expect(Object.isFrozen(portfolio.activeEntryIntents)).toBe(true);
    expect(Object.isFrozen(portfolio.activeEntryIntents[0])).toBe(true);
  });

  it.each(['positionId', 'instrumentId', 'contractId', 'riskGroup'] as const)(
    'rejects blank position %s',
    (field) => {
      invalid(
        () =>
          createRiskPortfolioState({
            positions: [{ ...position, [field]: ' ' }],
            activeEntryIntents: [],
          }),
        `positions[0].${field}`,
      );
    },
  );

  it.each(['intentId', 'instrumentId', 'contractId'] as const)(
    'rejects blank intent %s',
    (field) => {
      invalid(
        () =>
          createRiskPortfolioState({
            positions: [],
            activeEntryIntents: [{ ...intent, [field]: ' ' }],
          }),
        `activeEntryIntents[0].${field}`,
      );
    },
  );

  it.each([
    ['direction', 'FLAT'],
    ['quantity', '0'],
    ['quantity', '1.5'],
    ['remainingOpenRisk', '-0'],
    ['margin', '-1'],
    ['grossExposure', '1e2'],
  ])('rejects invalid position %s=%s', (field, value) => {
    invalid(
      () =>
        createRiskPortfolioState({
          positions: [{ ...position, [field]: value }],
          activeEntryIntents: [],
        }),
      `positions[0].${field}`,
    );
  });

  it('rejects an invalid intent direction', () => {
    invalid(
      () =>
        createRiskPortfolioState({
          positions: [],
          activeEntryIntents: [{ ...intent, direction: 'FLAT' }],
        }),
      'activeEntryIntents[0].direction',
    );
  });

  it('rejects sparse arrays before reading elements', () => {
    const positions = new Array(1);
    invalid(
      () =>
        createRiskPortfolioState({
          positions,
          activeEntryIntents: [],
        }),
      'positions',
    );
  });

  it('rejects nonarrays and proxy-controlled array metadata safely', () => {
    invalid(
      () =>
        createRiskPortfolioState({
          positions: {} as never,
          activeEntryIntents: [],
        }),
      'positions',
    );
    const badLength = new Proxy([], {
      get(target, propertyName, receiver) {
        if (propertyName === 'length') return -1;
        return Reflect.get(target, propertyName, receiver) as unknown;
      },
    });
    invalid(
      () =>
        createRiskPortfolioState({
          positions: badLength,
          activeEntryIntents: [],
        }),
      'positions',
    );
    const badDensity = new Proxy([position], {
      getOwnPropertyDescriptor() {
        throw new Error('boom');
      },
    });
    invalid(
      () =>
        createRiskPortfolioState({
          positions: badDensity,
          activeEntryIntents: [],
        }),
      'positions',
    );
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    invalid(
      () =>
        createRiskPortfolioState({ positions: proxy, activeEntryIntents: [] }),
      'positions',
    );
  });

  it('rejects bounded-decimal overflow before Decimal arithmetic', () => {
    invalid(
      () =>
        createRiskPortfolioState({
          positions: [{ ...position, quantity: '1'.repeat(257) }],
          activeEntryIntents: [],
        }),
      'positions[0].quantity',
    );
  });

  it('bounds collections before iteration', () => {
    const positions = Array.from({ length: 1001 }, (_, index) => ({
      ...position,
      positionId: `P${String(index)}`,
      instrumentId: `I${String(index)}`,
    }));
    invalid(
      () => createRiskPortfolioState({ positions, activeEntryIntents: [] }),
      'positions',
    );
  });

  it.each([
    [
      [{ ...position }, { ...position, instrumentId: 'OTHER' }],
      [],
      'positions[1].positionId',
    ],
    [
      [{ ...position }, { ...position, positionId: 'P2' }],
      [],
      'positions[1].instrumentId',
    ],
    [
      [],
      [{ ...intent }, { ...intent, instrumentId: 'OTHER' }],
      'activeEntryIntents[1].intentId',
    ],
    [
      [],
      [{ ...intent }, { ...intent, intentId: 'I2' }],
      'activeEntryIntents[1].instrumentId',
    ],
    [
      [{ ...position }],
      [{ ...intent, instrumentId: position.instrumentId }],
      'activeEntryIntents[0].instrumentId',
    ],
  ] as const)(
    'rejects duplicate/conflicting portfolio membership',
    (positions, activeEntryIntents, field) => {
      invalid(
        () => createRiskPortfolioState({ positions, activeEntryIntents }),
        field,
      );
    },
  );

  it('snapshots nested getters once and handles throwing getters', () => {
    let reads = 0;
    const observed = {
      get positionId() {
        reads += 1;
        return position.positionId;
      },
      instrumentId: position.instrumentId,
      contractId: position.contractId,
      direction: position.direction,
      quantity: position.quantity,
      remainingOpenRisk: position.remainingOpenRisk,
      margin: position.margin,
      grossExposure: position.grossExposure,
      riskGroup: position.riskGroup,
    };
    createRiskPortfolioState({ positions: [observed], activeEntryIntents: [] });
    expect(reads).toBe(1);

    Object.defineProperty(observed, 'positionId', {
      get() {
        throw new Error('boom');
      },
    });
    invalid(
      () =>
        createRiskPortfolioState({
          positions: [observed],
          activeEntryIntents: [],
        }),
      'positions[0].positionId',
    );
  });

  it('rejects inherited portfolio arrays and nested required fields', () => {
    withInheritedProperties({ positions: [], activeEntryIntents: [] }, () => {
      invalid(() => createRiskPortfolioState({} as never), 'positions');
    });

    const inheritedPositionId = { ...position } as Record<string, unknown>;
    Reflect.deleteProperty(inheritedPositionId, 'positionId');
    withInheritedProperties({ positionId: position.positionId }, () => {
      invalid(
        () =>
          createRiskPortfolioState({
            positions: [inheritedPositionId as never],
            activeEntryIntents: [],
          }),
        'positions[0].positionId',
      );
    });
  });
});
