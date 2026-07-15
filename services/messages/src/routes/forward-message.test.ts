import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getMessagesCollection } from '../models/message';
import { seedMessageTestChat } from '../test-fixtures';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const SENDER_ID = new ObjectId();
const SOURCE_CHAT_ID = new ObjectId();
const OTHER_USER_ID = new ObjectId();

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

async function insertSourceMessage() {
  const result = await getMessagesCollection().insertOne({
    _id: new ObjectId(),
    chatId: SOURCE_CHAT_ID,
    senderId: SENDER_ID,
    body: 'Forward me',
    reactions: [],
    status: 'sent' as const,
    deletedFor: [],
    createdAt: new Date(),
  });
  return result.insertedId;
}

describe('POST /:messageId/forward', () => {
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
    await seedMessageTestChat(SOURCE_CHAT_ID, [SENDER_ID, OTHER_USER_ID], 'group');
  });

  it('rejects forwarding into an admins-only group by a non-admin', async () => {
    const messageId = await insertSourceMessage();
    const adminId = new ObjectId();
    const destinationChatId = new ObjectId();
    await getDatabase().collection('chats').insertOne({
      _id: destinationChatId,
      type: 'group',
      participants: [adminId, SENDER_ID],
      admins: [adminId],
      sendMode: 'admins_only',
      title: 'Admin Only Destination',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(SENDER_ID.toString());
    const response = await request(app)
      .post(`/${messageId.toString()}/forward`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationChatIds: [destinationChatId.toString()] });

    expect(response.status).toBe(403);
    const forwarded = await getMessagesCollection().findOne({ chatId: destinationChatId });
    expect(forwarded).toBeNull();
  });

  it('allows an admin to forward into their own admins-only group', async () => {
    const messageId = await insertSourceMessage();
    const destinationChatId = new ObjectId();
    await getDatabase().collection('chats').insertOne({
      _id: destinationChatId,
      type: 'group',
      participants: [SENDER_ID],
      admins: [SENDER_ID],
      sendMode: 'admins_only',
      title: 'My Admin Only Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(SENDER_ID.toString());
    const response = await request(app)
      .post(`/${messageId.toString()}/forward`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationChatIds: [destinationChatId.toString()] });

    expect(response.status).toBe(201);
    const forwarded = await getMessagesCollection().findOne({ chatId: destinationChatId });
    expect(forwarded).not.toBeNull();
  });

  it('rejects forwarding into an ended temporary group', async () => {
    const messageId = await insertSourceMessage();
    const destinationChatId = new ObjectId();
    await getDatabase().collection('chats').insertOne({
      _id: destinationChatId,
      type: 'group',
      groupKind: 'temporary',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      endedAt: new Date(Date.now() - 30 * 60 * 1000),
      participants: [SENDER_ID],
      admins: [SENDER_ID],
      title: 'Ended Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(SENDER_ID.toString());
    const response = await request(app)
      .post(`/${messageId.toString()}/forward`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationChatIds: [destinationChatId.toString()] });

    expect(response.status).toBe(403);
    const forwarded = await getMessagesCollection().findOne({ chatId: destinationChatId });
    expect(forwarded).toBeNull();
  });
});
