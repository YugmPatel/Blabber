import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { connectToDatabase, closeDatabase, getDatabase } from './db';
import { serializeChat } from './serialize-chat';
import type { Chat } from './models/chat';

describe('serializeChat participant display', () => {
  beforeEach(async () => {
    await connectToDatabase();
    await getDatabase().collection('users').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('prefers name, falls back to username then email, and always exposes username for @handle display', async () => {
    const withName = new ObjectId();
    const usernameOnly = new ObjectId();
    const emailOnly = new ObjectId();
    const now = new Date();

    await getDatabase().collection('users').insertMany([
      { _id: withName, name: 'Alice Example', username: 'alice', email: 'alice@example.com' },
      { _id: usernameOnly, username: 'bobby', email: 'bob@example.com' },
      { _id: emailOnly, email: 'nobody@example.com' },
    ]);

    const chat: Chat = {
      _id: new ObjectId(),
      type: 'group',
      participants: [withName, usernameOnly, emailOnly],
      admins: [withName],
      title: 'Test Group',
      createdAt: now,
      updatedAt: now,
    };

    const serialized = await serializeChat(chat, { includeParticipants: true });
    const byId = new Map(serialized.participantProfiles.map((profile: any) => [profile._id, profile]));

    // Display name prefers name > username > email, but username is still
    // carried separately so the frontend can render "@handle" alongside it
    // instead of falling back to showing a raw email as the primary label.
    expect(byId.get(withName.toString())).toMatchObject({
      name: 'Alice Example',
      username: 'alice',
      email: 'alice@example.com',
    });
    expect(byId.get(usernameOnly.toString())).toMatchObject({
      name: 'bobby',
      username: 'bobby',
      email: 'bob@example.com',
    });
    expect(byId.get(emailOnly.toString())).toMatchObject({
      name: 'nobody@example.com',
      email: 'nobody@example.com',
    });
  });
});
