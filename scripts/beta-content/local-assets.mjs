// Local/generated Blabber-branded fallback assets — the last link in the
// fallback chain (Pexels -> Pixabay/Unsplash -> local generated), used only
// when every external provider has nothing suitable for a given content
// need. Generated with ffmpeg lavfi sources the same way
// scripts/seed-demo-social.mjs already does, but styled with Blabber's
// mint/teal brand palette instead of arbitrary hues, since this is the one
// content source in the mix that's explicitly "Blabber official" branding
// rather than sourced stock content.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BRAND_TEAL = '0f766e';
const BRAND_MINT = '5eead4';

const PALETTE = [
  ['0f766e', '5eead4'],
  ['1d4ed8', '93c5fd'],
  ['7c3aed', 'c4b5fd'],
  ['be123c', 'fda4af'],
  ['b45309', 'fde68a'],
  ['047857', 'a7f3d0'],
  ['4338ca', 'a5b4fc'],
  ['0f172a', '38bdf8'],
  ['9f1239', 'f9a8d4'],
  ['365314', 'bef264'],
];

const FONT_CANDIDATES = [
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];

const NO_FONT_ERROR = 'No usable font file found for beta generated assets. Install fontconfig/ttf-dejavu in the media image or set BETA_SEED_FONT_FILE.';

function runQuiet(command, args) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`local_asset_generation_failed: ${command} ${(result.stderr || result.error?.message || '').slice(0, 300)}`);
  }
}

export function resolveBetaSeedFontFile({
  env = process.env,
  exists = existsSync,
  spawn = spawnSync,
} = {}) {
  if (env.BETA_SEED_FONT_FILE && exists(env.BETA_SEED_FONT_FILE)) return env.BETA_SEED_FONT_FILE;

  for (const candidate of FONT_CANDIDATES) {
    if (exists(candidate)) return candidate;
  }

  for (const family of ['Sans', 'DejaVu Sans']) {
    const result = spawn('fc-match', ['-f', '%{file}', family], { stdio: 'pipe', encoding: 'utf8' });
    const file = String(result.stdout || '').trim();
    if (result.status === 0 && file && exists(file)) return file;
  }

  throw new Error(NO_FONT_ERROR);
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function escapeDrawtextOption(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function wrapWords(text, maxChars) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function drawText({ text, x, y, size, fontFile, color = 'white', lineSpacing = 18, maxChars = 24 }) {
  return wrapWords(text, maxChars)
    .map((line, index) => `drawtext=fontfile='${escapeDrawtextOption(fontFile)}':text='${escapeDrawtext(line)}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y + index * (size + lineSpacing)}`)
    .join(',');
}

export function buildLocalImageFfmpegArgs(outputPath, { index = 0, title, caption, fontFile } = {}) {
  if (!fontFile) throw new Error(NO_FONT_ERROR);
  const [base, accent] = PALETTE[index % PALETTE.length] || [BRAND_TEAL, BRAND_MINT];
  const textFilters = title
    ? [
        drawText({ text: 'Blabber', x: 80, y: 72, size: 42, color: `0x${BRAND_MINT}`, maxChars: 16, fontFile }),
        drawText({ text: title, x: 80, y: 360, size: 76, maxChars: 22, fontFile }),
        caption ? drawText({ text: caption, x: 84, y: 575, size: 38, color: '0xe2e8f0', maxChars: 42, fontFile }) : '',
      ].filter(Boolean)
    : [];

  return [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x${base}:s=1200x900:d=1`,
    '-frames:v', '1',
    '-vf', [
      `drawbox=x=${100 + (index % 5) * 24}:y=${120 + (index % 4) * 30}:w=480:h=480:color=0x${BRAND_MINT}@0.22:t=fill`,
      `drawbox=x=${650 - (index % 4) * 35}:y=90:w=380:h=380:color=0x${accent}@0.18:t=fill`,
      'drawbox=x=0:y=760:w=1200:h=140:color=black@0.28:t=fill',
      ...textFilters,
    ].join(','),
    outputPath,
  ];
}

export function buildAccountAvatarFfmpegArgs(outputPath, { index = 0, initials = 'B', fontFile } = {}) {
  if (!fontFile) throw new Error(NO_FONT_ERROR);
  const [base, accent] = PALETTE[index % PALETTE.length] || [BRAND_TEAL, BRAND_MINT];
  return [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x${base}:s=512x512:d=1`,
    '-frames:v', '1',
    '-vf', [
      `drawbox=x=62:y=62:w=388:h=388:color=0x${accent}@0.24:t=fill`,
      `drawtext=fontfile='${escapeDrawtextOption(fontFile)}':text='${escapeDrawtext(initials)}':fontcolor=white:fontsize=148:x=(w-text_w)/2:y=(h-text_h)/2-10`,
    ].join(','),
    outputPath,
  ];
}

export function buildLocalReelVideoFfmpegArgs(outputPath, { durationSeconds = 6, fontFile } = {}) {
  if (!fontFile) throw new Error(NO_FONT_ERROR);
  return [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x${BRAND_TEAL}:s=720x1280:d=${durationSeconds}`,
    '-vf', [
      `drawbox=x=100+80*sin(t*1.4):y=300+140*cos(t*1.1):w=420:h=420:color=0x${BRAND_MINT}@0.25:t=fill`,
      'drawbox=x=0:y=1080:w=720:h=200:color=black@0.32:t=fill',
      `drawtext=fontfile='${escapeDrawtextOption(fontFile)}':text='${escapeDrawtext('Blabber Beta')}':fontcolor=white:fontsize=54:x=56:y=1098`,
      `drawtext=fontfile='${escapeDrawtextOption(fontFile)}':text='${escapeDrawtext('Generated seed reel')}':fontcolor=0xe2e8f0:fontsize=32:x=56:y=1168`,
    ].join(','),
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ];
}

/**
 * A single still frame, Blabber-teal gradient background with a simple
 * geometric accent — used as the local-generated fallback for a feed photo.
 */
export function generateLocalImage(outputPath, { index = 0, title, caption } = {}) {
  runQuiet('ffmpeg', buildLocalImageFfmpegArgs(outputPath, { index, title, caption, fontFile: resolveBetaSeedFontFile() }));
}

export function generateAccountAvatar(outputPath, { index = 0, initials = 'B' } = {}) {
  runQuiet('ffmpeg', buildAccountAvatarFfmpegArgs(outputPath, { index, initials, fontFile: resolveBetaSeedFontFile() }));
}

/**
 * A short vertical video clip, same brand palette, used as the
 * local-generated fallback for a Reel when no external video candidate
 * clears asset-score.mjs's filters.
 */
export function generateLocalReelVideo(outputPath, { index = 0, durationSeconds = 6 } = {}) {
  const fontFile = resolveBetaSeedFontFile();
  runQuiet('ffmpeg', buildLocalReelVideoFfmpegArgs(outputPath, { index, durationSeconds, fontFile }));
}
