export const DISCOVERY_TOPICS = [
  { id: 'technology', label: 'Technology' },
  { id: 'artificial_intelligence', label: 'Artificial Intelligence' },
  { id: 'software_engineering', label: 'Software Engineering' },
  { id: 'startups', label: 'Startups', description: 'Founder lessons, product thinking, and build-in-public ideas.' },
  { id: 'business', label: 'Business' },
  { id: 'finance', label: 'Finance' },
  { id: 'education', label: 'Education' },
  { id: 'careers', label: 'Careers' },
  { id: 'design', label: 'Design' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'sports', label: 'Sports' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel', description: 'City walks, short trips, scenic places, and travel inspiration.' },
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
  // Beta-content additions — see scripts/beta-content/topics.mjs. These are
  // distinct from the pre-existing single-word topics above (e.g. 'startups'
  // and 'travel' are reused directly instead of duplicated) so the beta
  // content seed script has a browsable topic for each of its 10 target
  // categories without renaming or removing anything already in use.
  { id: 'blabber_tips', label: 'Blabber Tips', description: 'Official updates, beta tips, privacy notes, and feature guides.' },
  { id: 'campus_life', label: 'Campus Life', description: 'Campus life, student tips, events, and useful local finds.' },
  { id: 'tech_ai', label: 'Tech & AI', description: 'AI, software, startups, and product-building notes.' },
  { id: 'food_cafes', label: 'Food & Cafes', description: 'Vegetarian-friendly food, cafes, and weekend eats.' },
  { id: 'san_jose', label: 'San Jose', description: 'Things to do, local events, meetups, and community plans in San Jose.' },
  { id: 'study_productivity', label: 'Study & Productivity', description: 'Productivity, study spots, academic routines, and focus tips.' },
  { id: 'events', label: 'Events', description: 'Upcoming meetups, socials, and things happening around you.' },
  { id: 'housing_roommates', label: 'Housing & Roommates', description: 'Move-in tips, roommate planning, apartment checklists, and student housing notes.' },
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
