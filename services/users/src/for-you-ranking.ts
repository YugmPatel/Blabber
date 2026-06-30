export const FOR_YOU_RANKING_MODEL_VERSION = 'for_you_v1';
export const FOR_YOU_PAGE_LIMIT = 20;
export const FOR_YOU_SESSION_TTL_MS = 10 * 60 * 1000;
export const FOR_YOU_CANDIDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const FOR_YOU_RECENT_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const FOR_YOU_RECENT_OPEN_PENALTY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FOR_YOU_MAX_CANDIDATES = 500;
export const FOR_YOU_AFFINITY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const FOR_YOU_WEIGHTS = {
  followedCreator: 40,
  followedTopic: 18,
  followedTopicMax: 36,
  creatorAffinityMax: 30,
  topicAffinity: 18,
  topicAffinityMax: 36,
  recentPositiveMax: 20,
  freshnessMax: 24,
  newCreator: 8,
  recentSeenPenalty: -40,
} as const;

export const FOR_YOU_AFFINITY_SIGNAL_WEIGHTS: Record<string, { creator: number; topic: number }> = {
  discover_post_open: { creator: 4, topic: 3 },
  discover_post_dwell: { creator: 0, topic: 0 },
  react_to_discoverable_post: { creator: 6, topic: 4 },
  comment_on_discoverable_post: { creator: 10, topic: 8 },
  discover_creator_open: { creator: 3, topic: 0 },
  discover_topic_open: { creator: 0, topic: 2 },
  follow_topic: { creator: 0, topic: 12 },
} as const;

export const FOR_YOU_DWELL_AFFINITY_WEIGHTS: Record<string, { creator: number; topic: number }> = {
  under_3_seconds: { creator: 0, topic: 0 },
  '3_to_10_seconds': { creator: 2, topic: 2 },
  '10_to_30_seconds': { creator: 6, topic: 5 },
  over_30_seconds: { creator: 10, topic: 8 },
} as const;

export function freshnessScore(createdAt: Date, now = new Date()) {
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 24) return FOR_YOU_WEIGHTS.freshnessMax;
  if (ageHours <= 72) return Math.round(FOR_YOU_WEIGHTS.freshnessMax * 0.7);
  if (ageHours <= 168) return Math.round(FOR_YOU_WEIGHTS.freshnessMax * 0.4);
  if (ageHours <= 720) return Math.round(FOR_YOU_WEIGHTS.freshnessMax * 0.15);
  return 0;
}

export function clampAffinityScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}
