import { describe, expect, expectTypeOf, it } from 'vitest';
import { type DecimalString, type InstantString } from '@trading-auto/domain';

import {
  createH1ClosedBarEvent,
  createH1OpenEvent,
  ExecutionInputError,
  type H1ClosedBarEventInput,
  type H1OpenEventInput,
} from './index.js';

const validOpen: H1OpenEventInput = {
  instrumentId: 'FDXS',
  contractId: 'FDXSH26',
  openTime: '2026-01-02T10:00:00+01:00',
  availableAt: '2026-01-02T09:00:00Z',
  price: '100.5',
};

const validClosed: H1ClosedBarEventInput = {
  instrumentId: 'FDXS',
  contractId: 'FDXSH26',
  openTime: '2026-01-02T10:00:00+01:00',
  closeTime: '2026-01-02T11:00:00+01:00',
  availableAt: '2026-01-02T10:00:00Z',
  open: '100.5',
  high: '102',
  low: '99.5',
  close: '101',
};

function expectInvalid(action: () => unknown, field: string): void {
  let received: unknown;

  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(ExecutionInputError);
  expect(received).toMatchObject({
    code: 'INVALID_EXECUTION_INPUT',
    details: { field },
  });
}

describe('H1 execution market-data events', () => {
  it('creates a canonical immutable open event without future OHLC fields', () => {
    const event = createH1OpenEvent(validOpen);

    expect(event).toEqual({
      ...validOpen,
      openTime: '2026-01-02T09:00:00Z',
      availableAt: '2026-01-02T09:00:00Z',
    });
    expect('high' in event).toBe(false);
    expect('low' in event).toBe(false);
    expect('close' in event).toBe(false);
    expect(Object.isFrozen(event)).toBe(true);
    expectTypeOf(event.openTime).toEqualTypeOf<InstantString>();
    expectTypeOf(event.price).toEqualTypeOf<DecimalString>();
  });

  it('creates a canonical immutable closed OHLC event', () => {
    const event = createH1ClosedBarEvent(validClosed);

    expect(event).toEqual({
      ...validClosed,
      openTime: '2026-01-02T09:00:00Z',
      closeTime: '2026-01-02T10:00:00Z',
      availableAt: '2026-01-02T10:00:00Z',
    });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('requires an open event to be observable no earlier than its open', () => {
    expectInvalid(
      () =>
        createH1OpenEvent({
          ...validOpen,
          availableAt: '2026-01-02T08:59:59.999999999Z',
        }),
      'availableAt',
    );
  });

  it('requires a closed event to be observable no earlier than its close', () => {
    expectInvalid(
      () =>
        createH1ClosedBarEvent({
          ...validClosed,
          availableAt: '2026-01-02T09:59:59.999999999Z',
        }),
      'availableAt',
    );
  });

  it('requires a positive-duration H1 bar', () => {
    expectInvalid(
      () =>
        createH1ClosedBarEvent({
          ...validClosed,
          closeTime: validClosed.openTime,
        }),
      'closeTime',
    );
  });

  it.each([
    ['high', '100'],
    ['low', '101'],
  ] as const)('rejects an invalid %s envelope', (field, value) => {
    expectInvalid(
      () => createH1ClosedBarEvent({ ...validClosed, [field]: value }),
      field,
    );
  });

  it.each([
    ['price', '1e2'],
    ['price', '0'],
    ['price', '-1'],
    ['price', '1'.repeat(257)],
  ] as const)('rejects invalid open %s %s', (field, value) => {
    expectInvalid(
      () => createH1OpenEvent({ ...validOpen, [field]: value }),
      field,
    );
  });

  it.each(['instrumentId', 'contractId'] as const)(
    'rejects a blank %s',
    (field) => {
      expectInvalid(
        () => createH1OpenEvent({ ...validOpen, [field]: ' \t ' }),
        field,
      );
    },
  );

  it('rejects a continuous symbol for open and closed events', () => {
    expectInvalid(
      () =>
        createH1OpenEvent({
          ...validOpen,
          contractId: validOpen.instrumentId,
        }),
      'contractId',
    );
    expectInvalid(
      () =>
        createH1ClosedBarEvent({
          ...validClosed,
          contractId: validClosed.instrumentId,
        }),
      'contractId',
    );
  });

  it('snapshots every open-event accessor exactly once', () => {
    const reads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(validOpen) as Array<
      keyof H1OpenEventInput
    >) {
      const value = validOpen[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(createH1OpenEvent(input as unknown as H1OpenEventInput)).toEqual({
      ...validOpen,
      openTime: '2026-01-02T09:00:00Z',
      availableAt: '2026-01-02T09:00:00Z',
    });
    expect(reads).toEqual(
      Object.fromEntries(Object.keys(validOpen).map((field) => [field, 1])),
    );
  });

  it('converts a revoked Proxy into a stable input error', () => {
    const revoked = Proxy.revocable(validOpen, {});
    revoked.revoke();

    expectInvalid(() => createH1OpenEvent(revoked.proxy), 'input');
  });

  it('rejects primitive, array, custom-prototype, and invalid-instant inputs', () => {
    for (const value of [null, [], new Date(0)]) {
      expectInvalid(
        () => createH1OpenEvent(value as unknown as H1OpenEventInput),
        'input',
      );
    }
    expectInvalid(
      () => createH1OpenEvent({ ...validOpen, openTime: 'not-an-instant' }),
      'openTime',
    );
    expectInvalid(
      () =>
        createH1OpenEvent({
          ...validOpen,
          openTime: 1 as unknown as string,
        }),
      'openTime',
    );
  });

  it('maps hostile field descriptors and accessors to typed errors', () => {
    const descriptorTrap = new Proxy(validOpen, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectInvalid(() => createH1OpenEvent(descriptorTrap), 'instrumentId');

    for (const descriptor of [
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('getter trap');
        },
      },
      { enumerable: false, value: validOpen.instrumentId },
    ]) {
      const input = { ...validOpen } as Record<string, unknown>;
      Object.defineProperty(input, 'instrumentId', descriptor);
      expectInvalid(
        () => createH1OpenEvent(input as unknown as H1OpenEventInput),
        'instrumentId',
      );
    }
  });
});
