// Builds the full, deterministic content plan for the beta content seed
// system: which accounts, topics, posts, reels, comments, reactions, and
// follow edges to create. Nothing here touches the network or a database —
// it's pure data transformation over accounts.mjs/topics.mjs/copy.mjs, which
// makes the whole plan independently unit-testable and reproducible (no
// randomness — every "varying" count below is a deterministic function of
// its index, not Math.random()).

import { DEMO_ACCOUNTS } from './accounts.mjs';
import { BETA_TOPICS } from './topics.mjs';
import { captionsForTopic, COMMENTS_POOL } from './copy.mjs';
import { REEL_CATEGORY_TARGETS, REQUIRED_INVENTORY } from './config.mjs';
import { seedKeyFor } from './seed-keys.mjs';

const POSTS_PER_TOPIC = REQUIRED_INVENTORY.feedPosts / REQUIRED_INVENTORY.discoverTopics; // 6

export const BLABBER_ONBOARDING_CARDS = [
  {
    title: 'Welcome to Blabber Beta',
    caption: 'Start with message requests, groups, and safer conversations.',
  },
  {
    title: 'Message Requests',
    caption: 'New conversations start with a request, so you stay in control.',
  },
  {
    title: 'Temporary Groups',
    caption: 'Create a group for a plan, event, project, or short-term conversation.',
  },
  {
    title: 'Catch Me Up',
    caption: 'Missed a conversation? Let Blabber help summarize what changed.',
  },
  {
    title: 'Safety Controls',
    caption: 'Block, report, and message request controls help keep conversations safer.',
  },
];

const REEL_CATEGORY_PLAN = [
  { category: 'onboarding', count: REEL_CATEGORY_TARGETS.onboarding, eligibleHandles: ['blabber'], topicSlug: 'blabber_tips' },
  { category: 'campus', count: REEL_CATEGORY_TARGETS.campus, eligibleHandles: ['campusdaily'], topicSlug: 'campus_life' },
  { category: 'tech', count: REEL_CATEGORY_TARGETS.tech, eligibleHandles: ['techbytes', 'startupnotes', 'designlab'], topicSlug: 'tech_ai' },
  { category: 'food', count: REEL_CATEGORY_TARGETS.food, eligibleHandles: ['foodfinds'], topicSlug: 'food_cafes' },
  { category: 'travel', count: REEL_CATEGORY_TARGETS.travel, eligibleHandles: ['travelcircle'], topicSlug: 'travel' },
  { category: 'productivity', count: REEL_CATEGORY_TARGETS.productivity, eligibleHandles: ['studyhub'], topicSlug: 'study_productivity' },
  { category: 'events', count: REEL_CATEGORY_TARGETS.events, eligibleHandles: ['sanjoseevents'], topicSlug: 'events' },
];

export function buildAccountPlan() {
  return DEMO_ACCOUNTS.map((account) => ({
    ...account,
    seedKey: seedKeyFor('user', account.handle),
    identityAssets: {
      avatar: {
        seedKey: seedKeyFor('avatar', account.handle),
        source: 'generated',
        initials: account.name
          .split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
      },
    },
  }));
}

export function buildTopicPlan() {
  return BETA_TOPICS.map((topic) => ({
    ...topic,
    seedKey: seedKeyFor('topic', topic.slug),
  }));
}

/**
 * For each of the 10 topics, finds every account whose accounts.mjs
 * topicSlugs includes it, then round-robins POSTS_PER_TOPIC (6) post slots
 * across those eligible accounts — so every topic gets exactly 6 posts (well
 * inside the 4-8 target range) and every account's posts stay thematically
 * relevant to accounts it actually claims. Falls back to all accounts if a
 * topic somehow has no eligible author, so buildPostPlan can never silently
 * produce fewer than POSTS_PER_TOPIC * topics.length posts.
 */
export function buildPostPlan() {
  const accounts = buildAccountPlan();
  const topics = buildTopicPlan();
  const perAuthorCounter = new Map();
  const posts = [];

  for (const topic of topics) {
    const eligible = accounts.filter((account) => account.topicSlugs.includes(topic.slug));
    const authors = eligible.length > 0 ? eligible : accounts;
    const captions = captionsForTopic(topic.slug);

    for (let slot = 0; slot < POSTS_PER_TOPIC; slot += 1) {
      const author = authors[slot % authors.length];
      const authorIndex = perAuthorCounter.get(author.handle) || 0;
      perAuthorCounter.set(author.handle, authorIndex + 1);

      posts.push({
        seedKey: seedKeyFor('post', author.handle, authorIndex),
        authorHandle: author.handle,
        topicSlug: topic.slug,
        searchQuery: topic.searchQueries[slot % topic.searchQueries.length],
        caption: captions[slot % captions.length],
      });
    }
  }

  let cardIndex = 0;
  for (const post of posts) {
    if (post.authorHandle !== 'blabber' || post.topicSlug !== 'blabber_tips') continue;
    const card = BLABBER_ONBOARDING_CARDS[cardIndex];
    if (!card) break;
    post.searchQuery = `blabber onboarding ${card.title.toLowerCase()}`;
    post.caption = card.caption;
    post.localAsset = {
      type: 'branded-card',
      source: 'generated',
      title: card.title,
      seedKey: seedKeyFor('card', 'blabber', cardIndex),
    };
    cardIndex += 1;
  }

  return posts;
}

/**
 * Splits 30 reels across the 7 categories per REEL_CATEGORY_TARGETS
 * (5/5/5/4/4/4/3), round-robining authorship across each category's
 * eligible accounts the same way buildPostPlan does for posts.
 */
export function buildReelPlan() {
  const accounts = buildAccountPlan();
  const perAuthorCounter = new Map();
  const reels = [];

  for (const entry of REEL_CATEGORY_PLAN) {
    const topic = BETA_TOPICS.find((candidate) => candidate.slug === entry.topicSlug);
    const authors = entry.eligibleHandles.map((handle) => accounts.find((account) => account.handle === handle));
    const captions = captionsForTopic(entry.topicSlug);

    for (let slot = 0; slot < entry.count; slot += 1) {
      const author = authors[slot % authors.length];
      const authorIndex = perAuthorCounter.get(author.handle) || 0;
      perAuthorCounter.set(author.handle, authorIndex + 1);

      reels.push({
        seedKey: seedKeyFor('reel', author.handle, authorIndex),
        authorHandle: author.handle,
        category: entry.category,
        topicSlug: entry.topicSlug,
        searchQuery: topic.searchQueries[slot % topic.searchQueries.length],
        caption: captions[slot % captions.length],
      });
    }
  }

  return reels;
}

/**
 * Comments roughly every 2-3rd content item (not every one — see task's
 * "avoid identical counts everywhere"), targeting the middle of the
 * required 25-40 range. Commenter is always someone other than the content
 * author, chosen round-robin from the remaining 9 accounts.
 */
export function buildCommentPlan(posts, reels, accounts = buildAccountPlan()) {
  const items = [...posts.map((post) => ({ ...post, kind: 'post' })), ...reels.map((reel) => ({ ...reel, kind: 'reel' }))];
  const targetCount = Math.round((REQUIRED_INVENTORY.commentsMin + REQUIRED_INVENTORY.commentsMax) / 2); // ~33
  const step = Math.max(1, Math.floor(items.length / targetCount));
  const perCommenterCounter = new Map();
  const comments = [];

  for (let i = 0; i < items.length && comments.length < targetCount; i += step) {
    const item = items[i];
    const others = accounts.filter((account) => account.handle !== item.authorHandle);
    const commenter = others[comments.length % others.length];
    const authorIndex = perCommenterCounter.get(commenter.handle) || 0;
    perCommenterCounter.set(commenter.handle, authorIndex + 1);

    comments.push({
      seedKey: seedKeyFor('comment', commenter.handle, authorIndex),
      commenterHandle: commenter.handle,
      targetKind: item.kind,
      targetSeedKey: item.seedKey,
      body: COMMENTS_POOL[comments.length % COMMENTS_POOL.length],
    });
  }

  return comments;
}

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙌'];

/**
 * Deterministic string -> [0,1) hash (not Math.random — must be reproducible
 * across runs for idempotency/testability).
 */
function pseudoRandomUnit(seedKey) {
  let hash = 0;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/**
 * Per-item reaction count within [min, max] (posts: 0-8, reels: 1-12, per
 * the task), but skewed so most items land low and only a few "popular"
 * items reach the top of the range — mirroring the task's real requirement,
 * which is an *aggregate* total of 80-150 reactions across all ~90 pieces of
 * content, not every item independently hitting its per-item ceiling.
 */
function reactionCountFor(item, min, max) {
  const roll = pseudoRandomUnit(item.seedKey);
  if (roll < 0.55) return min; // quiet majority
  if (roll < 0.85) return Math.min(min + 2, max); // modest engagement
  if (roll < 0.97) return Math.min(min + 4, max); // solidly liked
  return max; // occasional standout
}

/**
 * Reactors are always someone other than the item's own author.
 */
export function buildReactionPlan(posts, reels, accounts = buildAccountPlan()) {
  const reactions = [];

  const planFor = (items, kind, min, max) => {
    items.forEach((item, index) => {
      const count = reactionCountFor(item, min, max);
      const others = accounts.filter((account) => account.handle !== item.authorHandle);
      for (let r = 0; r < Math.min(count, others.length); r += 1) {
        const reactor = others[r % others.length];
        reactions.push({
          seedKey: seedKeyFor('reaction', reactor.handle, `${kind}-${item.seedKey}`),
          reactorHandle: reactor.handle,
          targetKind: kind,
          targetSeedKey: item.seedKey,
          emoji: REACTION_EMOJIS[(index + r) % REACTION_EMOJIS.length],
        });
      }
    });
  };

  planFor(posts, 'post', 0, 8);
  planFor(reels, 'reel', 1, 12);
  return reactions;
}

/**
 * Each account follows a deterministic 3-6 other accounts (the next N in
 * circular order, N varying by index so it isn't identical everywhere), then
 * @blabber is force-included in every account's follow set — swapping out an
 * arbitrary non-blabber follow if the set is already at its cap of 6, so the
 * "followed by all" requirement never pushes anyone over the stated range.
 */
export function buildFollowPlan(accounts = buildAccountPlan()) {
  const follows = [];
  const handles = accounts.map((account) => account.handle);

  for (let i = 0; i < handles.length; i += 1) {
    const follower = handles[i];
    const followCount = 3 + (i % 4); // 3,4,5,6,3,4,5,6,...
    const targets = new Set();
    for (let offset = 1; targets.size < followCount; offset += 1) {
      const target = handles[(i + offset) % handles.length];
      if (target !== follower) targets.add(target);
      if (offset > handles.length) break; // safety valve, never loops forever
    }

    if (follower !== 'blabber' && !targets.has('blabber')) {
      if (targets.size >= 6) {
        const [firstOther] = targets;
        targets.delete(firstOther);
      }
      targets.add('blabber');
    }

    for (const target of targets) {
      follows.push({
        seedKey: seedKeyFor('follow', follower, target),
        followerHandle: follower,
        targetHandle: target,
      });
    }
  }

  return follows;
}

export function buildContentPlan() {
  const accounts = buildAccountPlan();
  const topics = buildTopicPlan();
  const posts = buildPostPlan();
  const reels = buildReelPlan();
  const comments = buildCommentPlan(posts, reels, accounts);
  const reactions = buildReactionPlan(posts, reels, accounts);
  const follows = buildFollowPlan(accounts);

  return { accounts, topics, posts, reels, comments, reactions, follows };
}

export { REEL_CATEGORY_PLAN, POSTS_PER_TOPIC };
