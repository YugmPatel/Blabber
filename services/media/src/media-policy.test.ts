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

function pngBuffer() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
}

function jpegBuffer() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
}

function gifBuffer() {
  return Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(8)]);
}

function heicBuffer() {
  const buffer = Buffer.alloc(32);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('heic', 8, 'ascii');
  return buffer;
}

function ftypBrandBuffer(brand: string) {
  const buffer = Buffer.alloc(32);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(brand, 8, 'ascii');
  return buffer;
}

function webmBuffer() {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)]);
}

function pdfBuffer() {
  return Buffer.concat([Buffer.from('%PDF-1.4', 'ascii'), Buffer.alloc(8)]);
}

function zipBuffer() {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(8)]);
}

function textBuffer(content = 'hello world') {
  return Buffer.from(content, 'ascii');
}

describe('validateMediaPolicy image aliases', () => {
  it('accepts a PNG declared with the nonstandard image/x-png alias', () => {
    const result = validateMediaPolicy({ fileName: 'photo.png', declaredMimeType: 'image/x-png', buffer: pngBuffer() });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/png' });
  });

  it('accepts a JPEG declared as the common image/jpg alias', () => {
    const result = validateMediaPolicy({ fileName: 'photo.jpg', declaredMimeType: 'image/jpg', buffer: jpegBuffer() });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/jpeg' });
  });

  it('accepts a JPEG declared as image/pjpeg', () => {
    const result = validateMediaPolicy({ fileName: 'photo.jpeg', declaredMimeType: 'image/pjpeg', buffer: jpegBuffer() });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/jpeg' });
  });

  it('accepts a GIF upload', () => {
    const result = validateMediaPolicy({ fileName: 'meme.gif', declaredMimeType: 'image/gif', buffer: gifBuffer() });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/gif' });
  });
});

describe('validateMediaPolicy video formats', () => {
  it('accepts an MP4 video upload', () => {
    const result = validateMediaPolicy({ fileName: 'clip.mp4', declaredMimeType: 'video/mp4', buffer: ftypBrandBuffer('isom') });
    expect(result).toMatchObject({ category: 'video', mimeType: 'video/mp4' });
  });

  it('accepts a QuickTime .mov video declared as video/quicktime', () => {
    const result = validateMediaPolicy({ fileName: 'clip.mov', declaredMimeType: 'video/quicktime', buffer: ftypBrandBuffer('qt  ') });
    expect(result).toMatchObject({ category: 'video', mimeType: 'video/quicktime' });
  });

  it('accepts a .mov upload even when the ftyp brand is not the recognized qt brand', () => {
    const result = validateMediaPolicy({ fileName: 'clip.mov', declaredMimeType: 'video/quicktime', buffer: ftypBrandBuffer('isom') });
    expect(result).toMatchObject({ category: 'video', mimeType: 'video/quicktime' });
  });

  it('categorizes a .webm upload declared as video/webm as video', () => {
    const result = validateMediaPolicy({ fileName: 'clip.webm', declaredMimeType: 'video/webm', buffer: webmBuffer() });
    expect(result).toMatchObject({ category: 'video', mimeType: 'video/webm' });
  });

  it('still categorizes an undeclared .webm as audio (voice-message default)', () => {
    const result = validateMediaPolicy({ fileName: 'voice.webm', declaredMimeType: 'audio/webm', buffer: webmBuffer() });
    expect(result).toMatchObject({ category: 'audio', mimeType: 'audio/webm' });
  });
});

describe('validateMediaPolicy document formats', () => {
  it('accepts a PDF document', () => {
    const result = validateMediaPolicy({ fileName: 'invoice.pdf', declaredMimeType: 'application/pdf', buffer: pdfBuffer() });
    expect(result).toMatchObject({ category: 'document', mimeType: 'application/pdf' });
  });

  it('accepts a DOCX document (zip container with OOXML extension)', () => {
    const result = validateMediaPolicy({
      fileName: 'report.docx',
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: zipBuffer(),
    });
    expect(result).toMatchObject({ category: 'document' });
  });

  it('accepts a PPTX document (zip container with OOXML extension)', () => {
    const result = validateMediaPolicy({
      fileName: 'deck.pptx',
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: zipBuffer(),
    });
    expect(result).toMatchObject({ category: 'document' });
  });

  it('accepts an XLSX document (zip container with OOXML extension)', () => {
    const result = validateMediaPolicy({
      fileName: 'sheet.xlsx',
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: zipBuffer(),
    });
    expect(result).toMatchObject({ category: 'document' });
  });

  it('accepts a plain-text .txt document', () => {
    const result = validateMediaPolicy({ fileName: 'notes.txt', declaredMimeType: 'text/plain', buffer: textBuffer() });
    expect(result).toMatchObject({ category: 'document', mimeType: 'text/plain' });
  });

  it('accepts a .csv file sniffed as plain text', () => {
    const result = validateMediaPolicy({ fileName: 'data.csv', declaredMimeType: 'text/csv', buffer: textBuffer('a,b,c\n1,2,3') });
    expect(result).toMatchObject({ category: 'document', mimeType: 'text/csv' });
  });
});

describe('validateMediaPolicy dangerous/unsupported files', () => {
  it('rejects a blocked executable extension outright', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'installer.exe', declaredMimeType: 'application/octet-stream', buffer: Buffer.alloc(16) })
    ).toThrow('unsafe_type');
  });

  it('rejects a blocked script extension outright', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'payload.sh', declaredMimeType: 'application/octet-stream', buffer: textBuffer('#!/bin/sh') })
    ).toThrow('unsafe_type');
  });

  it('rejects an extension with no recognized mapping at all', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'mystery.xyz', declaredMimeType: 'application/octet-stream', buffer: Buffer.alloc(16) })
    ).toThrow('unsafe_type');
  });

  it('rejects a file with a deceptive double extension (e.g. photo.jpg.exe)', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'photo.jpg.exe', declaredMimeType: 'application/octet-stream', buffer: jpegBuffer() })
    ).toThrow(/unsafe_type|deceptive_extension/);
  });

  it('rejects content whose sniffed bytes do not match a claimed .pdf extension', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'fake.pdf', declaredMimeType: 'application/pdf', buffer: jpegBuffer() })
    ).toThrow('mime_mismatch');
  });
});

describe('validateMediaPolicy iPhone-style MIME edge cases', () => {
  it('accepts a HEIC photo declared as application/octet-stream (iOS share-sheet fallback)', () => {
    const result = validateMediaPolicy({
      fileName: 'IMG_1234.heic',
      declaredMimeType: 'application/octet-stream',
      buffer: heicBuffer(),
    });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/heic' });
  });

  it('accepts a HEIC photo declared with no Content-Type at all', () => {
    const result = validateMediaPolicy({ fileName: 'IMG_1234.heic', declaredMimeType: '', buffer: heicBuffer() });
    expect(result).toMatchObject({ category: 'image', mimeType: 'image/heic' });
  });

  it('accepts a DOCX declared as application/octet-stream from an iOS share-sheet app', () => {
    const result = validateMediaPolicy({
      fileName: 'report.docx',
      declaredMimeType: 'application/octet-stream',
      buffer: zipBuffer(),
    });
    expect(result).toMatchObject({ category: 'document' });
  });

  it('still rejects an octet-stream upload whose extension has no safe mapping', () => {
    expect(() =>
      validateMediaPolicy({ fileName: 'mystery', declaredMimeType: 'application/octet-stream', buffer: Buffer.alloc(16) })
    ).toThrow('unsafe_type');
  });
});
