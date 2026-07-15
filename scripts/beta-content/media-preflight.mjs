import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from './config.mjs';
import { candidateAssetKey } from './asset-score.mjs';

const REEL_MIN_DURATION_SECONDS = 3;
const REEL_MAX_DURATION_SECONDS = 90;
const REEL_MAX_DIMENSION = 1920;
const REEL_MAX_FRAME_RATE = 60;
const REEL_MAX_BITRATE = 12_000_000;

export async function downloadCandidateBuffer(candidate, { fetchImpl = fetch, maxBytes } = {}) {
  const options = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(15_000) } : undefined;
  const response = await fetchImpl(candidate.downloadUrl, options);
  if (!response.ok) throw new Error(`download_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('download_empty');
  if (bytes.length > maxBytes) throw new Error('download_too_large');
  return bytes;
}

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function frameRate(value) {
  if (!value || !String(value).includes('/')) return 0;
  const [left, right] = String(value).split('/').map(Number);
  if (!left || !right) return 0;
  return left / right;
}

function parseDuration(format, video) {
  const duration = Number(video.duration || format?.duration || 0);
  return Number.isFinite(duration) ? duration : 0;
}

export function probeMediaFile(path, { execFile = execFileSync } = {}) {
  const stdout = execFile('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15_000 });
  return JSON.parse(stdout || '{}');
}

export function validatePhotoProbe(parsed) {
  const video = (parsed.streams || []).find((stream) => stream.codec_type === 'video');
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  if (!width || !height) throw new Error('invalid_dimensions');
  if (width > 12_000 || height > 12_000 || width * height > 80_000_000) throw new Error('invalid_dimensions');
  return { width, height };
}

export function validateReelProbe(parsed) {
  const streams = parsed.streams || [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const unsupported = streams.filter((stream) => !['video', 'audio'].includes(String(stream.codec_type || '')));
  if (videoStreams.length !== 1) throw new Error('invalid_video_stream_count');
  if (audioStreams.length > 1) throw new Error('invalid_audio_stream_count');
  if (unsupported.length) throw new Error('unsupported_stream');
  const video = videoStreams[0];
  const audio = audioStreams[0];
  if (video.codec_name !== 'h264') throw new Error('unsupported_video_codec');
  if (audio && audio.codec_name !== 'aac') throw new Error('unsupported_audio_codec');
  const duration = parseDuration(parsed.format, video);
  if (duration < REEL_MIN_DURATION_SECONDS || duration > REEL_MAX_DURATION_SECONDS) throw new Error('duration_out_of_bounds');
  const width = Number(video.width || 0);
  const height = Number(video.height || 0);
  if (!width || !height || width > REEL_MAX_DIMENSION || height > REEL_MAX_DIMENSION) throw new Error('dimensions_out_of_bounds');
  if (frameRate(video.r_frame_rate) > REEL_MAX_FRAME_RATE) throw new Error('frame_rate_out_of_bounds');
  const bitrate = Number(video.bit_rate || parsed.format?.bit_rate || 0);
  if (bitrate && bitrate > REEL_MAX_BITRATE) throw new Error('bitrate_out_of_bounds');
  return { durationSeconds: Math.round(duration * 10) / 10, width, height, hasAudio: Boolean(audio) };
}

export async function preflightCandidate(candidate, { kind, fetchImpl = fetch, execFile = execFileSync } = {}) {
  const buffer = await downloadCandidateBuffer(candidate, { fetchImpl, maxBytes: kind === 'video' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES });
  if (kind === 'photo' && !detectImageMime(buffer)) throw new Error('mime_mismatch');
  const tempDir = mkdtempSync(join(tmpdir(), 'blabber-beta-preflight-'));
  const extension = kind === 'video' ? '.mp4' : '.jpg';
  const path = join(tempDir, `asset${extension}`);
  try {
    writeFileSync(path, buffer);
    const probe = probeMediaFile(path, { execFile });
    const details = kind === 'video' ? validateReelProbe(probe) : validatePhotoProbe(probe);
    return { ok: true, buffer, details };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function pickFirstValidCandidate({ candidates, kind, preflight = preflightCandidate, alreadyUsedAssetKeys = new Set(), fetchImpl, execFile }) {
  const failures = [];
  for (const candidate of candidates) {
    const key = candidateAssetKey(candidate);
    if (alreadyUsedAssetKeys.has(key)) {
      failures.push({ candidate, source: candidate.provider, reason: 'duplicate_asset' });
      continue;
    }
    try {
      const validated = await preflight(candidate, { kind, fetchImpl, execFile });
      return { picked: candidate, validated, failures };
    } catch (error) {
      failures.push({ candidate, source: candidate.provider, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { picked: null, validated: null, failures };
}

export function failureSummary(failures) {
  const grouped = {};
  for (const failure of failures || []) {
    const source = failure.source || failure.candidate?.provider || 'unknown';
    const reason = failure.reason || 'unknown';
    grouped[source] ||= {};
    grouped[source][reason] = (grouped[source][reason] || 0) + 1;
  }
  return grouped;
}
