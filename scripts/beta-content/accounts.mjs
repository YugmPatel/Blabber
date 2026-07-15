// The 10 demo/public/community-style Blabber accounts. These are meant to
// read as brand/community accounts (like a company or club account), not as
// fake private individuals — see each bio and DEMO_ACCOUNTS.md notes in the
// beta-content README for the product reasoning.

export const DEMO_ACCOUNTS = [
  {
    handle: 'blabber',
    name: 'Blabber',
    bio: 'Official updates, beta tips, privacy notes, and feature guides.',
    topicSlugs: ['blabber_tips'],
  },
  {
    handle: 'campusdaily',
    name: 'Campus Daily',
    bio: 'Campus life, student tips, events, and useful local finds.',
    topicSlugs: ['campus_life', 'san_jose'],
  },
  {
    handle: 'studyhub',
    name: 'Study Hub',
    bio: 'Productivity, study spots, academic routines, and focus tips.',
    topicSlugs: ['study_productivity'],
  },
  {
    handle: 'techbytes',
    name: 'Tech Bytes',
    bio: 'AI, software, startups, and product-building notes.',
    topicSlugs: ['tech_ai'],
  },
  {
    handle: 'startupnotes',
    name: 'Startup Notes',
    bio: 'Founder lessons, product thinking, and build-in-public ideas.',
    topicSlugs: ['startups', 'tech_ai'],
  },
  {
    handle: 'foodfinds',
    name: 'Food Finds',
    bio: 'Vegetarian-friendly food, cafes, and weekend eats.',
    topicSlugs: ['food_cafes'],
  },
  {
    handle: 'sanjoseevents',
    name: 'San Jose Events',
    bio: 'Things to do, local events, meetups, and community plans.',
    topicSlugs: ['events', 'san_jose'],
  },
  {
    handle: 'travelcircle',
    name: 'Travel Circle',
    bio: 'City walks, short trips, scenic places, and travel inspiration.',
    topicSlugs: ['travel'],
  },
  {
    handle: 'designlab',
    name: 'Design Lab',
    bio: 'UI inspiration, product design, creative systems, and visual ideas.',
    topicSlugs: ['tech_ai', 'startups'],
  },
  {
    handle: 'housinghelp',
    name: 'Housing Help',
    bio: 'Move-in tips, roommate planning, apartment checklists, and student housing notes.',
    topicSlugs: ['housing_roommates', 'campus_life'],
  },
];

export function accountByHandle(handle) {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.handle === handle);
  if (!account) throw new Error(`Unknown demo account handle: ${handle}`);
  return account;
}
