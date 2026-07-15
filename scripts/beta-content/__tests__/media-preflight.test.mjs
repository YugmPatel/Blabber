import { describe, expect, it } from 'vitest';
import {
  failureSummary,
  pickFirstValidCandidate,
  validateReelProbe,
} from '../media-preflight.mjs';
import { buildContentPlan } from '../content-plan.mjs';
import { buildInventoryReport } from '../inventory.mjs';

const validVideoProbe = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, duration: '6', r_frame_rate: '30/1', bit_rate: '2000000' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '6', bit_rate: '2500000' },
};

describe('media validation parity', () => {
  it('rejects unsupported provider video streams during preflight', () => {
    const probe = {
      ...validVideoProbe,
      streams: [...validVideoProbe.streams, { codec_type: 'data', codec_name: 'bin_data' }],
    };
    expect(() => validateReelProbe(probe)).toThrow('unsupported_stream');
  });

  it('retries after unsupported_stream and succeeds with the next candidate', async () => {
    const candidates = [
      { provider: 'pexels', sourceAssetId: 'bad', downloadUrl: 'https://cdn/bad.mp4' },
      { provider: 'pexels', sourceAssetId: 'good', downloadUrl: 'https://cdn/good.mp4' },
    ];
    const seen = [];
    const result = await pickFirstValidCandidate({
      candidates,
      kind: 'video',
      preflight: async (candidate) => {
        seen.push(candidate.sourceAssetId);
        if (candidate.sourceAssetId === 'bad') throw new Error('unsupported_stream');
        return { ok: true, buffer: Buffer.from('valid') };
      },
    });

    expect(seen).toEqual(['bad', 'good']);
    expect(result.picked.sourceAssetId).toBe('good');
    expect(result.failures).toHaveLength(1);
    expect(failureSummary(result.failures)).toEqual({ pexels: { unsupported_stream: 1 } });
  });

  it('reports exhausted provider candidates so callers can use generated reel fallback', async () => {
    const result = await pickFirstValidCandidate({
      candidates: [
        { provider: 'pexels', sourceAssetId: 'bad-1', downloadUrl: 'https://cdn/1.mp4' },
        { provider: 'pixabay', sourceAssetId: 'bad-2', downloadUrl: 'https://cdn/2.mp4' },
      ],
      kind: 'video',
      preflight: async () => {
        throw new Error('unsupported_video_codec');
      },
    });

    expect(result.picked).toBeNull();
    expect(result.failures).toHaveLength(2);
    expect(failureSummary(result.failures)).toEqual({
      pexels: { unsupported_video_codec: 1 },
      pixabay: { unsupported_video_codec: 1 },
    });
  });

  it('inventory enforces 60 posts and 30 reels after validation, not before validation', () => {
    const plan = buildContentPlan();
    const postResolutions = plan.posts.map((spec, index) => ({ spec, resolved: index < 59, picked: index < 59 ? { provider: 'pexels' } : null }));
    const reelResolutions = plan.reels.map((spec, index) => ({ spec, resolved: index < 29, picked: index < 29 ? { provider: 'pexels' } : null }));
    const report = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable: true });

    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toContain('Required 60 feed posts');
    expect(report.problems.join('\n')).toContain('Required 30 reels');
  });

  it('category minimums are preserved when generated fallback fills exhausted provider reels', () => {
    const plan = buildContentPlan();
    const postResolutions = plan.posts.map((spec) => ({ spec, resolved: true, picked: { provider: 'pexels' } }));
    const reelResolutions = plan.reels.map((spec, index) => ({
      spec,
      resolved: true,
      picked: index % 3 === 0 ? null : { provider: 'pexels' },
      source: index % 3 === 0 ? 'generated' : 'pexels',
    }));
    const report = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable: true });

    expect(report.ok).toBe(true);
    expect(report.reels.byCategory).toEqual({ onboarding: 5, campus: 5, tech: 5, food: 4, travel: 4, productivity: 4, events: 3 });
    expect(report.sourceMix.generated).toBeGreaterThan(0);
  });
});
