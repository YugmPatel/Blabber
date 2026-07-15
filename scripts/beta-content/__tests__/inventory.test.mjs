import { describe, expect, it } from 'vitest';
import { buildInventoryReport, enforceMinimumInventory } from '../inventory.mjs';
import { buildContentPlan } from '../content-plan.mjs';

function fullyResolved(plan) {
  return {
    postResolutions: plan.posts.map((spec) => ({ spec, resolved: true, picked: { provider: 'pexels' } })),
    reelResolutions: plan.reels.map((spec) => ({ spec, resolved: true, picked: { provider: 'pexels' } })),
  };
}

describe('buildInventoryReport / enforceMinimumInventory', () => {
  it('reports ok:true and no problems when everything resolves', () => {
    const plan = buildContentPlan();
    const report = buildInventoryReport({ plan, ...fullyResolved(plan), ffmpegAvailable: true });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(() => enforceMinimumInventory(report)).not.toThrow();
  });

  it('fails with a specific message naming the missing reel categories, matching the task example format', () => {
    const plan = buildContentPlan();
    const { postResolutions, reelResolutions } = fullyResolved(plan);
    // Simulate 6 unresolved reels, all from the 'campus' and 'food' categories,
    // so exactly those two categories fall short of their targets.
    let unresolvedCount = 0;
    const degraded = reelResolutions.map((entry) => {
      if ((entry.spec.category === 'campus' || entry.spec.category === 'food') && unresolvedCount < 6) {
        unresolvedCount += 1;
        return { ...entry, resolved: false, picked: null };
      }
      return entry;
    });

    const report = buildInventoryReport({ plan, postResolutions, reelResolutions: degraded, ffmpegAvailable: true });
    expect(report.ok).toBe(false);
    expect(report.reels.missingCategories).toEqual(expect.arrayContaining(['campus', 'food']));

    let thrown;
    try {
      enforceMinimumInventory(report);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('ERROR:');
    expect(thrown.message).toContain('campus');
    expect(thrown.message).toContain('food');
  });

  it('fails when fewer than 60 posts resolve, even if every reel resolves', () => {
    const plan = buildContentPlan();
    const { reelResolutions } = fullyResolved(plan);
    const postResolutions = plan.posts.map((spec, index) => ({ spec, resolved: index < 50, picked: index < 50 ? { provider: 'pexels' } : null }));

    const report = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable: true });
    expect(report.ok).toBe(false);
    expect(report.posts.resolved).toBe(50);
    expect(() => enforceMinimumInventory(report)).toThrow(/Required 60 feed posts, only 50/);
  });

  it('flags ffmpeg unavailability as a problem only when a local fallback was actually needed', () => {
    const plan = buildContentPlan();
    const { postResolutions, reelResolutions } = fullyResolved(plan);

    const allExternal = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable: false });
    expect(allExternal.problems.some((problem) => problem.includes('ffmpeg'))).toBe(false);

    const withOneLocalFallbackNeeded = postResolutions.map((entry, index) => (index === 0 ? { ...entry, picked: null } : entry));
    const needsFallback = buildInventoryReport({ plan, postResolutions: withOneLocalFallbackNeeded, reelResolutions, ffmpegAvailable: false });
    expect(needsFallback.problems.some((problem) => problem.includes('ffmpeg'))).toBe(true);
  });

  it('enforceMinimumInventory is a no-op (does not throw) when report.ok is true', () => {
    expect(() => enforceMinimumInventory({ ok: true, problems: [] })).not.toThrow();
  });
});
