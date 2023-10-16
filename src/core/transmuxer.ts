import EventEmitterBase from '../DIY/event-emitter';
import TransmuxingController from './transmuxing-controller';

class Transmuxer extends EventEmitterBase {
  private _controller: TransmuxingController | null = null;

  constructor(mediaDataSource: MediaDataSource) {
    super();
    this._controller = new TransmuxingController(mediaDataSource);
  }

  open() {
    this._controller?.start();
  }
}

export default Transmuxer;
