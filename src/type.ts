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

interface AudioMetadata {
  type: 'audio';
  timescale: number;
  duration: number;
  audioSampleRate: number;
  channelCount: number;
  codec: string;
  refSampleDuration: number;
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
