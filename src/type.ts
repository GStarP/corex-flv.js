interface MediaDataSource {
  type: string;
  url: string;
  segments?: MediaSegment[];
}

interface MediaSegment {
  url: string;
}

interface LoaderErrorMessage {
  code: number;
  msg: string;
}

interface FlvProbeData {
  match: boolean;
  consumed: number;
  dataOffset: number;
  hasAudioTrack: boolean;
  hasVideoTrack: boolean;
}

interface AACAudioData {
  packetType: number;
  data?: AACAudioSpecificConfig | ArrayBuffer;
}
interface AACAudioSpecificConfig {
  samplingRate: number;
  channelCount: number;
  codec: string;
}
interface AudioSample {
  unit: Uint8Array;
  length: number;
  dts: number;
  pts: number;
}
interface AudioTrack {
  type: 'audio';
  id: number;
  sequenceNumber: number;
  samples: AudioSample[];
  length: number;
}

interface NALUnit {
  type: number;
  data: Uint8Array;
}
interface AVCSample {
  units: NALUnit[];
  length: number;
  isKeyframe: boolean;
  dts: number;
  cts: number;
  pts: number;
  filePosition?: number;
}
interface VideoTrack {
  type: 'video';
  id: number;
  sequenceNumber: number;
  samples: AVCSample[];
  length: number;
}

type MetaData = {
  audio: AudioMetadata;
  video: VideoMetadata;
};
type TrackType = keyof MetaData;

interface AudioMetadata {
  type: 'audio';
  timescale: number;
  duration: number;
  audioSampleRate: number;
  channelCount: number;
  codec: string;
  refSampleDuration: number;
}
interface VideoMetadata {
  type: 'video';
  timescale: number;
  duration: number;
  codecWidth: number;
  codecHeight: number;
  presentWidth: number;
  presentHeight: number;
  profile: string;
  level: string;
  bitDepth: number;
  chromaFormat: number;
  sarRatio: {
    width: number;
    height: number;
  };
  frameRate: {
    fixed: boolean;
    fps: number;
    fps_num: number;
    fps_den: number;
  };
  refSampleDuration: number;
  codec: string;
}
