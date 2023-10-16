export function supportMSEH264Playback(): boolean {
  return (
    // whether support MSE
    window.MediaSource &&
    // whether support specific type
    window.MediaSource.isTypeSupported(
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
    )
  );
}
