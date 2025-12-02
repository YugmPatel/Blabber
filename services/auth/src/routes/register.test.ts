import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Db } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

let testDb: Db;

beforeAll(async () => {
  // Connect to test database
  await connectToDatabase();
  testDb = getDatabase();
});

afterAll(async () => {
  // Clean up and close connection
  if (testDb) {
    await testDb.dropDatabase();
  }
  await closeDatabase();
});

beforeEach(async () => {
  // Clear collections before each test
  if (testDb) {
    await testDb.collection('users').deleteMany({});
    await testDb.collection('deviceSessions').deleteMany({});
  }
});

describe('POST /register', () => {
  it('should register a new user successfully', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    const response = await request(app).post('/register').send(userData).expect(201);

    expect(response.body).toHaveProperty('user');
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body.user).toHaveProperty('_id');
    expect(response.body.user.username).toBe(userData.username);
    expect(response.body.user.email).toBe(userData.email);
    expect(response.body.user.name).toBe(userData.name);
    expect(response.body.user).not.toHaveProperty('passwordHash');

    // Check that refresh token cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('refreshToken');
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('should reject registration with invalid data', async () => {
    const invalidData = {
      username: 'ab', // too short
      email: 'invalid-email',
      password: 'short',
      name: '',
    };

    const response = await request(app).post('/register').send(invalidData).expect(400);

    expect(response.body).toHaveProperty('error');
  });

  it('should reject registration with duplicate username', async () => {
    const userData = {
      username: 'testuser',
      email: 'test1@example.com',
      password: 'password123',
      name: 'Test User',
    };

    // Register first user
    await request(app).post('/register').send(userData).expect(201);

    // Try to register with same username
    const duplicateData = {
      ...userData,
      email: 'test2@example.com',
    };

    const response = await request(app).post('/register').send(duplicateData).expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Username already exists');
  });

  it('should reject registration with duplicate email', async () => {
    const userData = {
      username: 'testuser1',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    // Register first user
    await request(app).post('/register').send(userData).expect(201);

    // Try to register with same email
    const duplicateData = {
      ...userData,
      username: 'testuser2',
    };

    const response = await request(app).post('/register').send(duplicateData).expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Email already exists');
  });

  it('should hash the password before storing', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    await request(app).post('/register').send(userData).expect(201);

    // Check that password is hashed in database
    const user = await testDb.collection('users').findOne({ username: userData.username });
    expect(user).toBeDefined();
    expect(user?.passwordHash).toBeDefined();
    expect(user?.passwordHash).not.toBe(userData.password);
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash pattern
  });

  it('should create a device session', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    const response = await request(app).post('/register').send(userData).expect(201);

    // Check that device session was created
    const sessions = await testDb.collection('deviceSessions').find({}).toArray();

    expect(sessions.length).toBeGreaterThan(0);
    const session = sessions[0];
    expect(session.refreshTokenHash).toBeDefined();
    expect(session.userAgent).toBeDefined();
    expect(session.ipAddress).toBeDefined();
    expect(session.expiresAt).toBeDefined();
  });
});
