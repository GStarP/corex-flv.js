export const LoaderStatus = {
  kIdle: 0,
  kConnecting: 1,
  kBuffering: 2,
  kError: 3,
  kComplete: 4,
};

export const LoaderErrors = {
  OK: 'OK',
  EXCEPTION: 'Exception',
  HTTP_STATUS_CODE_INVALID: 'HttpStatusCodeInvalid',
  CONNECTING_TIMEOUT: 'ConnectingTimeout',
  EARLY_EOF: 'EarlyEof',
  UNRECOVERABLE_EARLY_EOF: 'UnrecoverableEarlyEof',
};

export class BaseLoader {
  protected _status: (typeof LoaderStatus)[keyof typeof LoaderStatus];
  protected _needStash = false;

  onError:
    | ((
        errorType: (typeof LoaderErrors)[keyof typeof LoaderErrors],
        errorInfo: LoaderErrorMessage
      ) => void)
    | null = null;
  // @ASK why onContentLengthKnown lies here but _contentLength not ?
  onContentLengthKnown: ((contentLength: number) => void) | null = null;
  onDataArrival:
    | ((chunk: ArrayBuffer, byteStart: number, receivedLength?: number) => void)
    | null = null;
  onComplete: ((rangeFrom: number, rangeTo: number) => void) | null = null;

  constructor() {
    this._status = LoaderStatus.kIdle;
  }

  destroy() {
    this._status = LoaderStatus.kIdle;
    this.onContentLengthKnown = null;
    this.onDataArrival = null;
    this.onError = null;
    this.onComplete = null;
  }

  get needStashBuffer() {
    return this._needStash;
  }
}

export default BaseLoader;
