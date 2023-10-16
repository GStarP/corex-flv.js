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
