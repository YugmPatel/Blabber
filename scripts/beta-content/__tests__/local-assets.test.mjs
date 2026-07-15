import { describe, expect, it } from 'vitest';
import {
  buildAccountAvatarFfmpegArgs,
  buildLocalImageFfmpegArgs,
  resolveBetaSeedFontFile,
} from '../local-assets.mjs';

function existsOnly(paths) {
  const allowed = new Set(paths);
  return (path) => allowed.has(path);
}

function noFcMatch() {
  return { status: 1, stdout: '', stderr: 'not found' };
}

describe('resolveBetaSeedFontFile', () => {
  it('prefers BETA_SEED_FONT_FILE when set and present', () => {
    const custom = '/tmp/beta-fonts/CustomSans.ttf';
    const resolved = resolveBetaSeedFontFile({
      env: { BETA_SEED_FONT_FILE: custom },
      exists: existsOnly([custom, '/usr/share/fonts/TTF/DejaVuSans.ttf']),
      spawn: noFcMatch,
    });
    expect(resolved).toBe(custom);
  });

  it('falls back to the Alpine DejaVu font path', () => {
    const alpine = '/usr/share/fonts/TTF/DejaVuSans.ttf';
    expect(resolveBetaSeedFontFile({ env: {}, exists: existsOnly([alpine]), spawn: noFcMatch })).toBe(alpine);
  });

  it('falls back to the Debian DejaVu font path', () => {
    const debian = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    expect(resolveBetaSeedFontFile({ env: {}, exists: existsOnly([debian]), spawn: noFcMatch })).toBe(debian);
  });

  it('uses fc-match when known paths are absent', () => {
    const matched = '/nix/store/fonts/DejaVuSans.ttf';
    const calls = [];
    const spawn = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: matched, stderr: '' };
    };

    expect(resolveBetaSeedFontFile({ env: {}, exists: existsOnly([matched]), spawn })).toBe(matched);
    expect(calls[0]).toEqual(['fc-match', '-f', '%{file}', 'Sans']);
  });

  it('throws an actionable error when no usable font is available', () => {
    expect(() => resolveBetaSeedFontFile({ env: {}, exists: () => false, spawn: noFcMatch })).toThrow(
      /Install fontconfig\/ttf-dejavu in the media image or set BETA_SEED_FONT_FILE/
    );
  });
});

describe('generated asset ffmpeg drawtext commands', () => {
  it('uses fontfile for branded cards rather than a bare font family', () => {
    const args = buildLocalImageFfmpegArgs('/tmp/card.jpg', {
      title: 'Welcome to Blabber Beta',
      caption: 'Start with message requests.',
      fontFile: '/usr/share/fonts/TTF/DejaVuSans.ttf',
    });
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain("drawtext=fontfile='/usr/share/fonts/TTF/DejaVuSans.ttf'");
    expect(filter).not.toContain('font=Sans');
    expect(filter).not.toContain('fontfamily');
  });

  it('uses fontfile for account avatar initials', () => {
    const args = buildAccountAvatarFfmpegArgs('/tmp/avatar.jpg', {
      initials: 'B',
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    });
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain("drawtext=fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'");
    expect(filter).not.toContain('font=Sans');
  });
});
