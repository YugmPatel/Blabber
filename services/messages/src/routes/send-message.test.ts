import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getMessagesCollection } from '../models/message';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const TEST_USER_ID = new ObjectId();
const TEST_CHAT_ID = new ObjectId();
const OTHER_USER_ID = new ObjectId();

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

describe('POST /:chatId - Send Message', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('messages').deleteMany({});
    await db.collection('chats').deleteMany({});
    await db.collection('posts').deleteMany({});
    await db.collection('reels').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('user_blocks').deleteMany({});

    // Create test chat
    await db.collection('chats').insertOne({
      _id: TEST_CHAT_ID,
      type: 'direct',
      participants: [TEST_USER_ID, OTHER_USER_ID],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('should send a message successfully', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Hello, world!',
      });

    expect(response.status).toBe(201);
    expect(response.body._id).toBeDefined();
    expect(response.body.chatId).toBe(TEST_CHAT_ID.toString());
    expect(response.body.senderId).toBe(TEST_USER_ID.toString());
    expect(response.body.body).toBe('Hello, world!');
    expect(response.body.status).toBe('sent');
    expect(response.body.reactions).toEqual([]);

    // Verify message was inserted
    const collection = getMessagesCollection();
    const messageId = new ObjectId(response.body._id);
    const message = await collection.findOne({ _id: messageId });
    expect(message).toBeDefined();
    expect(message?.body).toBe('Hello, world!');
  });

  it('should update chat lastMessageRef', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Test message',
      });

    expect(response.status).toBe(201);

    // Verify chat was updated
    const db = getDatabase();
    const chat = await db.collection('chats').findOne({ _id: TEST_CHAT_ID });
    expect(chat?.lastMessageRef).toBeDefined();
    expect(chat?.lastMessageRef.body).toBe('Test message');
    expect(chat?.lastMessageRef.messageId.toString()).toBe(response.body._id);
  });

  it('should send an event message in a group chat', async () => {
    const groupChatId = new ObjectId();
    await getDatabase().collection('chats').insertOne({
      _id: groupChatId,
      type: 'group',
      participants: [TEST_USER_ID, OTHER_USER_ID],
      admins: [TEST_USER_ID],
      ownerId: TEST_USER_ID,
      title: 'Q/A',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = generateToken(TEST_USER_ID.toString());
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await request(app)
      .post(`/${groupChatId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Team sync',
        type: 'event',
        event: {
          title: 'Team sync',
          startsAt,
          timezone: 'America/Los_Angeles',
          location: 'Blabber HQ',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.chatId).toBe(groupChatId.toString());
    expect(response.body.type).toBe('event');
    expect(response.body.event).toMatchObject({
      title: 'Team sync',
      timezone: 'America/Los_Angeles',
      location: 'Blabber HQ',
      currentUserRsvp: 'going',
    });
    const stored = await getDatabase().collection('messages').findOne({ _id: new ObjectId(response.body._id) });
    expect(stored?.event?.title).toBe('Team sync');
  });

  it('should send message with tempId for optimistic updates', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const tempId = 'temp-123-456';

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Optimistic message',
        tempId,
      });

    expect(response.status).toBe(201);
    expect(response.body.tempId).toBe(tempId);
  });

  it('should send message with media', async () => {
    const mediaId = new ObjectId();
    await getDatabase().collection('media').insertOne({
      _id: mediaId,
      userId: TEST_USER_ID,
      fileType: 'image/jpeg',
      url: 'http://localhost:3000/api/media/local/test-image.jpg',
      storage: 'local',
      status: 'approved',
      uploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Check out this image',
        mediaId: mediaId.toString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.media).toBeDefined();
    expect(response.body.media.type).toBe('image');
  });

  it('should send message with reply', async () => {
    const collection = getMessagesCollection();

    // Create original message
    const originalMessage = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Original message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Reply to original',
        replyToId: originalMessage.insertedId.toString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.replyTo).toBeDefined();
    expect(response.body.replyTo.messageId).toBe(originalMessage.insertedId.toString());
    expect(response.body.replyTo.body).toBe('Original message');
  });

  it('should return 400 for invalid chat ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/invalid-id')
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Test message',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid chat ID');
  });

  it('should return 400 for empty body', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: '',
      });

    expect(response.status).toBe(400);
  });

  it('should return 404 for invalid replyToId', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Reply to non-existent',
        replyToId: nonExistentId.toString(),
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Reply message not found');
  });

  it('should return 401 if not authenticated', async () => {
    const response = await request(app).post(`/${TEST_CHAT_ID.toString()}`).send({
      body: 'Test message',
    });

    expect(response.status).toBe(401);
  });

  describe('Shared post/reel', () => {
    async function seedAuthor(overrides: Record<string, unknown> = {}) {
      const authorId = new ObjectId();
      await getDatabase()
        .collection('users')
        .insertOne({
          _id: authorId,
          name: 'Post Author',
          username: 'postauthor',
          profileVisibility: 'public',
          ...overrides,
        });
      return authorId;
    }

    it('shares a public post as rich sharedItem metadata, not raw client-supplied data', async () => {
      const authorId = await seedAuthor();
      const mediaId = new ObjectId();
      const postId = new ObjectId();
      await getDatabase()
        .collection('posts')
        .insertOne({
          _id: postId,
          authorUserId: authorId,
          body: 'A caption clients should never be trusted to supply themselves',
          visibility: 'public',
          mediaIds: [mediaId],
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a post',
          type: 'text',
          sharedItem: { type: 'post', id: postId.toString() },
        });

      expect(response.status).toBe(201);
      expect(response.body.sharedItem).toMatchObject({
        type: 'post',
        id: postId.toString(),
        url: `/feed?post=${postId.toString()}`,
        text: 'A caption clients should never be trusted to supply themselves',
        authorName: 'Post Author',
        thumbnailUrl: `/api/posts/${postId.toString()}/media/${mediaId.toString()}`,
      });
    });

    it('rejects sharing a followers-only post', async () => {
      const authorId = await seedAuthor();
      const postId = new ObjectId();
      await getDatabase()
        .collection('posts')
        .insertOne({
          _id: postId,
          authorUserId: authorId,
          body: 'Private caption',
          visibility: 'followers',
          mediaIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a post',
          sharedItem: { type: 'post', id: postId.toString() },
        });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: TEST_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('rejects sharing a post from a blocked author', async () => {
      const authorId = await seedAuthor();
      const postId = new ObjectId();
      await getDatabase()
        .collection('posts')
        .insertOne({
          _id: postId,
          authorUserId: authorId,
          body: 'Blocked author caption',
          visibility: 'public',
          mediaIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      await getDatabase()
        .collection('user_blocks')
        .insertOne({ blockerUserId: authorId, blockedUserId: TEST_USER_ID, createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a post',
          sharedItem: { type: 'post', id: postId.toString() },
        });

      expect(response.status).toBe(403);
    });

    it('shares a public reel as rich sharedItem metadata', async () => {
      const authorId = await seedAuthor({ name: 'Reel Author', username: 'reelauthor' });
      const reelId = new ObjectId();
      await getDatabase()
        .collection('reels')
        .insertOne({
          _id: reelId,
          authorUserId: authorId,
          caption: 'A reel caption',
          visibility: 'public',
          publishState: 'published',
          processingStatus: 'ready',
          posterPath: '/tmp/poster.jpg',
          createdAt: new Date('2026-02-01T00:00:00Z'),
          updatedAt: new Date('2026-02-01T00:00:00Z'),
        });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a reel',
          sharedItem: { type: 'reel', id: reelId.toString() },
        });

      expect(response.status).toBe(201);
      expect(response.body.sharedItem).toMatchObject({
        type: 'reel',
        id: reelId.toString(),
        url: `/reels/${reelId.toString()}`,
        text: 'A reel caption',
        authorName: 'Reel Author',
        thumbnailUrl: `/api/reels/${reelId.toString()}/poster`,
      });
    });

    it('rejects sharing a reel that is still processing', async () => {
      const authorId = await seedAuthor();
      const reelId = new ObjectId();
      await getDatabase()
        .collection('reels')
        .insertOne({
          _id: reelId,
          authorUserId: authorId,
          caption: 'Not ready yet',
          visibility: 'public',
          publishState: 'published',
          processingStatus: 'processing',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a reel',
          sharedItem: { type: 'reel', id: reelId.toString() },
        });

      expect(response.status).toBe(403);
    });

    it('rejects an invalid shared item id', async () => {
      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Shared a post',
          sharedItem: { type: 'post', id: 'not-an-object-id' },
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Direct chat block enforcement', () => {
    it('rejects a plain text message once either participant has blocked the other', async () => {
      await getDatabase().collection('user_blocks').insertOne({
        blockerUserId: OTHER_USER_ID,
        blockedUserId: TEST_USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Hello, world!' });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: TEST_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('rejects a poll message once either participant has blocked the other', async () => {
      await getDatabase().collection('user_blocks').insertOne({
        blockerUserId: TEST_USER_ID,
        blockedUserId: OTHER_USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const token = generateToken(TEST_USER_ID.toString());
      const response = await request(app)
        .post(`/${TEST_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Lunch poll',
          poll: { question: 'Lunch?', options: ['Pizza', 'Sushi'] },
        });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: TEST_CHAT_ID });
      expect(stored).toBeNull();
    });
  });

  describe('Admin-only group enforcement', () => {
    const GROUP_CHAT_ID = new ObjectId();
    const ADMIN_ID = new ObjectId();
    const MEMBER_ID = new ObjectId();

    async function seedAdminOnlyGroup() {
      await getDatabase().collection('chats').insertOne({
        _id: GROUP_CHAT_ID,
        type: 'group',
        participants: [ADMIN_ID, MEMBER_ID],
        admins: [ADMIN_ID],
        ownerId: ADMIN_ID,
        sendMode: 'admins_only',
        title: 'Admin Only Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    it('rejects a non-admin sending a text message', async () => {
      await seedAdminOnlyGroup();
      const token = generateToken(MEMBER_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Hello everyone' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Only group admins can send messages');
      const stored = await getDatabase().collection('messages').findOne({ chatId: GROUP_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('rejects a non-admin sending a media message', async () => {
      await seedAdminOnlyGroup();
      const mediaId = new ObjectId();
      await getDatabase().collection('media').insertOne({
        _id: mediaId,
        userId: MEMBER_ID,
        fileType: 'image/jpeg',
        url: 'http://localhost:3000/api/media/local/test-image.jpg',
        storage: 'local',
        status: 'approved',
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = generateToken(MEMBER_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Check this out', mediaId: mediaId.toString() });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: GROUP_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('rejects a non-admin creating a poll', async () => {
      await seedAdminOnlyGroup();
      const token = generateToken(MEMBER_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Lunch poll', poll: { question: 'Lunch?', options: ['Pizza', 'Sushi'] } });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: GROUP_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('rejects a non-admin creating an event', async () => {
      await seedAdminOnlyGroup();
      const token = generateToken(MEMBER_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Team sync',
          event: { title: 'Team sync', startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
        });

      expect(response.status).toBe(403);
      const stored = await getDatabase().collection('messages').findOne({ chatId: GROUP_CHAT_ID });
      expect(stored).toBeNull();
    });

    it('allows an admin to send a text message', async () => {
      await seedAdminOnlyGroup();
      const token = generateToken(ADMIN_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Announcement from admin' });

      expect(response.status).toBe(201);
    });

    it('allows sending again once the group is switched back to everyone', async () => {
      await seedAdminOnlyGroup();
      await getDatabase().collection('chats').updateOne(
        { _id: GROUP_CHAT_ID },
        { $set: { sendMode: 'everyone' } }
      );
      const token = generateToken(MEMBER_ID.toString());

      const response = await request(app)
        .post(`/${GROUP_CHAT_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Now I can send' });

      expect(response.status).toBe(201);
    });
  });

  describe('Ended temporary group enforcement', () => {
    const ENDED_GROUP_ID = new ObjectId();
    const OWNER_ID = new ObjectId();

    async function seedEndedGroup() {
      await getDatabase().collection('chats').insertOne({
        _id: ENDED_GROUP_ID,
        type: 'group',
        groupKind: 'temporary',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        endedAt: new Date(Date.now() - 30 * 60 * 1000),
        participants: [OWNER_ID],
        admins: [OWNER_ID],
        ownerId: OWNER_ID,
        title: 'Ended Temp Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    it('rejects a new text message', async () => {
      await seedEndedGroup();
      const token = generateToken(OWNER_ID.toString());

      const response = await request(app)
        .post(`/${ENDED_GROUP_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Still active?' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('This temporary group has ended');
      const stored = await getDatabase().collection('messages').findOne({ chatId: ENDED_GROUP_ID });
      expect(stored).toBeNull();
    });

    it('rejects a new poll', async () => {
      await seedEndedGroup();
      const token = generateToken(OWNER_ID.toString());

      const response = await request(app)
        .post(`/${ENDED_GROUP_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Poll', poll: { question: 'Still relevant?', options: ['Yes', 'No'] } });

      expect(response.status).toBe(403);
    });

    it('rejects a new event', async () => {
      await seedEndedGroup();
      const token = generateToken(OWNER_ID.toString());

      const response = await request(app)
        .post(`/${ENDED_GROUP_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'Event',
          event: { title: 'Reunion', startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
        });

      expect(response.status).toBe(403);
    });

    it('rejects a new media message', async () => {
      await seedEndedGroup();
      const mediaId = new ObjectId();
      await getDatabase().collection('media').insertOne({
        _id: mediaId,
        userId: OWNER_ID,
        fileType: 'image/jpeg',
        url: 'http://localhost:3000/api/media/local/test-image.jpg',
        storage: 'local',
        status: 'approved',
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = generateToken(OWNER_ID.toString());

      const response = await request(app)
        .post(`/${ENDED_GROUP_ID.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Photo', mediaId: mediaId.toString() });

      expect(response.status).toBe(403);
    });

    it('rejects sends via a still-future expiresAt that has since lapsed, without a prior endedAt write', async () => {
      const chatId = new ObjectId();
      const ownerId = new ObjectId();
      await getDatabase().collection('chats').insertOne({
        _id: chatId,
        type: 'group',
        groupKind: 'temporary',
        expiresAt: new Date(Date.now() - 1000),
        participants: [ownerId],
        admins: [ownerId],
        ownerId,
        title: 'Lazily Expired Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = generateToken(ownerId.toString());

      const response = await request(app)
        .post(`/${chatId.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Past expiry' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('This temporary group has ended');
    });

    it('soft-deletes a lazily expired group configured for end and delete', async () => {
      const chatId = new ObjectId();
      const ownerId = new ObjectId();
      await getDatabase().collection('chats').insertOne({
        _id: chatId,
        type: 'group',
        groupKind: 'temporary',
        temporaryCompletionBehavior: 'end_and_delete',
        expiresAt: new Date(Date.now() - 1000),
        participants: [ownerId],
        admins: [ownerId],
        ownerId,
        title: 'Lazily Deleted Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = generateToken(ownerId.toString());

      const response = await request(app)
        .post(`/${chatId.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Past expiry' });

      expect(response.status).toBe(404);
      const stored = await getDatabase().collection('chats').findOne({ _id: chatId });
      expect(stored?.endedAt).toBeInstanceOf(Date);
      expect(stored?.deletedAt).toBeInstanceOf(Date);
    });
  });
});
