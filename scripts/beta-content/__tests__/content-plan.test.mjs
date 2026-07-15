import { describe, expect, it } from 'vitest';
import {
  BLABBER_ONBOARDING_CARDS,
  buildAccountPlan,
  buildCommentPlan,
  buildContentPlan,
  buildFollowPlan,
  buildPostPlan,
  buildReactionPlan,
  buildReelPlan,
  buildTopicPlan,
} from '../content-plan.mjs';
import { REEL_CATEGORY_TARGETS, REQUIRED_INVENTORY } from '../config.mjs';

describe('buildAccountPlan / buildTopicPlan', () => {
  it('produces exactly the required number of demo accounts and Discover topics', () => {
    expect(buildAccountPlan()).toHaveLength(REQUIRED_INVENTORY.demoAccounts);
    expect(buildTopicPlan()).toHaveLength(REQUIRED_INVENTORY.discoverTopics);
  });

  it('every account has a handle, display name, bio, and at least one topic', () => {
    for (const account of buildAccountPlan()) {
      expect(account.handle).toMatch(/^[a-z0-9]+$/);
      expect(account.name.length).toBeGreaterThan(0);
      expect(account.bio.length).toBeGreaterThan(0);
      expect(account.topicSlugs.length).toBeGreaterThan(0);
      expect(account.seedKey).toBe(`beta-user-${account.handle}`);
    }
  });

  it('every topic has a title, slug, and description (thumbnail/cover content comes from its linked posts)', () => {
    for (const topic of buildTopicPlan()) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.slug).toMatch(/^[a-z_]+$/);
      expect(topic.description.length).toBeGreaterThan(0);
      expect(topic.seedKey).toBe(`beta-topic-${topic.slug.replace(/_/g, '-')}`);
    }
  });
});

describe('buildPostPlan', () => {
  const posts = buildPostPlan();

  it('produces exactly 60 posts', () => {
    expect(posts).toHaveLength(REQUIRED_INVENTORY.feedPosts);
  });

  it('every one of the 10 topics has between 4 and 8 linked posts (no empty topic pages)', () => {
    const counts = {};
    for (const post of posts) counts[post.topicSlug] = (counts[post.topicSlug] || 0) + 1;
    const topicSlugs = buildTopicPlan().map((topic) => topic.slug);
    expect(Object.keys(counts).sort()).toEqual([...topicSlugs].sort());
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(8);
    }
  });

  it('includes five deterministic @blabber onboarding generated image posts inside the 60-post plan', () => {
    const cards = posts.filter((post) => post.authorHandle === 'blabber' && post.localAsset?.type === 'branded-card');
    expect(cards).toHaveLength(5);
    expect(cards.map((post) => post.localAsset.title)).toEqual(BLABBER_ONBOARDING_CARDS.map((card) => card.title));
    expect(cards.map((post) => post.caption)).toEqual(BLABBER_ONBOARDING_CARDS.map((card) => card.caption));
    expect(posts).toHaveLength(REQUIRED_INVENTORY.feedPosts);
  });

  it('every post has a unique seedKey', () => {
    const seedKeys = posts.map((post) => post.seedKey);
    expect(new Set(seedKeys).size).toBe(seedKeys.length);
  });

  it('only assigns an author to a topic they actually claim in accounts.mjs', () => {
    const accounts = buildAccountPlan();
    const accountsByHandle = new Map(accounts.map((account) => [account.handle, account]));
    for (const post of posts) {
      const author = accountsByHandle.get(post.authorHandle);
      expect(author.topicSlugs).toContain(post.topicSlug);
    }
  });

  it('is deterministic — building the plan twice gives an identical result', () => {
    expect(buildPostPlan()).toEqual(buildPostPlan());
  });
});

describe('demo account identity assets', () => {
  it('adds deterministic generated avatar specs for all demo accounts', () => {
    const accounts = buildAccountPlan();
    expect(accounts).toHaveLength(10);
    for (const account of accounts) {
      expect(account.identityAssets.avatar.seedKey).toBe(`beta-avatar-${account.handle}`);
      expect(account.identityAssets.avatar.source).toBe('generated');
      expect(account.identityAssets.avatar.initials).toMatch(/^[A-Z]{1,2}$/);
    }
  });
});

describe('buildReelPlan', () => {
  const reels = buildReelPlan();

  it('produces exactly 30 reels, split into the exact category targets', () => {
    expect(reels).toHaveLength(REQUIRED_INVENTORY.reels);
    const counts = {};
    for (const reel of reels) counts[reel.category] = (counts[reel.category] || 0) + 1;
    expect(counts).toEqual(REEL_CATEGORY_TARGETS);
  });

  it('every reel has a unique seedKey', () => {
    const seedKeys = reels.map((reel) => reel.seedKey);
    expect(new Set(seedKeys).size).toBe(seedKeys.length);
  });

  it('is deterministic', () => {
    expect(buildReelPlan()).toEqual(buildReelPlan());
  });
});

describe('buildCommentPlan', () => {
  it('produces a count within the required 25-40 range', () => {
    const comments = buildCommentPlan(buildPostPlan(), buildReelPlan());
    expect(comments.length).toBeGreaterThanOrEqual(REQUIRED_INVENTORY.commentsMin);
    expect(comments.length).toBeLessThanOrEqual(REQUIRED_INVENTORY.commentsMax);
  });

  it('never has a commenter comment on their own content', () => {
    const posts = buildPostPlan();
    const reels = buildReelPlan();
    const byKey = new Map([...posts, ...reels].map((item) => [item.seedKey, item]));
    const comments = buildCommentPlan(posts, reels);
    for (const comment of comments) {
      const target = byKey.get(comment.targetSeedKey);
      expect(comment.commenterHandle).not.toBe(target.authorHandle);
    }
  });

  it('does not comment on every single post/reel (natural, not exhaustive coverage)', () => {
    const posts = buildPostPlan();
    const reels = buildReelPlan();
    const comments = buildCommentPlan(posts, reels);
    expect(comments.length).toBeLessThan(posts.length + reels.length);
  });
});

describe('buildReactionPlan', () => {
  it('produces an aggregate total within the required 80-150 range', () => {
    const reactions = buildReactionPlan(buildPostPlan(), buildReelPlan());
    expect(reactions.length).toBeGreaterThanOrEqual(REQUIRED_INVENTORY.reactionsMin);
    expect(reactions.length).toBeLessThanOrEqual(REQUIRED_INVENTORY.reactionsMax);
  });

  it('never has a reactor react to their own content', () => {
    const posts = buildPostPlan();
    const reels = buildReelPlan();
    const byKey = new Map([...posts, ...reels].map((item) => [item.seedKey, item]));
    const reactions = buildReactionPlan(posts, reels);
    for (const reaction of reactions) {
      const target = byKey.get(reaction.targetSeedKey);
      expect(reaction.reactorHandle).not.toBe(target.authorHandle);
    }
  });

  it('does not give every post/reel an identical reaction count (avoid identical counts everywhere)', () => {
    const posts = buildPostPlan();
    const reels = buildReelPlan();
    const reactions = buildReactionPlan(posts, reels);
    const countsByTarget = new Map();
    for (const reaction of reactions) {
      countsByTarget.set(reaction.targetSeedKey, (countsByTarget.get(reaction.targetSeedKey) || 0) + 1);
    }
    const distinctCounts = new Set(countsByTarget.values());
    expect(distinctCounts.size).toBeGreaterThan(1);
  });
});

describe('buildFollowPlan', () => {
  const follows = buildFollowPlan();

  it('gives every account between 3 and 6 follows', () => {
    const counts = {};
    for (const follow of follows) counts[follow.followerHandle] = (counts[follow.followerHandle] || 0) + 1;
    for (const account of buildAccountPlan()) {
      const count = counts[account.handle] || 0;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(6);
    }
  });

  it('has @blabber followed by every other demo account', () => {
    const blabberFollowers = follows.filter((follow) => follow.targetHandle === 'blabber').map((follow) => follow.followerHandle);
    const otherHandles = buildAccountPlan()
      .map((account) => account.handle)
      .filter((handle) => handle !== 'blabber');
    expect(new Set(blabberFollowers)).toEqual(new Set(otherHandles));
  });

  it('never has an account follow itself', () => {
    for (const follow of follows) {
      expect(follow.followerHandle).not.toBe(follow.targetHandle);
    }
  });

  it('has no duplicate follow edges', () => {
    const keys = follows.map((follow) => `${follow.followerHandle}->${follow.targetHandle}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildContentPlan (idempotency / no-duplicate-records)', () => {
  it('every seedKey across the entire plan is globally unique', () => {
    const plan = buildContentPlan();
    const allSeedKeys = [
      ...plan.accounts,
      ...plan.topics,
      ...plan.posts,
      ...plan.reels,
      ...plan.comments,
      ...plan.reactions,
      ...plan.follows,
    ].map((item) => item.seedKey);
    expect(new Set(allSeedKeys).size).toBe(allSeedKeys.length);
  });

  it('is fully deterministic end-to-end — running it twice (as re-running the seed script would) yields an identical plan', () => {
    expect(buildContentPlan()).toEqual(buildContentPlan());
  });
});
