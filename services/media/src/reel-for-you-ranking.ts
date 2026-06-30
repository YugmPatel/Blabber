export const REEL_FOR_YOU_RANKING_MODEL_VERSION = 'reel_for_you_v1';
export const REEL_FOR_YOU_PAGE_LIMIT = 20;
export const REEL_FOR_YOU_SESSION_TTL_MS = 10 * 60 * 1000;
export const REEL_FOR_YOU_CANDIDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const REEL_FOR_YOU_RECENT_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const REEL_FOR_YOU_RECENT_OPEN_SUPPRESS_MS = 24 * 60 * 60 * 1000;
export const REEL_FOR_YOU_MAX_CANDIDATES = 500;
export const REEL_FOR_YOU_AFFINITY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const REEL_FOR_YOU_WEIGHTS = {
  followedCreator: 40,
  followedTopic: 18,
  followedTopicMax: 36,
  creatorAffinityMax: 30,
  topicAffinityMax: 36,
  recentPositiveMax: 20,
  freshnessMax: 24,
  newCreator: 8,
  recentSeenPenalty: -40,
  quickSkipPenalty: -35,
  communityTopicMax: 12,
} as const;

export const REEL_AFFINITY_SIGNAL_WEIGHTS: Record<string, { creator: number; topic: number }> = {
  reel_open: { creator: 3, topic: 2 },
  reel_watch_bucket: { creator: 0, topic: 0 },
  reel_completion_bucket: { creator: 0, topic: 0 },
  reel_quick_skip: { creator: 0, topic: 0 },
  react_to_discoverable_reel: { creator: 6, topic: 4 },
  comment_on_discoverable_reel: { creator: 10, topic: 8 },
  save_discoverable_reel: { creator: 12, topic: 10 },
} as const;

export const REEL_WATCH_AFFINITY_WEIGHTS: Record<string, { creator: number; topic: number }> = {
  under_3_seconds: { creator: 0, topic: 0 },
  '3_to_10_seconds': { creator: 2, topic: 2 },
  '10_to_30_seconds': { creator: 5, topic: 4 },
  '30_to_60_seconds': { creator: 8, topic: 6 },
  over_60_seconds: { creator: 10, topic: 8 },
};

export const REEL_COMPLETION_AFFINITY_WEIGHTS: Record<string, { creator: number; topic: number }> = {
  under_25_percent: { creator: 0, topic: 0 },
  '25_to_50_percent': { creator: 2, topic: 2 },
  '50_to_75_percent': { creator: 5, topic: 4 },
  '75_to_95_percent': { creator: 8, topic: 6 },
  over_95_percent: { creator: 10, topic: 8 },
};

export const REEL_FOR_YOU_EXPLANATION_TEXT: Record<string, string> = {
  followed_creator: 'Because you follow this creator.',
  followed_topic: 'Because you follow this topic.',
  creator_affinity: 'Based on your interest in this creator.',
  topic_affinity: 'Based on your interest in this topic.',
  fresh_topic_reel: 'New in this topic.',
  new_public_reel: 'New public Reel.',
  latest_public_reel: 'Personalized discovery is off. You are seeing the latest public Reels.',
};

export function clampReelAffinityScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function reelFreshnessScore(publishedAt: Date, now = new Date()) {
  const ageHours = Math.max(0, now.getTime() - publishedAt.getTime()) / (60 * 60 * 1000);
  if (ageHours <= 24) return REEL_FOR_YOU_WEIGHTS.freshnessMax;
  if (ageHours <= 72) return Math.round(REEL_FOR_YOU_WEIGHTS.freshnessMax * 0.7);
  if (ageHours <= 168) return Math.round(REEL_FOR_YOU_WEIGHTS.freshnessMax * 0.4);
  if (ageHours <= 720) return Math.round(REEL_FOR_YOU_WEIGHTS.freshnessMax * 0.15);
  return 0;
}
