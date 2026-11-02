/**
 * The clip file: what short-video platforms take everywhere. H.264 Main is pinned: left to the
 * muxer, Chrome picks High and Safari Baseline. AAC because MP4 players expect it.
 */
export const CLIP_FORMAT = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'avc1.4d0028',
  videoBitrate: 6_000_000,
  keyFrameSec: 2,
  audioCodec: 'mp4a.40.2',
  sampleRate: 48_000,
  channels: 2,
  audioBitrate: 128_000,
} as const;

export type ClipSupport =
  | { supported: true }
  | { supported: false; reason: 'no-webcodecs' | 'no-h264' | 'no-aac' };

/**
 * Whether this browser can encode the clip, asked of WebCodecs directly so the encoder library
 * loads only when a clip is made. No AAC: Firefox, desktop Linux, Safari before 26.
 */
export async function clipSupport(): Promise<ClipSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return { supported: false, reason: 'no-webcodecs' };
  }
  const f = CLIP_FORMAT;
  const ok = (r: PromiseSettledResult<{ supported?: boolean }>) =>
    r.status === 'fulfilled' && r.value.supported === true;
  const [video, audio] = await Promise.allSettled([
    VideoEncoder.isConfigSupported({
      codec: f.videoCodec,
      width: f.width,
      height: f.height,
      bitrate: f.videoBitrate,
      framerate: f.fps,
    }),
    AudioEncoder.isConfigSupported({
      codec: f.audioCodec,
      sampleRate: f.sampleRate,
      numberOfChannels: f.channels,
      bitrate: f.audioBitrate,
    }),
  ]);
  if (!ok(video)) return { supported: false, reason: 'no-h264' };
  if (!ok(audio)) return { supported: false, reason: 'no-aac' };
  return { supported: true };
}
