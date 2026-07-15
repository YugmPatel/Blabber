// The 10 Discover topics this batch targets. `slug` must exactly match an id
// in services/users/src/discovery-topics.ts's DISCOVERY_TOPICS array (kept
// in sync manually — see that file's "Beta-content additions" comment).
// `searchQueries` are what get sent to the stock-photo/video providers, and
// `title`/`description` are what a human sees when this content plan is
// printed in --dry-run/--report output.

export const BETA_TOPICS = [
  {
    slug: 'blabber_tips',
    title: 'Blabber Tips',
    description: 'Official updates, beta tips, privacy notes, and feature guides.',
    searchQueries: ['app onboarding screen', 'mobile app design', 'phone messaging'],
  },
  {
    slug: 'campus_life',
    title: 'Campus Life',
    description: 'Campus life, student tips, events, and useful local finds.',
    searchQueries: ['college campus', 'students walking campus', 'university library'],
  },
  {
    slug: 'tech_ai',
    title: 'Tech & AI',
    description: 'AI, software, startups, and product-building notes.',
    searchQueries: ['software developer', 'artificial intelligence technology', 'coding workspace'],
  },
  {
    slug: 'startups',
    title: 'Startups',
    description: 'Founder lessons, product thinking, and build-in-public ideas.',
    searchQueries: ['startup team meeting', 'entrepreneur working', 'team collaboration office'],
  },
  {
    slug: 'food_cafes',
    title: 'Food & Cafes',
    description: 'Vegetarian-friendly food, cafes, and weekend eats.',
    searchQueries: ['coffee shop', 'cafe food plating', 'brunch table'],
  },
  {
    slug: 'san_jose',
    title: 'San Jose',
    description: 'Things to do, local events, meetups, and community plans in San Jose.',
    searchQueries: ['san jose california', 'silicon valley city', 'downtown city street'],
  },
  {
    slug: 'travel',
    title: 'Travel',
    description: 'City walks, short trips, scenic places, and travel inspiration.',
    searchQueries: ['city travel walk', 'scenic landscape travel', 'travel landmark'],
  },
  {
    slug: 'study_productivity',
    title: 'Study & Productivity',
    description: 'Productivity, study spots, academic routines, and focus tips.',
    searchQueries: ['study desk setup', 'student studying library', 'notebook planning'],
  },
  {
    slug: 'events',
    title: 'Events',
    description: 'Upcoming meetups, socials, and things happening around you.',
    searchQueries: ['friends social event', 'community meetup', 'people at event'],
  },
  {
    slug: 'housing_roommates',
    title: 'Housing & Roommates',
    description: 'Move-in tips, roommate planning, apartment checklists, and student housing notes.',
    searchQueries: ['apartment interior', 'moving boxes apartment', 'roommates living room'],
  },
];

export function topicBySlug(slug) {
  const topic = BETA_TOPICS.find((candidate) => candidate.slug === slug);
  if (!topic) throw new Error(`Unknown beta topic slug: ${slug}`);
  return topic;
}
