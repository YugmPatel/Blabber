import { describe, it, expect } from 'vitest';
import { validateMediaPolicy } from './media-policy';

// Minimal MP4-container ("ftyp" box) buffer. The container format doesn't
// distinguish audio-only from video content at this level, so detectMimeType
// always reports this as 'video/mp4' regardless of what's actually inside —
// this is exactly the shape Edge/Safari produce when MediaRecorder records
// audio as 'audio/mp4' instead of 'audio/webm'.
function mp4ContainerBuffer() {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from('M4A ', 'ascii'),
    Buffer.alloc(8),
  ]);
}

describe('validateMediaPolicy audio/mp4 (m4a) handling', () => {
  it('accepts an mp4-container audio file declared as audio/mp4', () => {
    const result = validateMediaPolicy({
      fileName: 'voice-123.m4a',
      declaredMimeType: 'audio/mp4',
      buffer: mp4ContainerBuffer(),
    });

    expect(result.category).toBe('audio');
    expect(result.extension).toBe('.m4a');
  });

  it('accepts an mp4-container audio file declared as audio/x-m4a', () => {
    const result = validateMediaPolicy({
      fileName: 'voice-123.m4a',
      declaredMimeType: 'audio/x-m4a',
      buffer: mp4ContainerBuffer(),
    });

    expect(result.category).toBe('audio');
  });

  it('accepts an mp4-container audio file declared with a codecs suffix', () => {
    const result = validateMediaPolicy({
      fileName: 'voice-123.m4a',
      declaredMimeType: 'audio/mp4;codecs=mp4a.40.2',
      buffer: mp4ContainerBuffer(),
    });

    expect(result.category).toBe('audio');
  });

  it('still rejects a genuinely mismatched declared mime type for .m4a', () => {
    expect(() =>
      validateMediaPolicy({
        fileName: 'voice-123.m4a',
        declaredMimeType: 'audio/wav',
        buffer: mp4ContainerBuffer(),
      })
    ).toThrow('mime_mismatch');
  });

  it('still rejects content whose sniffed type does not match a .mp4 extension at all', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(() =>
      validateMediaPolicy({
        fileName: 'clip.mp4',
        declaredMimeType: 'video/mp4',
        buffer: pngBuffer,
      })
    ).toThrow('mime_mismatch');
  });
});
