import * as Features from './core/feature';
import FlvPlayer from './player/flv-player';

export function isSupported(): boolean {
  return Features.supportMSEH264Playback();
}

export function createPlayer(mediaDataSource: MediaDataSource): FlvPlayer {
  switch (mediaDataSource.type) {
    case 'flv':
      return new FlvPlayer(mediaDataSource);
    default:
      throw new Error('@IGNORE only support FlvPlayer');
  }
}
