import { describe, expect, it } from 'vitest';
import { BETA_TOPICS, topicBySlug } from '../topics.mjs';

const EXPECTED_TITLES = [
  'Blabber Tips',
  'Campus Life',
  'Tech & AI',
  'Startups',
  'Food & Cafes',
  'San Jose',
  'Travel',
  'Study & Productivity',
  'Events',
  'Housing & Roommates',
];

describe('BETA_TOPICS', () => {
  it('has exactly the 10 topic titles specified in the task', () => {
    expect(BETA_TOPICS.map((topic) => topic.title)).toEqual(EXPECTED_TITLES);
  });

  it('every topic has a title, slug, description, and at least one search query for sourcing content', () => {
    for (const topic of BETA_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.slug).toMatch(/^[a-z_]+$/);
      expect(topic.description.length).toBeGreaterThan(0);
      expect(topic.searchQueries.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate slugs', () => {
    const slugs = BETA_TOPICS.map((topic) => topic.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('topicBySlug', () => {
  it('looks up a known topic', () => {
    expect(topicBySlug('tech_ai').title).toBe('Tech & AI');
  });

  it('throws a clear error for an unknown slug', () => {
    expect(() => topicBySlug('not-a-real-topic')).toThrow(/Unknown beta topic slug/);
  });
});
