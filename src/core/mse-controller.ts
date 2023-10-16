import EventEmitterBase from '../DIY/event-emitter';
import MSEEvents from './mse-events';

/**
 * 负责管理 MSE 相关逻辑
 */
class MSEController extends EventEmitterBase {
  private _mediaSource: MediaSource | null = null;
  private _mediaSourceObjectURL: string | null = null;
  private _mediaElement: HTMLVideoElement | null = null;

  constructor() {
    super();
  }

  attachMediaElement(mediaElement: HTMLVideoElement) {
    let ms = (this._mediaSource = new window.MediaSource());
    // 设置回调
    const _onSourceOpen = () => {
      console.debug('MediaSource onSourceOpen');
      this._mediaSource?.removeEventListener('sourceopen', _onSourceOpen);
      this._emitter.emit(MSEEvents.SOURCE_OPEN);
    };
    ms.addEventListener('sourceopen', _onSourceOpen);
    const _onSourceEnded = () => {
      console.debug('MediaSource onSourceEnded');
    };
    ms.addEventListener('sourceended', _onSourceEnded);
    const _onSourceClose = () => {
      console.debug('MediaSource onSourceClose');
      if (this._mediaSource) {
        this._mediaSource.removeEventListener('sourceopen', _onSourceOpen);
        this._mediaSource.removeEventListener('sourceended', _onSourceEnded);
        this._mediaSource.removeEventListener('sourceclose', _onSourceClose);
      }
    };
    ms.addEventListener('sourceclose', _onSourceClose);

    this._mediaElement = mediaElement;
    this._mediaSourceObjectURL = window.URL.createObjectURL(this._mediaSource);
    mediaElement.src = this._mediaSourceObjectURL;
  }
}

export default MSEController;
