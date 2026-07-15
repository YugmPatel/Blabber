import { describe, expect, it } from 'vitest';
import { candidateAssetKey, scorePhoto, scoreVideo, selectTopCandidates } from '../asset-score.mjs';
import { MIN_PHOTO_WIDTH } from '../config.mjs';

function photo(overrides = {}) {
  return {
    provider: 'pexels',
    kind: 'photo',
    sourceAssetId: '1',
    width: 1920,
    height: 1280,
    downloadUrl: 'https://example.com/photo.jpg',
    photographer: 'Someone',
    ...overrides,
  };
}

function video(overrides = {}) {
  return {
    provider: 'pexels',
    kind: 'video',
    sourceAssetId: '1',
    width: 720,
    height: 1280,
    durationSeconds: 10,
    downloadUrl: 'https://example.com/video.mp4',
    photographer: 'Someone',
    ...overrides,
  };
}

describe('scorePhoto', () => {
  it('accepts a well-formed, high-resolution landscape photo', () => {
    const result = scorePhoto(photo());
    expect(result.rejected).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it('rejects a photo below the minimum width', () => {
    const result = scorePhoto(photo({ width: MIN_PHOTO_WIDTH - 1 }));
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('below_min_width');
  });

  it('rejects a photo missing a download URL', () => {
    const result = scorePhoto(photo({ downloadUrl: null }));
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('missing_download_url');
  });

  it('rejects a photo already used earlier in the run (duplicate avoidance)', () => {
    const candidate = photo();
    const used = new Set([candidateAssetKey(candidate)]);
    const result = scorePhoto(candidate, { alreadyUsedAssetKeys: used });
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('duplicate_asset');
  });

  it('rejects a photo whose text fields match an unsafe-term hint', () => {
    const result = scorePhoto(photo({ alt: 'explicit nsfw content' }));
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('unsafe_term_match');
  });

  it('rejects a photo whose text fields hint at being text-heavy/logo content', () => {
    const result = scorePhoto(photo({ alt: 'company logo banner ad' }));
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('text_heavy_hint');
  });

  it('scores a higher-resolution photo at least as highly as a lower-resolution one', () => {
    const low = scorePhoto(photo({ width: 1080, height: 720 }));
    const high = scorePhoto(photo({ width: 4000, height: 2667 }));
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });
});

describe('scoreVideo', () => {
  it('accepts a well-formed portrait video inside the 5-20s target band', () => {
    const result = scoreVideo(video());
    expect(result.rejected).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it('rejects a video outside the real pipeline duration limits (services/media caps at 3-90s)', () => {
    const tooShort = scoreVideo(video({ durationSeconds: 1 }));
    const tooLong = scoreVideo(video({ durationSeconds: 120 }));
    expect(tooShort.rejected).toBe(true);
    expect(tooShort.reasons).toContain('duration_outside_pipeline_limits');
    expect(tooLong.rejected).toBe(true);
    expect(tooLong.reasons).toContain('duration_outside_pipeline_limits');
  });

  it('rejects a video exceeding the max dimension the pipeline accepts', () => {
    const result = scoreVideo(video({ width: 3840, height: 2160 }));
    expect(result.rejected).toBe(true);
    expect(result.reasons).toContain('exceeds_max_dimension');
  });

  it('scores a portrait video higher than an equivalent horizontal one', () => {
    const portrait = scoreVideo(video({ width: 720, height: 1280 }));
    const horizontal = scoreVideo(video({ width: 1280, height: 720 }));
    expect(portrait.score).toBeGreaterThan(horizontal.score);
  });

  it('still accepts (does not reject) a horizontal video, per the task allowing it', () => {
    const horizontal = scoreVideo(video({ width: 1280, height: 720 }));
    expect(horizontal.rejected).toBe(false);
  });

  it('scores a video inside the 5-20s target band higher than one just outside it', () => {
    const inBand = scoreVideo(video({ durationSeconds: 12 }));
    const outOfBand = scoreVideo(video({ durationSeconds: 25 }));
    expect(inBand.score).toBeGreaterThan(outOfBand.score);
  });
});

describe('selectTopCandidates', () => {
  it('filters out rejected candidates and returns the requested count, best first', () => {
    const candidates = [
      photo({ sourceAssetId: 'a', width: 500 }), // rejected: below min width
      photo({ sourceAssetId: 'b', width: 4000, height: 2667 }),
      photo({ sourceAssetId: 'c', width: 1200, height: 800 }),
    ];
    const picks = selectTopCandidates(candidates, 2, { kind: 'photo' });
    expect(picks).toHaveLength(2);
    expect(picks.map((pick) => pick.sourceAssetId)).toEqual(['b', 'c']);
  });

  it('returns an empty array when every candidate is rejected', () => {
    const candidates = [photo({ width: 100 }), photo({ downloadUrl: null })];
    expect(selectTopCandidates(candidates, 5, { kind: 'photo' })).toEqual([]);
  });

  it('does not mutate the passed alreadyUsedAssetKeys set', () => {
    const used = new Set();
    selectTopCandidates([photo()], 1, { kind: 'photo', alreadyUsedAssetKeys: used });
    expect(used.size).toBe(0);
  });
});
