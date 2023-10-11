export function supportMSEH264Playback(): boolean {
  return (
    // 浏览器是否支持 MediaSource API
    window.MediaSource &&
    // 浏览器是否支持以下格式的媒体
    window.MediaSource.isTypeSupported(
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
    )
  );
}
