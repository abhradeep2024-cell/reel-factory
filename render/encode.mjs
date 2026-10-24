// FFmpeg encoding (Instagram-compliant) + ffprobe validation.
// Spec targets: H.264 High, yuv420p, closed GOP, 23-60fps, VBR under 25Mbps,
// faststart (moov atom at front), no audio track unless music is provided.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function encodeFilm(opts) {
  const { framesDir, outPath, fps = 30, crfBytes = null, audioPath = null } = opts;
  const keyint = Math.round(fps * 2);
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', `${framesDir}/f_%06d.jpg`,
  ];
  if (audioPath) {
    args.push('-i', audioPath, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest');
  }
  args.push(
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.2',
    '-vf', 'scale=out_range=tv,format=yuv420p',
    '-color_range', 'tv',
    '-x264-params', `keyint=${keyint}:min-keyint=${keyint}:scenecut=0:open_gop=0`,
  );
  if (crfBytes) {
    args.push('-b:v', '10M', '-maxrate', '20M', '-bufsize', '24M');
  } else {
    args.push('-crf', '20', '-maxrate', '20M', '-bufsize', '24M');
  }
  args.push('-movflags', '+faststart');
  if (!audioPath) args.push('-an');
  args.push(outPath);
  const { stderr } = await run('ffmpeg', args, { maxBuffer: 1024 * 1024 * 32 });
  return { stderr: stderr.slice(-1500) };
}

export async function probeVideo(path) {
  const { stdout } = await run('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', path,
  ]);
  return JSON.parse(stdout);
}

export function validateProbe(probe, expect) {
  const errors = [];
  const v = (probe.streams || []).find((s) => s.codec_type === 'video');
  if (!v) return { ok: false, errors: ['no video stream'], info: null };
  if (v.codec_name !== 'h264') errors.push(`codec is ${v.codec_name}, expected h264`);
  if (Number(v.width) !== expect.width) errors.push(`width is ${v.width}, expected ${expect.width}`);
  if (Number(v.height) !== expect.height) errors.push(`height is ${v.height}, expected ${expect.height}`);
  if (v.pix_fmt !== 'yuv420p') errors.push(`pix_fmt is ${v.pix_fmt}, expected yuv420p`);
  const [nr, dr] = String(v.r_frame_rate || '0/1').split('/').map(Number);
  const fps = dr ? nr / dr : 0;
  if (Math.abs(fps - expect.fps) > 1.5) errors.push(`fps is ${fps}, expected ~${expect.fps}`);
  const duration = Number(probe.format?.duration || v.duration || 0);
  if (duration < expect.minSec) errors.push(`duration ${duration}s < min ${expect.minSec}s`);
  if (duration > expect.maxSec) errors.push(`duration ${duration}s > max ${expect.maxSec}s`);
  const size = Number(probe.format?.size || 0);
  if (size > 300 * 1024 * 1024) errors.push('file larger than 300MB Instagram limit');
  return {
    ok: errors.length === 0,
    errors,
    info: { duration: Math.round(duration * 100) / 100, fps: Math.round(fps * 100) / 100, width: v.width, height: v.height, sizeBytes: size },
  };
}
