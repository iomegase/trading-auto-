export type DomainValidationErrorCode =
  | 'INVALID_DECIMAL'
  | 'INVALID_CURRENCY'
  | 'INVALID_INSTANT'
  | 'INVALID_TIMEFRAME'
  | 'INVALID_CANDLE'
  | 'HIGH_BELOW_LOW'
  | 'INVALID_FUTURES_PRODUCT'
  | 'INVALID_FUTURES_CONTRACT';

export class DomainValidationError extends Error {
  override readonly name = 'DomainValidationError';
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: DomainValidationErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    if (details !== undefined) {
      this.details = Object.freeze({ ...details });
    }
  }
}
