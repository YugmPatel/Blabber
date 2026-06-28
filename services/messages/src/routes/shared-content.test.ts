import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;

function token(userId: ObjectId) {
  return jwt.sign({ userId: userId.toString() }, JWT_SECRET, { expiresIn: '15m' });
}

describe('GET /shared', () => {
  const userA = new ObjectId();
  const userB = new ObjectId();
  const userC = new ObjectId();
  const chatId = new ObjectId();

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('users').deleteMany({});
    await db.collection('chats').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('users').insertMany([
      { _id: userA, name: 'Alice', username: 'alice', email: 'alice@example.com' },
      { _id: userB, name: 'Bob', username: 'bob', email: 'bob@example.com' },
      { _id: userC, name: 'Cara', username: 'cara', email: 'cara@example.com' },
    ]);
    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      participants: [userA, userB],
      admins: [userA],
      ownerId: userA,
      title: 'Shared Content',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('messages').insertMany([
      {
        _id: new ObjectId(),
        chatId,
        senderId: userA,
        body: 'image caption',
        media: { type: 'image', url: '/api/media/local/image', fileName: 'image.png', mimeType: 'image/png', size: 10 },
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(Date.now() - 1000),
      },
      {
        _id: new ObjectId(),
        chatId,
        senderId: userA,
        body: 'doc caption',
        media: { type: 'document', url: '/api/media/local/doc', fileName: 'doc.pdf', mimeType: 'application/pdf', size: 12 },
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(Date.now() - 2000),
      },
      {
        _id: new ObjectId(),
        chatId,
        senderId: userA,
        body: 'visit https://example.com/path and javascript:alert(1)',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(Date.now() - 3000),
      },
      {
        _id: new ObjectId(),
        chatId,
        senderId: userA,
        body: 'hidden https://hidden.example.com',
        reactions: [],
        status: 'sent',
        deletedFor: [userB],
        createdAt: new Date(Date.now() - 4000),
      },
    ]);
  });

  it('returns classified authorized shared media, documents, and links', async () => {
    const auth = `Bearer ${token(userB)}`;
    const [media, documents, links] = await Promise.all([
      request(app).get('/shared').set('Authorization', auth).query({ chatId: chatId.toString(), type: 'media' }),
      request(app).get('/shared').set('Authorization', auth).query({ chatId: chatId.toString(), type: 'documents' }),
      request(app).get('/shared').set('Authorization', auth).query({ chatId: chatId.toString(), type: 'links' }),
    ]);

    expect(media.status).toBe(200);
    expect(media.body.items).toHaveLength(1);
    expect(media.body.items[0].source).toMatchObject({ chatId: chatId.toString(), messageId: expect.any(String) });
    expect(documents.body.items).toHaveLength(1);
    expect(documents.body.items[0].attachment.fileName).toBe('doc.pdf');
    expect(links.body.items).toHaveLength(1);
    expect(links.body.items[0].link.url).toBe('https://example.com/path');
    expect(JSON.stringify(links.body)).not.toContain('javascript:');
    expect(JSON.stringify(links.body)).not.toContain('hidden.example.com');
  });

  it('denies non-members', async () => {
    const response = await request(app)
      .get('/shared')
      .set('Authorization', `Bearer ${token(userC)}`)
      .query({ chatId: chatId.toString(), type: 'media' });

    expect(response.status).toBe(403);
  });

  it('uses stable bounded pagination', async () => {
    const first = await request(app)
      .get('/shared')
      .set('Authorization', `Bearer ${token(userB)}`)
      .query({ chatId: chatId.toString(), type: 'links', limit: '1' });

    expect(first.status).toBe(200);
    expect(first.body.items.length).toBeLessThanOrEqual(1);
    expect(first.body.nextCursor).toBeNull();
  });
});
