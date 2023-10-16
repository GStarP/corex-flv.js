import FetchStreamLoader from './fetch-stream-loader';

class IOController {
  private _dataSource: MediaSegment;
  private _loaderClass = FetchStreamLoader;
  private _loader: FetchStreamLoader | null = null;
  private _enableStash = true;
  private _bufferSize = 1024 * 1024 * 3; // initial buffer size: 3MB (_stashBuffer's length)
  private _stashSize = 1024 * 384; // initial stash size: 384KB (data length for consuming)
  private _stashBuffer = new ArrayBuffer(this._bufferSize);
  private _stashUsed = 0; // how many unconsumed data is in _stashBuffer
  private _stashByteStart = 0; // where unconsumed data start in total data

  onDataArrival: ((chunk: ArrayBuffer, byteStart: number) => number) | null =
    null;
  onError: ((errorType: string, errorInfo: LoaderErrorMessage) => void) | null =
    null;
  onComplete: (() => void) | null = null;

  constructor(dataSource: MediaSegment) {
    this._dataSource = dataSource;

    this._selectLoader();
    this._createLoader();
  }

  /**
   * select loader class according to config and env support
   * @IGNORE now we only support FetchStreamLoader
   */
  private _selectLoader() {
    if (FetchStreamLoader.isSupported()) {
      this._loaderClass = FetchStreamLoader;
    } else {
      throw new Error('[corex] only support FetchStreamLoader');
    }
  }

  private _createLoader() {
    this._loader = new this._loaderClass();
    // for FetchStreamLoader, needStashBuffer is true
    if (this._loader.needStashBuffer === false) {
      this._enableStash = false;
    }
    // @IGNORE onContentLengthKnown
    this._loader.onDataArrival = (chunk, byteStart) => {
      // IOController.onDataArrival must be set
      if (!this.onDataArrival) {
        throw new Error(
          'IOController: No existing consumer (onDataArrival) callback!'
        );
      }

      // @IGNORE SpeedSampler

      if (!this._enableStash) {
        throw new Error('[corex] _enableStash = false not supported');
      } else {
        // This is the first chunk after seek action
        if (this._stashUsed === 0 && this._stashByteStart === 0) {
          this._stashByteStart = byteStart;
        }
        // if prev + new data is very short, just stash
        if (this._stashUsed + chunk.byteLength <= this._stashSize) {
          let stashArray = new Uint8Array(
            this._stashBuffer,
            0,
            this._stashSize
          );
          stashArray.set(new Uint8Array(chunk), this._stashUsed);
          this._stashUsed += chunk.byteLength;
        }
        // if prev + new data is enough for consuming, consume once
        else {
          // existing data
          let stashArray = new Uint8Array(
            this._stashBuffer,
            0,
            this._bufferSize
          );
          // if has prev data, consume prev data
          if (this._stashUsed > 0) {
            let buffer = this._stashBuffer.slice(0, this._stashUsed);
            let consumed = this._dispatchChunks(buffer, this._stashByteStart);
            // if prev data still remains after consuming
            if (consumed < buffer.byteLength) {
              if (consumed > 0) {
                // store unconsumed data
                let remainArray = new Uint8Array(buffer, consumed);
                stashArray.set(remainArray, 0);
                this._stashUsed = remainArray.byteLength;
                this._stashByteStart += consumed;
              }
            }
            // all prev data are consumed, _stashBuffer is clear
            else {
              this._stashUsed = 0;
              this._stashByteStart += consumed;
            }
            // we will concat unconsumed data and new data
            // so if _bufferSize is not enough, we must expand it
            if (this._stashUsed + chunk.byteLength > this._bufferSize) {
              this._expandBuffer(this._stashUsed + chunk.byteLength);
              // copy unconsumed data
              stashArray = new Uint8Array(
                this._stashBuffer,
                0,
                this._bufferSize
              );
            }
            // append new data
            stashArray.set(new Uint8Array(chunk), this._stashUsed);
            this._stashUsed += chunk.byteLength;
          }
          // if no prev data, consume new data
          else {
            let consumed = this._dispatchChunks(chunk, byteStart);
            // if remains some data, stash them
            if (consumed < chunk.byteLength) {
              let remain = chunk.byteLength - consumed;
              // if remain data still exceed _bufferSize, expand it
              if (remain > this._bufferSize) {
                this._expandBuffer(remain);
                stashArray = new Uint8Array(
                  this._stashBuffer,
                  0,
                  this._bufferSize
                );
              }
              stashArray.set(new Uint8Array(chunk, consumed), 0);
              this._stashUsed += remain;
              this._stashByteStart = byteStart + consumed;
            }
          }
        }
      }
    };
    this._loader.onComplete = (from, to) => {
      this._flushStashBuffer(true);
      if (this.onComplete) {
        this.onComplete();
      }
    };
    this._loader.onError = (type, data) => {
      console.error(`Loader error, code = ${data.code}, msg = ${data.msg}`);

      this._flushStashBuffer(false);

      // @IGNORE specific handling of different types of error

      if (this.onError) {
        this.onError(type, data);
      } else {
        throw new Error('IOException: ' + data.msg);
      }
    };
  }

  private _expandBuffer(expectedBytes: number) {
    // bufferSize will be set to (stashSize * 2^x + 1MB)
    let bufferNewSize = this._stashSize;
    while (bufferNewSize + 1024 * 1024 * 1 < expectedBytes) {
      bufferNewSize *= 2;
    }
    bufferNewSize += 1024 * 1024 * 1;
    // if buffer size not change, no need to continue
    if (bufferNewSize === this._bufferSize) {
      return;
    }
    // malloc new ArrayBuffer
    let newBuffer = new ArrayBuffer(bufferNewSize);

    // copy unconsumed data to a new buffer
    if (this._stashUsed > 0) {
      let stashOldArray = new Uint8Array(this._stashBuffer, 0, this._stashUsed);
      let stashNewArray = new Uint8Array(newBuffer, 0, bufferNewSize);
      stashNewArray.set(stashOldArray, 0);
    }
    // if we didn't copy stashOldArray above, when _stashBuffer set to newBuffer
    // the previous _stashBuffer will be gc, then stashOldArray will be lost
    this._stashBuffer = newBuffer;
    this._bufferSize = bufferNewSize;
  }

  private _dispatchChunks(chunks: ArrayBuffer, byteStart: number) {
    return this.onDataArrival!(chunks, byteStart);
  }

  private _flushStashBuffer(dropUnconsumed: boolean) {
    // flush means immediately try to consume once
    if (this._stashUsed > 0) {
      let buffer = this._stashBuffer.slice(0, this._stashUsed);
      let consumed = this._dispatchChunks(buffer, this._stashByteStart);
      let remain = buffer.byteLength - consumed;

      // has remaining data
      if (consumed < buffer.byteLength) {
        // if dropUnconsumed, remaining data will not be copy to _stashBuffer
        if (dropUnconsumed) {
          console.warn(
            `${remain} bytes unconsumed data remain when flush buffer, dropped`
          );
        } else {
          if (consumed > 0) {
            let stashArray = new Uint8Array(
              this._stashBuffer,
              0,
              this._bufferSize
            );
            let remainArray = new Uint8Array(buffer, consumed);
            stashArray.set(remainArray, 0);
            this._stashUsed = remainArray.byteLength;
            this._stashByteStart += consumed;
          }
          return 0;
        }
      }
      this._stashUsed = 0;
      this._stashByteStart = 0;
      return remain;
    }
    return 0;
  }

  open() {
    this._loader?.open(this._dataSource);
  }
}

export default IOController;
