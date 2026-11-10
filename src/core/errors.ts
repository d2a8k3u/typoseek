/** @public */
export type ErrorCode =
  | 'INVALID_OPTION'
  | 'INVALID_RECORD'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_ID'
  | 'QUERY_TOO_LONG'
  | 'TOO_MANY_TERMS'
  | 'INVALID_TOKEN_SPAN'
  | 'INVALID_PIPELINE_OUTPUT'
  | 'INDEX_BUSY'
  | 'ABORTED'
  | 'INVALID_SERIALIZED_INDEX'
  | 'UNSUPPORTED_VERSION'
  | 'SERIALIZED_INDEX_TOO_LARGE'
  | 'SEGMENTER_UNAVAILABLE';

const KNOWN_ERROR_CODES: Readonly<Record<ErrorCode, true>> = {
  INVALID_OPTION: true,
  INVALID_RECORD: true,
  INVALID_ID: true,
  DUPLICATE_ID: true,
  UNKNOWN_ID: true,
  QUERY_TOO_LONG: true,
  TOO_MANY_TERMS: true,
  INVALID_TOKEN_SPAN: true,
  INVALID_PIPELINE_OUTPUT: true,
  INDEX_BUSY: true,
  ABORTED: true,
  INVALID_SERIALIZED_INDEX: true,
  UNSUPPORTED_VERSION: true,
  SERIALIZED_INDEX_TOO_LARGE: true,
  SEGMENTER_UNAVAILABLE: true,
};

/** @public */
export class TyposeekError extends Error {
  override readonly name = 'TyposeekError';
  readonly code: ErrorCode;
  readonly recordIndex: number | undefined;

  constructor(code: ErrorCode, message: string, details?: { readonly recordIndex?: number; readonly cause?: unknown }) {
    super(message, details);
    this.code = code;
    this.recordIndex = details?.recordIndex;
  }
}

/** @public */
export function isTyposeekError(value: unknown): value is TyposeekError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    value.name === 'TyposeekError' &&
    'code' in value &&
    typeof value.code === 'string' &&
    Object.hasOwn(KNOWN_ERROR_CODES, value.code)
  );
}

const INVARIANT_VIOLATION_PREFIX = 'typoseek invariant violated: ';

export function invariantViolation(detail: string): Error {
  return new Error(`${INVARIANT_VIOLATION_PREFIX}${detail}`);
}
