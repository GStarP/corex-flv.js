import MSEController from '../core/mse-controller';
import Transmuxer from '../core/transmuxer';
import EventEmitterBase from '../DIY/event-emitter';

class FlvPlayer extends EventEmitterBase {
  private _mediaDataSource: MediaDataSource;
  private _mediaElement: HTMLVideoElement | null = null;
  private _msectl: MSEController | null = null;
  private _transmuxer: Transmuxer | null = null;

  constructor(mediaDataSource: MediaDataSource) {
    super();
    this._mediaDataSource = mediaDataSource;
  }

  // attach <video>
  attachMediaElement(mediaElement: HTMLVideoElement) {
    this._mediaElement = mediaElement;

    this._msectl = new MSEController();
    this._msectl.attachMediaElement(mediaElement);
  }

  // fetch flv stream and load video
  load() {
    if (!this._mediaElement) {
      throw new Error('HTMLMediaElement must be attached before load()!');
    }

    this._transmuxer = new Transmuxer(this._mediaDataSource);
    this._transmuxer.open();
  }
}

export default FlvPlayer;
