import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getMessagesCollection } from '../models/message';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const ADMIN_ID = new ObjectId();
const MEMBER_ID = new ObjectId();
const GROUP_CHAT_ID = new ObjectId();

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

async function insertPollMessage() {
  const result = await getMessagesCollection().insertOne({
    _id: new ObjectId(),
    chatId: GROUP_CHAT_ID,
    senderId: ADMIN_ID,
    body: 'Lunch poll',
    reactions: [],
    status: 'sent' as const,
    deletedFor: [],
    createdAt: new Date(),
    poll: {
      question: 'Lunch?',
      options: [
        { id: 'option-1', text: 'Pizza', votes: [] },
        { id: 'option-2', text: 'Sushi', votes: [] },
      ],
      allowMultiple: false,
      allowVoteChanges: true,
      showVoters: false,
      createdBy: ADMIN_ID,
      votes: [],
      closed: false,
    },
  });
  return result.insertedId;
}

describe('POST /:messageId/poll/vote', () => {
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
    await db.collection('chats').insertOne({
      _id: GROUP_CHAT_ID,
      type: 'group',
      participants: [ADMIN_ID, MEMBER_ID],
      admins: [ADMIN_ID],
      sendMode: 'admins_only',
      title: 'Admin Only Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('allows a non-admin to vote in an admins-only group (voting is not "sending a message")', async () => {
    const messageId = await insertPollMessage();
    const token = generateToken(MEMBER_ID.toString());

    const response = await request(app)
      .post(`/${messageId.toString()}/poll/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionIds: ['option-1'] });

    expect(response.status).toBe(200);
    const stored = await getMessagesCollection().findOne({ _id: messageId });
    const option = stored?.poll?.options.find((o) => o.id === 'option-1');
    expect(option?.votes.some((voterId) => voterId.equals(MEMBER_ID))).toBe(true);
  });
});
