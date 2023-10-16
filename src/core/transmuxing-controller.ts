import EventEmitterBase from '../DIY/event-emitter';
import DemuxErrors from '../demux/demux-errors';
import IOController from '../io/io-controller';
import TransmuxingEvents from './transmuxing-events';
import FLVDemuxer from '../demux/flv-demuxer';

class TransmuxingController extends EventEmitterBase {
  private _mediaDataSource: MediaDataSource;
  private _ioctl: IOController | null = null;
  private _demuxer: FLVDemuxer | null = null;

  constructor(mediaDataSource: MediaDataSource) {
    super();

    // designed for segments support
    // @IGNORE now we always hold just 1 segment
    if (!mediaDataSource.segments) {
      mediaDataSource.segments = [
        {
          url: mediaDataSource.url,
        },
      ];
    }

    this._mediaDataSource = mediaDataSource;
  }

  start() {
    this._loadSegment(0);
  }

  _loadSegment(segmentIndex: number) {
    let dataSource = this._mediaDataSource.segments![segmentIndex];

    let ioctl = (this._ioctl = new IOController(dataSource));

    ioctl.onError = (type, info) => {
      console.error(
        `IOException: type = ${type}, code = ${info.code}, msg = ${info.msg}`
      );
      this._emitter.emit(TransmuxingEvents.IO_ERROR, type, info);
    };

    ioctl.onComplete = () => {
      // @IGNORE remember we only have 1 segment
      this._emitter.emit(TransmuxingEvents.LOADING_COMPLETE);
    };

    ioctl.onDataArrival = (data, byteStart) => {
      let probeData = null;
      let consumed = 0;
      // @IGNORE now we don't actually parse media data
      // but parse metadata and skip media data length (represented as `consumed`)
      if (byteStart > 0) {
        // IOController seeked immediately after opened, byteStart > 0 callback may received
        consumed = this._demuxer!.parseChunks(data, byteStart);
      } else if ((probeData = FLVDemuxer.probe(data)).match) {
        console.debug('[corex] probeData:', probeData);
        // Always create new FLVDemuxer
        this._demuxer = new FLVDemuxer(probeData);
        // @IGNORE as we don't actually parse media data, no remuxer needed
        consumed = this._demuxer.parseChunks(data, byteStart);
      }
      // parsed header is not match flv format
      else {
        probeData = null;
        console.error('Non-FLV, Unsupported media type!');
        this._emitter.emit(
          TransmuxingEvents.DEMUX_ERROR,
          DemuxErrors.FORMAT_UNSUPPORTED,
          'Non-FLV, Unsupported media type'
        );

        consumed = 0;
      }

      return consumed;
    };

    ioctl.open();
  }
}

export default TransmuxingController;
