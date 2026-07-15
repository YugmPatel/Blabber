import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getMessagesCollection } from '../models/message';
import { seedMessageTestChat } from '../test-fixtures';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const CREATOR_ID = new ObjectId();
const MEMBER_ID = new ObjectId();
const MEMBER_TWO_ID = new ObjectId();
const GROUP_CHAT_ID = new ObjectId();

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

async function insertEventMessage(chatId: ObjectId, createdBy: ObjectId) {
  const collection = getMessagesCollection();
  const result = await collection.insertOne({
    _id: new ObjectId(),
    chatId,
    senderId: createdBy,
    body: 'Team sync',
    reactions: [],
    status: 'sent' as const,
    deletedFor: [],
    createdAt: new Date(),
    event: {
      title: 'Team sync',
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      startAt: new Date(Date.now() + 60 * 60 * 1000),
      timezone: 'UTC',
      createdBy,
      reminderEnabled: true,
      rsvps: [{ userId: createdBy, status: 'going' as const, respondedAt: new Date(), updatedAt: new Date() }],
    },
  });
  return result.insertedId;
}

describe('Group event actions', () => {
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
    await db.collection('user_blocks').deleteMany({});
    await seedMessageTestChat(GROUP_CHAT_ID, [CREATOR_ID, MEMBER_ID, MEMBER_TWO_ID], 'group');
  });

  it('lets a group member RSVP to an event', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const token = generateToken(MEMBER_ID.toString());

    const response = await request(app)
      .post(`/${messageId.toString()}/event/rsvp`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'going' });

    expect(response.status).toBe(200);
    expect(response.body.event.currentUserRsvp).toBe('going');

    const stored = await getMessagesCollection().findOne({ _id: messageId });
    const rsvps = stored?.event?.rsvps || [];
    expect(rsvps.some((rsvp) => rsvp.userId.equals(MEMBER_ID) && rsvp.status === 'going')).toBe(true);
  });

  it('lets the event creator update the event in a group', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const token = generateToken(CREATOR_ID.toString());

    const response = await request(app)
      .patch(`/${messageId.toString()}/event`)
      .set('Authorization', `Bearer ${token}`)
      .send({ location: 'Room 4B' });

    expect(response.status).toBe(200);
    expect(response.body.event.location).toBe('Room 4B');
  });

  it('rejects an event update from a non-creator group member', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const token = generateToken(MEMBER_ID.toString());

    const response = await request(app)
      .patch(`/${messageId.toString()}/event`)
      .set('Authorization', `Bearer ${token}`)
      .send({ location: 'Room 4B' });

    expect(response.status).toBe(403);
  });

  it('lets the event creator cancel the event in a group', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const token = generateToken(CREATOR_ID.toString());

    const response = await request(app)
      .post(`/${messageId.toString()}/event/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.event.cancelledAt).toBeTruthy();
  });

  it('rejects RSVP from a user who is not a group member', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const outsiderToken = generateToken(new ObjectId().toString());

    const response = await request(app)
      .post(`/${messageId.toString()}/event/rsvp`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ status: 'going' });

    expect(response.status).toBe(403);
  });

  it('still allows exporting the event .ics for a cancelled/read-only view', async () => {
    const messageId = await insertEventMessage(GROUP_CHAT_ID, CREATOR_ID);
    const token = generateToken(MEMBER_ID.toString());

    const response = await request(app)
      .get(`/${messageId.toString()}/event.ics`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/calendar');
  });

  it('allows a non-admin to RSVP in an admins-only group (RSVPing is not "sending a message")', async () => {
    const adminOnlyChatId = new ObjectId();
    await getDatabase().collection('chats').insertOne({
      _id: adminOnlyChatId,
      type: 'group',
      participants: [CREATOR_ID, MEMBER_ID],
      admins: [CREATOR_ID],
      sendMode: 'admins_only',
      title: 'Admin Only Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const messageId = await insertEventMessage(adminOnlyChatId, CREATOR_ID);
    const token = generateToken(MEMBER_ID.toString());

    const response = await request(app)
      .post(`/${messageId.toString()}/event/rsvp`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'going' });

    expect(response.status).toBe(200);
    expect(response.body.event.currentUserRsvp).toBe('going');
  });
});
