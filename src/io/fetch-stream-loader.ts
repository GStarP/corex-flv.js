import BaseLoader, { LoaderErrors, LoaderStatus } from './loader';

/**
 * use `fetch` to get `.flv` url,
 * use ReadableStream API to get `ArrayBuffer` data,
 * use callbacks to collaborate with other components
 */
class FetchStreamLoader extends BaseLoader {
  private _contentLength: number | null = null;
  private _receivedLength = 0;

  static isSupported() {
    try {
      // @IGNORE only check fetch&ReadableStream support
      // @ts-ignore
      return window.fetch && window.ReadableStream;
    } catch (e) {
      return false;
    }
  }

  constructor() {
    super();
    this._needStash = true;
  }

  destroy() {
    super.destroy();
  }

  open(dataSource: MediaSegment) {
    let sourceURL = dataSource.url;

    // @IGNORE we don't need so much headers
    let headers = new window.Headers();
    let params: RequestInit = {
      method: 'GET',
      headers: headers,
      mode: 'cors',
      cache: 'default',
      referrerPolicy: 'no-referrer-when-downgrade',
    };

    this._status = LoaderStatus.kConnecting;
    // @IGNORE we haven't include SeekHandler, so just use url in MediaSegment
    window
      .fetch(sourceURL, params)
      .then((res) => {
        // @IGNORE abort
        // response 2XX
        if (res.ok && res.status >= 200 && res.status <= 299) {
          // @IGNORE redirect
          let lengthHeader = res.headers.get('Content-Length');
          if (lengthHeader != null) {
            this._contentLength = parseInt(lengthHeader);
            if (this._contentLength !== 0) {
              if (this.onContentLengthKnown) {
                this.onContentLengthKnown(this._contentLength);
              }
            }
          }
          // @ASK res.body can be undefined
          // error handling process
          if (!res.body) {
            this._status = LoaderStatus.kError;
            if (this.onError) {
              this.onError(LoaderErrors.EXCEPTION, {
                code: res.status,
                msg: res.statusText,
              });
            } else {
              throw new Error(
                'FetchStreamLoader: Http code invalid, ' +
                  res.status +
                  ' ' +
                  res.statusText
              );
            }
          } else {
            return this._pump(res.body.getReader());
          }
        }
        // response 3XX/4XX/5XX
        else {
          this._status = LoaderStatus.kError;
          if (this.onError) {
            this.onError(LoaderErrors.HTTP_STATUS_CODE_INVALID, {
              code: res.status,
              msg: res.statusText,
            });
          } else {
            throw new Error(
              'FetchStreamLoader: Http code invalid, ' +
                res.status +
                ' ' +
                res.statusText
            );
          }
        }
      })
      .catch((e) => {
        this._status = LoaderStatus.kError;
        if (this.onError) {
          this.onError(LoaderErrors.EXCEPTION, { code: -1, msg: e.message });
        } else {
          throw e;
        }
      });
  }

  private _pump(reader: ReadableStreamDefaultReader<Uint8Array>) {
    return reader
      .read()
      .then((result) => {
        if (result.done) {
          // if not receive enough data but done, report error
          if (
            this._contentLength !== null &&
            this._receivedLength < this._contentLength
          ) {
            this._status = LoaderStatus.kError;
            let type = LoaderErrors.EARLY_EOF;
            let info = { code: -1, msg: 'Fetch stream meet Early-EOF' };
            if (this.onError) {
              this.onError(type, info);
            } else {
              throw new Error(info.msg);
            }
          } else {
            // regular done
            this._status = LoaderStatus.kComplete;
            if (this.onComplete) {
              // without range, from is always 0
              this.onComplete(0, this._receivedLength - 1);
            }
          }
        } else {
          this._status = LoaderStatus.kBuffering;

          let chunk = result.value.buffer;
          // without range, from is always 0
          let byteStart = 0 + this._receivedLength;
          this._receivedLength += chunk.byteLength;

          if (this.onDataArrival) {
            this.onDataArrival(chunk, byteStart, this._receivedLength);
          }
          // recursively call _pump
          this._pump(reader);
        }
      })
      .catch((e) => {
        this._status = LoaderStatus.kError;
        if (this.onError) {
          this.onError(LoaderErrors.EXCEPTION, {
            code: e.code,
            msg: e.message,
          });
        } else {
          throw e;
        }
      });
  }
}

export default FetchStreamLoader;
