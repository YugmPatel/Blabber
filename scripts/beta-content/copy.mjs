// Realistic caption/comment copy banks, organized by topic slug (see
// topics.mjs). Deliberately not lorem-ipsum, not cringe-influencer-voiced,
// and free of claims about real events, medical/financial/political content,
// or real-person impersonation — see the task's content-safety requirements.
// Each pool is long enough that content-plan.mjs can round-robin through it
// without every post/comment being identical.

export const CAPTIONS_BY_TOPIC = {
  blabber_tips: [
    'What feature should we improve first in Blabber beta?',
    'Message requests help keep new conversations safer.',
    'Product tip: empty states matter more than most teams think.',
    'Temporary groups are great for one-off trip planning — they clean themselves up.',
    'New in beta: read receipts and durable sends across the whole app.',
    'Tap and hold a message to react, reply, or forward it.',
  ],
  campus_life: [
    'Best quiet spot on campus for a two-hour study block?',
    'Campus tip: the library second floor empties out after 6pm.',
    'Group project season is here — temporary groups make this so much easier.',
    'Walking between classes hits different with the right playlist.',
    'What campus event are you most looking forward to this month?',
    'Free printing, fast wifi, decent coffee — that combo is rare on campus.',
  ],
  tech_ai: [
    'AI is only as useful as the workflow you plug it into.',
    'Small, boring engineering decisions save the most time later.',
    'What tool changed how you build software this year?',
    'Shipping beats polishing when you are still learning what users want.',
    'The best AI features are the ones users never notice are AI.',
    'Code review tip: leave the nitpicks for a follow-up comment, not the blocker.',
  ],
  startups: [
    'Founder lesson: talk to ten users before you build ten features.',
    'Build in public update: slower than planned, further than last month.',
    'The hardest part of an early product is deciding what to leave out.',
    'A good onboarding flow is a product decision, not a design afterthought.',
    'Early traction is noisy. Retention is the signal that matters.',
    'What is one metric you stopped tracking because it stopped mattering?',
  ],
  food_cafes: [
    'Best study session setup: one playlist, one goal, one break timer.',
    'Vegetarian-friendly spot recommendations always welcome.',
    'Weekend plan idea: coffee, a short walk, and one good conversation.',
    'The right cafe has good light, better coffee, and quiet corners.',
    'Sunday meal prep is basically a productivity hack in disguise.',
    'What is your go-to order when you just need to focus for a few hours?',
  ],
  san_jose: [
    'Underrated spot in San Jose you would recommend to a newcomer?',
    'Silicon Valley moves fast, but a good walk downtown slows things down.',
    'Looking for weekend plans that do not involve a screen.',
    'San Jose weather in one photo: perfect for an outdoor afternoon.',
    'What is one San Jose meetup worth showing up to regularly?',
    'Local find: a spot that is quiet enough to actually get work done.',
  ],
  travel: [
    'A short trip resets more than a long weekend of scrolling ever will.',
    'Best travel tip: pack less, plan less, notice more.',
    'Scenic views hit different when you are not rushing to the next stop.',
    'What is the last place that genuinely surprised you?',
    'Sometimes the best part of a trip is the walk with no destination.',
    'Weekend getaway idea: somewhere close enough to not need a flight.',
  ],
  study_productivity: [
    'Best study session setup: one playlist, one goal, one break timer.',
    'Two-minute rule: if it takes less than two minutes, just do it now.',
    'A clean desk is not about aesthetics, it is about fewer decisions.',
    'Finals week tip: study in blocks, not marathons.',
    'What productivity habit actually stuck for you this year?',
    'Time-blocking beats a to-do list that never gets shorter.',
  ],
  events: [
    'What event should we all show up to this month?',
    'Group plans are easier when everyone can see the same thread.',
    'Meetups are better in small groups — easier to actually talk.',
    'Planning a get-together? A temporary group keeps the chat from cluttering up later.',
    'What is one event type you wish happened more often around here?',
    'RSVP culture: a simple yes/no saves everyone a lot of back-and-forth.',
  ],
  housing_roommates: [
    'Roommate tip: agree on quiet hours before move-in day, not after.',
    'Moving checklist: label boxes by room, not by what is inside them.',
    'What is one apartment-hunting lesson you learned the hard way?',
    'Shared spaces work best with one shared calendar, not four separate ones.',
    'First apartment tip: measure the doorways before buying furniture.',
    'A good roommate agreement is short, specific, and written down.',
  ],
};

export const COMMENTS_POOL = [
  'This is actually useful.',
  'Need this for group projects.',
  'Saving this for later.',
  'The temporary group idea is underrated.',
  'This would help during finals week.',
  'Good point, hadn’t thought about it that way.',
  'Bookmarking this.',
  'Same experience here, honestly.',
  'This is exactly what I needed today.',
  'Sharing this with my group chat.',
  'Underrated tip.',
  'Following for more like this.',
  'This tracks.',
  'Solid recommendation.',
  'Adding this to my list.',
];

export function captionsForTopic(topicSlug) {
  return CAPTIONS_BY_TOPIC[topicSlug] || CAPTIONS_BY_TOPIC.blabber_tips;
}
