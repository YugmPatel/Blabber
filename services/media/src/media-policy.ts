import { basename, extname } from 'path';

export type MediaCategory = 'image' | 'audio' | 'document' | 'video';

export interface MediaPolicyResult {
  category: MediaCategory;
  mimeType: string;
  extension: string;
}

const IMAGE_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-citrix-jpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

const AUDIO_TYPES: Record<string, string[]> = {
  'audio/mpeg': ['.mp3'],
  'audio/mp3': ['.mp3'],
  'audio/ogg': ['.ogg'],
  'audio/wav': ['.wav'],
  'audio/webm': ['.webm'],
  'audio/mp4': ['.m4a'],
  'audio/x-m4a': ['.m4a'],
  'audio/m4a': ['.m4a'],
  'audio/aac': ['.aac'],
};

const VIDEO_TYPES: Record<string, string[]> = {
  'video/mp4': ['.mp4'],
};

const DOCUMENT_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
};

const EXTENSION_TO_MIME = new Map<string, string>();
for (const [mime, extensions] of Object.entries({ ...IMAGE_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES, ...VIDEO_TYPES })) {
  for (const extension of extensions) EXTENSION_TO_MIME.set(extension, mime);
}

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.dmg', '.pkg', '.sh', '.bash', '.zsh', '.ps1',
  '.js', '.mjs', '.vbs', '.jar', '.scr', '.html', '.htm', '.svg', '.zip', '.rar', '.7z', '.tar',
  '.gz', '.iso', '.docm', '.xlsm', '.pptm',
]);

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function sanitizeDisplayFileName(value: string) {
  const base = basename(value || 'upload').replace(CONTROL_CHARS, '').replace(/[\\/]/g, '_');
  const compact = base.replace(/\s+/g, ' ').replace(/[^\w .()\-]/g, '_').trim();
  return compact.slice(0, 180) || 'upload';
}

export function safeExtension(fileName: string) {
  return extname(sanitizeDisplayFileName(fileName)).toLowerCase();
}

export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 12 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    const compatibleBrands = buffer.toString('ascii', 8, Math.min(buffer.length, 64)).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand) || compatibleBrands.includes('heic')) return 'image/heic';
    if (['heif', 'mif1', 'msf1'].includes(brand) || compatibleBrands.includes('heif')) return 'image/heif';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return 'application/msword';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  if (isMostlyText(buffer)) return 'text/plain';
  return null;
}

export function normalizeDeclaredMimeType(value?: string) {
  const declared = (value || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[declared] || declared;
}

function isMostlyText(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) printable += 1;
  }
  return sample.length > 0 && printable / sample.length > 0.95;
}

export function validateMediaPolicy(params: {
  fileName: string;
  declaredMimeType?: string;
  buffer: Buffer;
}): MediaPolicyResult {
  const displayName = sanitizeDisplayFileName(params.fileName);
  const extension = safeExtension(displayName);
  const allExtensions = displayName.toLowerCase().split('.').slice(1).map((part) => `.${part}`);
  if (!extension || allExtensions.some((part) => BLOCKED_EXTENSIONS.has(part))) {
    throw new Error('unsafe_type');
  }
  if (allExtensions.length > 1 && allExtensions.slice(0, -1).some((part) => EXTENSION_TO_MIME.has(part))) {
    throw new Error('deceptive_extension');
  }

  const detected = detectMimeType(params.buffer);
  const declared = normalizeDeclaredMimeType(params.declaredMimeType);
  const expectedByExtension = EXTENSION_TO_MIME.get(extension);
  if (!expectedByExtension) throw new Error('unsafe_type');

  const isOoxml =
    detected === 'application/zip' &&
    ['.docx', '.xlsx', '.pptx'].includes(extension) &&
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(expectedByExtension);
  const isCsv = extension === '.csv' && detected === 'text/plain';
  // .m4a resolves to whichever of these three mime types was registered last
  // in EXTENSION_TO_MIME (they're aliases for the same MP4-container audio
  // format). Browsers disagree on which one MediaRecorder/File reports —
  // notably Edge and Safari record audio as 'audio/mp4' rather than
  // 'audio/webm' — so both the sniffed-container check and the
  // declared-mimetype check below must treat the whole family as equivalent
  // instead of requiring an exact string match against expectedByExtension.
  const m4aFamily = ['audio/mp4', 'audio/x-m4a', 'audio/m4a'];
  const isM4aExpected = m4aFamily.includes(expectedByExtension);
  const isMp4Family = detected === 'video/mp4' && isM4aExpected;

  if (!detected || (!isOoxml && !isCsv && !isMp4Family && detected !== expectedByExtension)) {
    throw new Error('mime_mismatch');
  }
  if (declared && declared !== expectedByExtension && !(isM4aExpected && m4aFamily.includes(declared))) {
    throw new Error('mime_mismatch');
  }

  const category: MediaCategory =
    expectedByExtension in IMAGE_TYPES
      ? 'image'
      : expectedByExtension in VIDEO_TYPES
        ? 'video'
        : expectedByExtension in AUDIO_TYPES
          ? 'audio'
          : 'document';
  return { category, mimeType: expectedByExtension, extension };
}

export function maxBytesForCategory(category: MediaCategory) {
  if (category === 'image') return Number(process.env.MEDIA_MAX_IMAGE_BYTES || 10 * 1024 * 1024);
  if (category === 'video') return Number(process.env.REEL_MAX_SOURCE_BYTES || 100 * 1024 * 1024);
  if (category === 'audio') return Number(process.env.MEDIA_MAX_AUDIO_BYTES || 25 * 1024 * 1024);
  return Number(process.env.MEDIA_MAX_DOCUMENT_BYTES || 25 * 1024 * 1024);
}

export function allowedMimeTypes() {
  return Object.keys({ ...IMAGE_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES, ...VIDEO_TYPES });
}
