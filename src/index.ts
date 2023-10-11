import * as Features from './core/feature';

export function isSupported(): boolean {
  return Features.supportMSEH264Playback();
}
