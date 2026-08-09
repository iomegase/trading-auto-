import {
  createCandle,
  type Candle,
  type CandleInput,
} from '@trading-auto/domain';

const defaultCandleInput: CandleInput = {
  instrumentId: 'TEST',
  timeframe: '1h',
  sourceTimestamp: '2026-01-01 08:00:00 Europe/Paris',
  sourceTimezone: 'Europe/Paris',
  exchangeTimezone: 'Europe/Paris',
  openTime: '2026-01-01T07:00:00Z',
  closeTime: '2026-01-01T08:00:00Z',
  availableAt: '2026-01-01T08:00:00Z',
  ingestedAt: '2026-01-01T08:00:00Z',
  open: '100',
  high: '102',
  low: '99',
  close: '101',
  isClosed: true,
  provider: 'synthetic',
};

export function buildCandle(
  overrides: Partial<CandleInput> = {},
): Readonly<Candle> {
  const { volume, ...otherOverrides } = overrides;

  return createCandle(
    volume === undefined
      ? { ...defaultCandleInput, ...otherOverrides }
      : { ...defaultCandleInput, ...otherOverrides, volume },
  );
}
