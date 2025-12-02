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

describe('POST /login', () => {
  // Helper function to register a test user
  const registerTestUser = async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    await request(app).post('/register').send(userData).expect(201);

    return userData;
  };

  it('should login successfully with valid credentials', async () => {
    const userData = await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    expect(response.body).toHaveProperty('user');
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body.user).toHaveProperty('_id');
    expect(response.body.user.username).toBe(userData.username);
    expect(response.body.user.email).toBe(userData.email);
    expect(response.body.user.name).toBe(userData.name);
    expect(response.body.user).not.toHaveProperty('passwordHash');

    // Check that access token is a string
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(0);
  });

  it('should set httpOnly cookie with refresh token', async () => {
    const userData = await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    // Check that refresh token cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('refreshToken');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
  });

  it('should create a device session on login', async () => {
    const userData = await registerTestUser();

    // Clear device sessions from registration
    await testDb.collection('deviceSessions').deleteMany({});

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    // Check that device session was created
    const sessions = await testDb.collection('deviceSessions').find({}).toArray();

    expect(sessions.length).toBe(1);
    const session = sessions[0];
    expect(session.refreshTokenHash).toBeDefined();
    expect(session.userAgent).toBeDefined();
    expect(session.ipAddress).toBeDefined();
    expect(session.expiresAt).toBeDefined();
    expect(session.createdAt).toBeDefined();

    // Verify refresh token is hashed
    expect(session.refreshTokenHash).toMatch(/^\$2[aby]\$/); // bcrypt hash pattern
  });

  it('should store user agent and IP address in device session', async () => {
    const userData = await registerTestUser();

    // Clear device sessions from registration
    await testDb.collection('deviceSessions').deleteMany({});

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .set('User-Agent', 'TestAgent/1.0')
      .expect(200);

    // Check device session details
    const sessions = await testDb.collection('deviceSessions').find({}).toArray();
    const session = sessions[0];

    expect(session.userAgent).toBe('TestAgent/1.0');
    expect(session.ipAddress).toBeDefined();
  });

  it('should reject login with invalid email', async () => {
    await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'password123',
      })
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid email or password');
  });

  it('should reject login with invalid password', async () => {
    const userData = await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: 'wrongpassword',
      })
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid email or password');
  });

  it('should reject login with missing email', async () => {
    await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        password: 'password123',
      })
      .expect(400);

    expect(response.body).toHaveProperty('error');
  });

  it('should reject login with missing password', async () => {
    const userData = await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
      })
      .expect(400);

    expect(response.body).toHaveProperty('error');
  });

  it('should reject login with invalid email format', async () => {
    await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: 'invalid-email',
        password: 'password123',
      })
      .expect(400);

    expect(response.body).toHaveProperty('error');
  });

  it('should allow multiple logins creating multiple device sessions', async () => {
    const userData = await registerTestUser();

    // Clear device sessions from registration
    await testDb.collection('deviceSessions').deleteMany({});

    // Login from first device
    await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .set('User-Agent', 'Device1')
      .expect(200);

    // Login from second device
    await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .set('User-Agent', 'Device2')
      .expect(200);

    // Check that two device sessions were created
    const sessions = await testDb.collection('deviceSessions').find({}).toArray();
    expect(sessions.length).toBe(2);

    const userAgents = sessions.map((s) => s.userAgent);
    expect(userAgents).toContain('Device1');
    expect(userAgents).toContain('Device2');
  });

  it('should not expose password hash in response', async () => {
    const userData = await registerTestUser();

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('password');
  });

  it('should include avatarUrl in response if present', async () => {
    const userData = await registerTestUser();

    // Update user with avatarUrl
    await testDb
      .collection('users')
      .updateOne(
        { email: userData.email },
        { $set: { avatarUrl: 'https://example.com/avatar.jpg' } }
      );

    const response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    expect(response.body.user.avatarUrl).toBe('https://example.com/avatar.jpg');
  });
});
