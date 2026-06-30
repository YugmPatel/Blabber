export const DISCOVERY_TOPICS = [
  { id: 'technology', label: 'Technology' },
  { id: 'artificial_intelligence', label: 'Artificial Intelligence' },
  { id: 'software_engineering', label: 'Software Engineering' },
  { id: 'startups', label: 'Startups' },
  { id: 'business', label: 'Business' },
  { id: 'finance', label: 'Finance' },
  { id: 'education', label: 'Education' },
  { id: 'careers', label: 'Careers' },
  { id: 'design', label: 'Design' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'sports', label: 'Sports' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'photography', label: 'Photography' },
  { id: 'music', label: 'Music' },
  { id: 'movies_tv', label: 'Movies and TV' },
  { id: 'books', label: 'Books' },
  { id: 'art', label: 'Art' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'science', label: 'Science' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'home_lifestyle', label: 'Home and Lifestyle' },
  { id: 'pets', label: 'Pets' },
  { id: 'comedy', label: 'Comedy' },
] as const;

export type DiscoveryTopicId = (typeof DISCOVERY_TOPICS)[number]['id'];

const TOPIC_IDS = new Set<string>(DISCOVERY_TOPICS.map((topic) => topic.id));

export function isDiscoveryTopicId(value: unknown): value is DiscoveryTopicId {
  return typeof value === 'string' && TOPIC_IDS.has(value);
}

export function normalizeDiscoveryTopicIds(value: unknown, min: number, max: number): DiscoveryTopicId[] {
  if (!Array.isArray(value)) throw new Error('invalid_topics');
  const topicIds = Array.from(new Set(value.map((item) => String(item || '').trim().toLowerCase())));
  if (topicIds.length < min || topicIds.length > max || topicIds.some((id) => !isDiscoveryTopicId(id))) {
    throw new Error('invalid_topics');
  }
  return topicIds as DiscoveryTopicId[];
}

export function topicLabels(topicIds: string[] = []) {
  const byId = new Map<string, string>(DISCOVERY_TOPICS.map((topic) => [topic.id, topic.label]));
  return topicIds.flatMap((id) => {
    const label = byId.get(id);
    return label ? [{ id, label }] : [];
  });
}
