import DemuxErrors from './demux-errors';
import SPSParser from './sps-parser';

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
  /**
   * Const
   */
  private _timestampBase = 0;
  private _timescale = 1000;
  private _duration = 0;
  private _flvSoundRateTable = [5500, 11025, 22050, 44100, 48000];
  private _mpegSamplingRates = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
    8000, 7350,
  ];
  /**
   * Variable
   */
  private _firstParse: boolean;
  private _dataOffset: number;
  private _littleEndian: boolean;
  private _naluLengthSize: number;

  private _audioMetadata: AudioMetadata = {
    type: 'audio',
    timescale: this._timescale,
    duration: this._duration,
    audioSampleRate: 0,
    channelCount: 0,
    codec: '',
    refSampleDuration: 0,
  };
  private _videoMetadata: VideoMetadata = {
    type: 'video',
    timescale: this._timescale,
    duration: this._duration,
    codecWidth: 0,
    codecHeight: 0,
    presentWidth: 0,
    presentHeight: 0,
    profile: '',
    level: '',
    bitDepth: 0,
    chromaFormat: 0,
    sarRatio: {
      width: 0,
      height: 0,
    },
    frameRate: {
      fixed: true,
      fps: 23.976,
      fps_num: 23976,
      fps_den: 1000,
    },
    refSampleDuration: 0,
    codec: '',
  };

  private _audioTrack: AudioTrack = {
    type: 'audio',
    id: 2,
    sequenceNumber: 0,
    samples: [],
    length: 0,
  };
  private _videoTrack: VideoTrack = {
    type: 'video',
    id: 1,
    sequenceNumber: 0,
    samples: [],
    length: 0,
  };

  onError: (
    errorType: (typeof DemuxErrors)[keyof typeof DemuxErrors],
    errorInfo: string
  ) => void = (t, i) => console.error('[corex] FlvDemuxer.onError', t, i);

  onTrackMetadata: <T extends TrackType>(type: T, meta: MetaData[T]) => void = (
    t,
    m
  ) => console.debug('[corex] FlvDemuxer.onTrackMetadata', t, m);

  constructor(probeData: FlvProbeData) {
    this._dataOffset = probeData.dataOffset;
    this._firstParse = true;
    this._naluLengthSize = 4;

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
      // min tag size (11 bytes) + PreviousTagSize(4 bytes)
      // so if data is not enough then break
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
      // @TODO 2103 => 3210 not understand
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

      // parse tag data
      // 8:  audio
      // 9:  video
      // 18: script
      let dataOffset = offset + 11;
      switch (tagType) {
        case 8:
          this._parseAudioData(chunk, dataOffset, dataSize, timestamp);
          break;
        case 9:
          this._parseVideoData(
            chunk,
            dataOffset,
            dataSize,
            timestamp,
            byteStart + offset
          );
          break;
        case 18:
          break;
      }

      // every tag checks PreviousTagSize after it
      let prevTagSize = v.getUint32(11 + dataSize, !le);
      if (prevTagSize !== 11 + dataSize) {
        console.warn(`Invalid PrevTagSize ${prevTagSize}`);
      }

      // tagBody + dataSize + prevTagSize
      offset += 11 + dataSize + 4;
    }

    return offset;
  }

  /**
   * parse audio data
   * @REF https://rtmp.veriskope.com/pdf/video_file_format_spec_v10.pdf
   */
  private _parseAudioData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number
  ) {
    // not enough data
    if (dataSize <= 1) {
      console.warn('Flv: Invalid audio packet, missing SoundData payload!');
      return;
    }

    // @IGNORE override hasAudio to ignore audio packets

    let v = new DataView(arrayBuffer, dataOffset, dataSize);

    // we can only extract min 8 bits as a variable
    let soundMetadata = v.getUint8(0);

    // Sound Format (4 bits)
    // 10: AAC
    let soundFormat = soundMetadata >>> 4;
    if (soundFormat !== 10) {
      this.onError(
        DemuxErrors.CODEC_UNSUPPORTED,
        'Flv: Unsupported audio codec idx: ' + soundFormat
      );
      return;
    }
    // Sound Rate (2 bits)
    // 0: 5.5-kHz
    // 1: 11-kHz
    // 2: 22-kHz
    // 3: 44-kHz (AAC)
    let soundRate = 0;
    // 10101111 & 1100 -> 1100 >>> 2 -> 11 (3)
    let soundRateIndex = (soundMetadata & 12) >>> 2;
    // @ASK soundRateIndex can be 4 ???
    if (soundRateIndex >= 0 && soundRateIndex < 4) {
      soundRate = this._flvSoundRateTable[soundRateIndex];
    } else {
      if (this.onError) {
        this.onError(
          DemuxErrors.FORMAT_ERROR,
          'Flv: Invalid audio sample rate idx: ' + soundRateIndex
        );
        return;
      }
    }
    // Sound Size (1 bit)
    // 0: 8 bits
    // 1: 16 bits
    let soundSize = (soundMetadata & 2) >>> 1;
    // Sound Type (1 bit)
    // 0: mono
    // 1: stereo (AAC)
    let soundType = soundMetadata & 1;

    let meta = this._audioMetadata;
    let track = this._audioTrack;

    // @IGNORE override hasAudio
    meta.type = 'audio';
    meta.timescale = this._timescale;
    meta.duration = this._duration;
    meta.audioSampleRate = soundRate;
    meta.channelCount = soundType === 0 ? 1 : 2;

    // AAC
    if (soundFormat === 10) {
      // skip previous 1 byte metadata
      let aacData = this._parseAACAudioData(
        arrayBuffer,
        dataOffset + 1,
        dataSize - 1
      );
      if (aacData == undefined) {
        return;
      }
      // config data
      if (aacData.packetType === 0) {
        let misc = aacData.data as AACAudioSpecificConfig;
        meta.audioSampleRate = misc.samplingRate;
        meta.channelCount = misc.channelCount;
        meta.codec = misc.codec;
        // 1024 sample -> 1 timescale
        meta.refSampleDuration = (1024 / meta.audioSampleRate) * meta.timescale;
        console.debug('Parsed AudioSpecificConfig');

        // @TODO _isInitialMetadataDispatched

        this.onTrackMetadata('audio', meta);

        // @IGNORE media info
      }
      // frame data
      else if (aacData.packetType === 1) {
        // frame data -> sample
        let dts = this._timestampBase + tagTimestamp;
        const data = aacData.data as Uint8Array;
        let aacSample: AudioSample = {
          unit: data,
          length: data.byteLength,
          dts: dts,
          pts: dts,
        };
        // append sample
        track.samples.push(aacSample);
        track.length += data.length;

        // console.debug('[corex] parsed audio sample', aacSample);
      } else {
        console.error(`Flv: Unsupported AAC data type ${aacData.packetType}`);
      }
    }
    // @IGNORE now we only support AAC
  }

  private _parseAACAudioData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number
  ): AACAudioData | undefined {
    // not enough data
    if (dataSize <= 1) {
      console.warn(
        'Flv: Invalid AAC packet, missing AACPacketType or/and Data!'
      );
      return;
    }

    let result: AACAudioData = { packetType: 0 };
    let array = new Uint8Array(arrayBuffer, dataOffset, dataSize);

    // 0: config data
    // 1: frame data
    result.packetType = array[0];

    if (result.packetType === 0) {
      result.data = this._parseAACAudioSpecificConfig(
        arrayBuffer,
        dataOffset + 1,
        dataSize - 1
      );
    } else {
      result.data = array.subarray(1);
    }

    return result;
  }

  private _parseAACAudioSpecificConfig(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number
  ): AACAudioSpecificConfig | undefined {
    let array = new Uint8Array(arrayBuffer, dataOffset, dataSize);

    let audioObjectType = 0;
    let samplingIndex = 0;

    // Audio Object Type (5 bits)
    // 0: Null
    // 1: AAC Main
    // 2: AAC LC
    // 3: AAC SSR (Scalable Sample Rate)
    // 4: AAC LTP (Long Term Prediction)
    // 5: HE-AAC / SBR (Spectral Band Replication)
    // 6: AAC Scalable
    audioObjectType = array[0] >>> 3;

    // Sampling Frequency Index (4 bits)
    // & 0x07: only reserve the last 3 bits (because other 5 bits already used)
    // << 1:   remain 1 bit for the missing 1 bit
    // >>> 7:  only use the first bit
    samplingIndex = ((array[0] & 0x07) << 1) | (array[1] >>> 7);
    if (samplingIndex < 0 || samplingIndex >= this._mpegSamplingRates.length) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        'Flv: AAC invalid sampling frequency index!'
      );
      return;
    }
    let samplingFrequency = this._mpegSamplingRates[samplingIndex];

    // Channel Config (4 bits)
    let channelConfig = (array[1] & 0x78) >>> 3;
    if (channelConfig < 0 || channelConfig >= 8) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        'Flv: AAC invalid channel configuration'
      );
      return;
    }

    // if HE-AAC
    if (audioObjectType !== 5) {
      console.warn('[corex] audioObjectType !== 5', audioObjectType);
    }

    // @TODO extension config

    return {
      samplingRate: samplingFrequency,
      channelCount: channelConfig,
      codec: 'mp4a.40.' + audioObjectType,
    };
  }

  /**
   * parse video data
   * @REF https://rtmp.veriskope.com/pdf/video_file_format_spec_v10.pdf
   */
  private _parseVideoData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number,
    tagPosition: number
  ) {
    // not enough data
    if (dataSize <= 1) {
      console.warn('Flv: Invalid video packet, missing VideoData payload!');
      return;
    }

    // @IGNORE override hasVideo

    // first 1 byte
    let spec = new Uint8Array(arrayBuffer, dataOffset, dataSize)[0];
    // Frame Type (4 bits)
    // 1: key frame
    // 2: I frame
    // 5: video info / command frame
    // 240 <-> 11110000
    let frameType = (spec & 240) >>> 4;
    // Codec ID (4 bits)
    // 7: AVC
    // 15 <-> 1111
    let codecId = spec & 15;
    if (codecId !== 7) {
      this.onError(
        DemuxErrors.CODEC_UNSUPPORTED,
        `Flv: Unsupported codec in video frame: ${codecId}`
      );
      return;
    }
    this._parseAVCVideoPacket(
      arrayBuffer,
      dataOffset + 1,
      dataSize - 1,
      tagTimestamp,
      tagPosition,
      frameType
    );
  }

  private _parseAVCVideoPacket(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number,
    tagPosition: number,
    frameType: number
  ) {
    // not enough data
    if (dataSize < 4) {
      console.warn(
        'Flv: Invalid AVC packet, missing AVCPacketType or/and CompositionTime'
      );
      return;
    }

    let le = this._littleEndian;
    let v = new DataView(arrayBuffer, dataOffset, dataSize);

    // Packet Type (1 byte)
    // 0: sequence header
    // 1: NALU
    // 2: end of sequence
    let packetType = v.getUint8(0);
    // Composition Time (3 bytes)
    // if packetType != 1 then 0
    let cts_unsigned = v.getUint32(0, !le) & 0x00ffffff;
    // convert to 24-bit signed int
    let cts = (cts_unsigned << 8) >> 8;

    if (packetType === 0) {
      this._parseAVCDecoderConfigurationRecord(
        arrayBuffer,
        dataOffset + 4,
        dataSize - 4
      );
    } else if (packetType === 1) {
      this._parseAVCVideoData(
        arrayBuffer,
        dataOffset + 4,
        dataSize - 4,
        tagTimestamp,
        tagPosition,
        frameType,
        cts
      );
    } else if (packetType === 2) {
      // empty, AVC end of sequence
    } else {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        `Flv: Invalid video packet type ${packetType}`
      );
      return;
    }
  }

  private _parseAVCDecoderConfigurationRecord(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number
  ) {
    // not enough data
    if (dataSize < 7) {
      console.warn('Flv: Invalid AVCDecoderConfigurationRecord, lack of data!');
      return;
    }

    let meta = this._videoMetadata;
    let track = this._videoTrack;

    let le = this._littleEndian;
    let v = new DataView(arrayBuffer, dataOffset, dataSize);

    // @IGNORE override hasVideo
    meta.type = 'video';
    meta.timescale = this._timescale;
    meta.duration = this._duration;

    /**
     * @REF https://ossrs.io/lts/zh-cn/assets/files/ISO_IEC_14496-15-AVC-format-2012-345a5b466cc73e978fd9dd0840361e8b.pdf
     * 5.2.4.1.1
     */
    // configurationVersion (1 byte)
    let version = v.getUint8(0);
    // AVCProfileIndication (1 byte)
    let avcProfile = v.getUint8(1);
    // profile_compatibility (1 byte)
    let profileCompatibility = v.getUint8(2);
    // AVCLevelIndication (1 byte)
    let avcLevel = v.getUint8(3);

    if (version !== 1 || avcProfile === 0) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        'Flv: Invalid AVCDecoderConfigurationRecord'
      );
      return;
    }

    // Reserved (6 bits)
    // lengthSizeMinusOne (2 bits)
    this._naluLengthSize = (v.getUint8(4) & 3) + 1;
    // _naluLengthSize should be 1/2/4
    if (this._naluLengthSize !== 4) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        `Flv: Strange NaluLengthSizeMinusOne: ${this._naluLengthSize - 1}`
      );
      return;
    }

    // Reserved (3 bits)
    // numOfSequenceParameterSets (5 bits)
    // 31 <-> 11110
    let spsCount = v.getUint8(5) & 31;
    if (spsCount === 0) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        'Flv: Invalid AVCDecoderConfigurationRecord: No SPS'
      );
      return;
    } else if (spsCount > 1) {
      console.warn(
        `Flv: Strange AVCDecoderConfigurationRecord: SPS Count = ${spsCount}`
      );
    }
    // already parsed 6 bytes
    let offset = 6;
    for (let i = 0; i < spsCount; i++) {
      // sequenceParameterSetLength (16 bits)
      let len = v.getUint16(offset, !le);
      offset += 2;

      if (len === 0) {
        continue;
      }
      // sequenceParameterSetNALUnit (${len} bytes)
      let sps = new Uint8Array(arrayBuffer, dataOffset + offset, len);
      offset += len;

      // only reserve the first sps
      if (i !== 0) {
        continue;
      }
      let config = SPSParser.parseSPS(sps);
      meta.codecWidth = config.codec_size.width;
      meta.codecHeight = config.codec_size.height;
      meta.presentWidth = config.present_size.width;
      meta.presentHeight = config.present_size.height;

      meta.profile = config.profile_string;
      meta.level = config.level_string;
      meta.bitDepth = config.bit_depth;
      meta.chromaFormat = config.chroma_format;
      meta.sarRatio = config.sar_ratio;
      meta.frameRate = config.frame_rate;

      // compute duration by frames
      let fps_den = meta.frameRate.fps_den;
      let fps_num = meta.frameRate.fps_num;
      meta.refSampleDuration = meta.timescale * (fps_den / fps_num);

      let codecArray = sps.subarray(1, 4);
      let codecString = 'avc1.';
      for (let j = 0; j < 3; j++) {
        let h = codecArray[j].toString(16);
        if (h.length < 2) {
          h = '0' + h;
        }
        codecString += h;
      }
      meta.codec = codecString;

      // @IGNORE media info
    }

    // numOfPictureParameterSets (1 byte)
    let ppsCount = v.getUint8(offset);
    if (ppsCount === 0) {
      this.onError(
        DemuxErrors.FORMAT_ERROR,
        'Flv: Invalid AVCDecoderConfigurationRecord: No PPS'
      );
      return;
    } else if (ppsCount > 1) {
      console.warn(
        `Flv: Strange AVCDecoderConfigurationRecord: PPS Count = ${ppsCount}`
      );
    }

    offset++;
    for (let i = 0; i < ppsCount; i++) {
      // pictureParameterSetLength (16 bits)
      let len = v.getUint16(offset, !le);
      offset += 2;

      if (len === 0) {
        continue;
      }

      console.debug('Parsed AVCDecoderConfigurationRecord');
      // pps is useless for extracting video information
      // just skip
      offset += len;
    }

    // @TODO _isInitialMetadataDispatched

    this.onTrackMetadata('video', meta);
  }

  private _parseAVCVideoData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number,
    tagPosition: number,
    frameType: number,
    cts: number
  ) {
    let le = this._littleEndian;
    let v = new DataView(arrayBuffer, dataOffset, dataSize);

    let units: NALUnit[] = [],
      length = 0;

    let offset = 0;
    // set in _parseAVCDecoderConfigurationRecord
    const lengthSize = this._naluLengthSize;

    let dts = this._timestampBase + tagTimestamp;
    let keyframe = frameType === 1;

    while (offset < dataSize) {
      // not enough data
      if (offset + 4 >= dataSize) {
        console.warn(
          `Malformed Nalu near timestamp ${dts}, offset = ${offset}, dataSize = ${dataSize}`
        );
        break; // data not enough for next Nalu
      }

      /**
       * NALU with length-header (AVC1)
       * @REF https://blog.csdn.net/qq_15457239/article/details/100545520
       */
      let naluSize = v.getUint32(offset, !le);

      // not enough data
      if (naluSize > dataSize - lengthSize) {
        console.warn(
          `Malformed Nalus near timestamp ${dts}, NaluSize > DataSize!`
        );
        return;
      }
      // Unit Type (5 bits)
      // 5: IDR
      let unitType = v.getUint8(offset + lengthSize) & 0x1f;

      if (unitType === 5) {
        keyframe = true;
      }

      let data = new Uint8Array(
        arrayBuffer,
        dataOffset + offset,
        lengthSize + naluSize
      );
      let unit = { type: unitType, data: data };
      units.push(unit);
      length += data.byteLength;
      offset += lengthSize + naluSize;
    }

    if (units.length > 0) {
      let track = this._videoTrack;
      let avcSample: AVCSample = {
        units: units,
        length: length,
        isKeyframe: keyframe,
        dts: dts,
        cts: cts,
        pts: dts + cts,
      };
      if (keyframe) {
        avcSample.filePosition = tagPosition;
      }
      track.samples.push(avcSample);
      track.length += length;

      // console.debug('[corex] parsed video sample', avcSample);
    }
  }
}

export default FLVDemuxer;
