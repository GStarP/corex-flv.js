/**
 * compose 4 8-bit to 1 32-bit
 */
function ReadBig32(array: Uint8Array, index: number) {
  return (
    (array[index] << 24) |
    (array[index + 1] << 16) |
    (array[index + 2] << 8) |
    array[index + 3]
  );
}

class FLVDemuxer {
  private _firstParse: boolean;
  private _dataOffset: number;
  private _littleEndian: boolean;

  constructor(probeData: FlvProbeData) {
    this._dataOffset = probeData.dataOffset;
    this._firstParse = true;

    // LE is defined by platform, so test it
    let buf = new ArrayBuffer(2);
    // `true` specifies LE
    new DataView(buf).setInt16(0, 256, true);
    // if also read as 256, then platform is LE
    this._littleEndian = new Int16Array(buf)[0] === 256;
  }

  /**
   * parse flv chunk header
   * @REF https://www.jianshu.com/p/7ffaec7b3be6
   */
  static probe(buffer: ArrayBuffer): FlvProbeData {
    let data = new Uint8Array(buffer);
    let mismatch: FlvProbeData = {
      match: false,
      consumed: -1,
      dataOffset: -1,
      hasAudioTrack: false,
      hasVideoTrack: false,
    };

    // Signature (3 bytes): FLV
    // Version (1 bytes): 1
    if (
      data[0] !== 0x46 ||
      data[1] !== 0x4c ||
      data[2] !== 0x56 ||
      data[3] !== 0x01
    ) {
      return mismatch;
    }

    // Flags (1 bytes)
    // 1~5: reserved
    // 6:   has audio
    // 7:   reserved
    // 8:   has video
    let hasAudio = (data[4] & 4) >>> 2 !== 0;
    let hasVideo = (data[4] & 1) !== 0;

    // Header Size (4 bytes): always be 9 in version 1
    let offset = ReadBig32(data, 5);
    if (offset < 9) {
      return mismatch;
    }

    return {
      match: true,
      consumed: offset,
      dataOffset: offset,
      hasAudioTrack: hasAudio,
      hasVideoTrack: hasVideo,
    };
  }

  parseChunks(chunk: ArrayBuffer, byteStart: number): number {
    let offset = 0;
    let le = this._littleEndian;

    if (byteStart === 0) {
      if (chunk.byteLength > 13) {
        // @ASK duplicate probe? we have already called probe in `transmuxing-controller.ts`
        let probeData = FLVDemuxer.probe(chunk);
        offset = probeData.dataOffset!;
      } else {
        // chunk size is not enough even for just header
        return 0;
      }
    }

    // handle PreviousTagSize0 before Tag1
    if (this._firstParse) {
      this._firstParse = false;
      // position check
      if (byteStart + offset !== this._dataOffset) {
        console.warn('First time parsing but chunk byteStart invalid!');
      }
      let v = new DataView(chunk, offset);
      // PreviousTagSize take 4 bytes in BE
      let prevTagSize0 = v.getUint32(0, !le);
      // PreviousTagSize0 is always 0
      if (prevTagSize0 !== 0) {
        console.warn('PrevTagSize0 !== 0 !!!');
      }
      offset += 4;
    }

    while (offset < chunk.byteLength) {
      let v = new DataView(chunk, offset);
      // a tag is min 15 bytes, so if data is not enough then break
      if (offset + 11 + 4 > chunk.byteLength) {
        // chunk is not enough for parsing an flv tag
        break;
      }

      // Tag Type (1 byte): 8-Audio, 9-Video, 18-Scripts
      let tagType = v.getUint8(0);

      // Tag Data Size (3 bytes)
      // @LEARN cannot read 3 bytes as a int directly
      // so we bit-and it with 0x00ffffff
      let dataSize = v.getUint32(0, !le) & 0x00ffffff;
      // chunk is not enough for parsing such length of data
      if (offset + 11 + dataSize + 4 > chunk.byteLength) {
        // data not enough for parsing actual data body
        break;
      }
      // check tag type
      if (tagType !== 8 && tagType !== 9 && tagType !== 18) {
        console.warn(`Unsupported tag type ${tagType}, skipped`);
        // consume the whole tag (skip it)
        offset += 11 + dataSize + 4;
        continue;
      }

      // Timestamp (3 bytes)
      // Timestamp Extended (1 byte)
      // @TODO 2103 => 3210
      let ts2 = v.getUint8(4);
      let ts1 = v.getUint8(5);
      let ts0 = v.getUint8(6);
      let ts3 = v.getUint8(7);
      let timestamp = ts0 | (ts1 << 8) | (ts2 << 16) | (ts3 << 24);

      // Stream ID (3 bytes): always 0
      let streamId = v.getUint32(7, !le) & 0x00ffffff;
      if (streamId !== 0) {
        console.warn('Meet tag which has StreamID != 0!');
      }

      // @IGNORE now we don't actually parse data
      // just skip these bytes!
      offset += 11 + dataSize + 4;

      console.debug('[corex] consume one tag: ', timestamp);
    }

    return offset;
  }
}

export default FLVDemuxer;
