import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Db, ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getRefreshTokenTTL } from '../utils/jwt';

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

describe('POST /refresh', () => {
  // Helper function to register and login a test user
  const registerAndLoginTestUser = async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    await request(app).post('/register').send(userData).expect(201);

    const loginResponse = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    // Extract refresh token from cookie
    const cookies = loginResponse.headers['set-cookie'];
    const refreshTokenCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));
    const refreshToken = refreshTokenCookie?.split(';')[0].split('=')[1];

    return {
      userData,
      userId: loginResponse.body.user._id,
      accessToken: loginResponse.body.accessToken,
      refreshToken,
    };
  };

  it('should refresh tokens successfully with valid refresh token', async () => {
    const { refreshToken } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(0);
  });

  it('should set new httpOnly cookie with new refresh token', async () => {
    const { refreshToken } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    // Check that new refresh token cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('refreshToken');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');

    // Extract new refresh token
    const newRefreshToken = cookies[0].split(';')[0].split('=')[1];
    expect(newRefreshToken).toBeDefined();
    expect(newRefreshToken).not.toBe(refreshToken); // Should be different from old token
  });

  it('should invalidate old device session and create new one', async () => {
    // Create a user with only ONE session (login only, skip register)
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    // Manually create user without going through register endpoint
    const passwordHash = await import('bcrypt').then((bcrypt) =>
      bcrypt.hash(userData.password, 10)
    );
    const userId = new ObjectId();
    await testDb.collection('users').insertOne({
      _id: userId,
      username: userData.username,
      email: userData.email,
      passwordHash,
      name: userData.name,
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Now login to get a single session
    const loginResponse = await request(app)
      .post('/login')
      .send({ email: userData.email, password: userData.password })
      .expect(200);

    const refreshToken = loginResponse.headers['set-cookie']
      .find((cookie: string) => cookie.startsWith('refreshToken='))
      ?.split(';')[0]
      .split('=')[1];

    // Verify we have exactly 1 session
    const sessionsBeforeRefresh = await testDb
      .collection('deviceSessions')
      .find({ userId })
      .toArray();
    expect(sessionsBeforeRefresh.length).toBe(1);

    // Refresh token
    await request(app).post('/refresh').set('Cookie', `refreshToken=${refreshToken}`).expect(200);

    // Check that we still have exactly 1 session (old deleted, new created)
    const sessionsAfterRefresh = await testDb
      .collection('deviceSessions')
      .find({ userId })
      .toArray();

    expect(sessionsAfterRefresh.length).toBe(1);

    // Verify the session was actually replaced (different hash)
    const oldSessionHash = sessionsBeforeRefresh[0].refreshTokenHash;
    const newSessionHash = sessionsAfterRefresh[0].refreshTokenHash;
    expect(newSessionHash).not.toBe(oldSessionHash);

    // Add small delay to ensure token rotation is complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify old session is gone by trying to use old refresh token again
    const retryResponse = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(401);

    expect(retryResponse.body).toHaveProperty('error');
  });

  it('should create new device session with correct metadata', async () => {
    const { refreshToken, userId } = await registerAndLoginTestUser();

    // Refresh token with custom user agent
    await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .set('User-Agent', 'RefreshTestAgent/1.0')
      .expect(200);

    // Check new device session
    const sessions = await testDb
      .collection('deviceSessions')
      .find({ userId: new ObjectId(userId) })
      .toArray();

    expect(sessions.length).toBeGreaterThan(0);

    // Find the session with the RefreshTestAgent user agent
    const refreshSession = sessions.find((s) => s.userAgent === 'RefreshTestAgent/1.0');
    expect(refreshSession).toBeDefined();
    expect(refreshSession!.refreshTokenHash).toBeDefined();
    expect(refreshSession!.ipAddress).toBeDefined();
    expect(refreshSession!.expiresAt).toBeDefined();
    expect(refreshSession!.createdAt).toBeDefined();

    // Verify refresh token is hashed
    expect(refreshSession!.refreshTokenHash).toMatch(/^\$2[aby]\$/); // bcrypt hash pattern
  });

  it('should reject refresh with missing refresh token', async () => {
    const response = await request(app).post('/refresh').expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Refresh token not found');
  });

  it('should reject refresh with invalid refresh token', async () => {
    const response = await request(app)
      .post('/refresh')
      .set('Cookie', 'refreshToken=invalid.token.here')
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid or expired refresh token');
  });

  it('should reject refresh with expired refresh token', async () => {
    const invalidToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NTYiLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjIzOTAyMn0.invalid';

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${invalidToken}`)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid or expired refresh token');
  });

  it('should reject refresh when device session does not exist', async () => {
    const { refreshToken, userId } = await registerAndLoginTestUser();

    // Delete all device sessions
    await testDb.collection('deviceSessions').deleteMany({ userId: new ObjectId(userId) });

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid refresh token');
  });

  it('should reject refresh when user no longer exists', async () => {
    const { refreshToken, userId } = await registerAndLoginTestUser();

    // Delete the user
    await testDb.collection('users').deleteOne({ _id: new ObjectId(userId) });

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('User not found');
  });

  it('should handle token rotation correctly - old token cannot be reused', async () => {
    // Create a user with only ONE session
    const userData = {
      username: 'testuser2',
      email: 'test2@example.com',
      password: 'password123',
      name: 'Test User 2',
    };

    const passwordHash = await import('bcrypt').then((bcrypt) =>
      bcrypt.hash(userData.password, 10)
    );
    const userId = new ObjectId();
    await testDb.collection('users').insertOne({
      _id: userId,
      username: userData.username,
      email: userData.email,
      passwordHash,
      name: userData.name,
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const loginResponse = await request(app)
      .post('/login')
      .send({ email: userData.email, password: userData.password })
      .expect(200);

    const refreshToken = loginResponse.headers['set-cookie']
      .find((cookie: string) => cookie.startsWith('refreshToken='))
      ?.split(';')[0]
      .split('=')[1];

    // First refresh - should succeed
    const firstRefresh = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    expect(firstRefresh.body).toHaveProperty('accessToken');

    // Add small delay to ensure token rotation is complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to use old refresh token again - should fail
    const secondRefresh = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(401);

    expect(secondRefresh.body).toHaveProperty('error');
    expect(secondRefresh.body.message).toContain('Invalid refresh token');
  });

  it('should allow using new refresh token after rotation', async () => {
    const { refreshToken } = await registerAndLoginTestUser();

    // First refresh
    const firstRefresh = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    // Extract new refresh token
    const cookies = firstRefresh.headers['set-cookie'];
    const newRefreshTokenCookie = cookies.find((cookie: string) =>
      cookie.startsWith('refreshToken=')
    );
    const newRefreshToken = newRefreshTokenCookie?.split(';')[0].split('=')[1];

    // Use new refresh token - should succeed
    const secondRefresh = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${newRefreshToken}`)
      .expect(200);

    expect(secondRefresh.body).toHaveProperty('accessToken');
  });

  it('should maintain separate sessions for multiple devices', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    await request(app).post('/register').send(userData).expect(201);

    // Login from device 1
    const device1Login = await request(app)
      .post('/login')
      .send({ email: userData.email, password: userData.password })
      .set('User-Agent', 'Device1')
      .expect(200);

    const device1RefreshToken = device1Login.headers['set-cookie']
      .find((cookie: string) => cookie.startsWith('refreshToken='))
      ?.split(';')[0]
      .split('=')[1];

    // Login from device 2
    const device2Login = await request(app)
      .post('/login')
      .send({ email: userData.email, password: userData.password })
      .set('User-Agent', 'Device2')
      .expect(200);

    const device2RefreshToken = device2Login.headers['set-cookie']
      .find((cookie: string) => cookie.startsWith('refreshToken='))
      ?.split(';')[0]
      .split('=')[1];

    // Refresh from device 1
    await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${device1RefreshToken}`)
      .set('User-Agent', 'Device1')
      .expect(200);

    // Device 2 should still be able to refresh
    await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${device2RefreshToken}`)
      .set('User-Agent', 'Device2')
      .expect(200);
  });

  it('should return new access token with correct payload', async () => {
    const { refreshToken, userId } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    // Decode the access token (without verification for testing)
    const accessToken = response.body.accessToken;
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());

    expect(payload).toHaveProperty('userId');
    expect(payload.userId).toBe(userId);
    expect(payload).toHaveProperty('username');
    expect(payload.username).toBe('testuser');
    expect(payload).toHaveProperty('email');
    expect(payload.email).toBe('test@example.com');
    expect(payload).toHaveProperty('iat');
    expect(payload).toHaveProperty('exp');
  });

  it('should set correct expiration time for new refresh token', async () => {
    const { refreshToken } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .expect(200);

    // Check cookie max-age
    const cookies = response.headers['set-cookie'];
    const refreshTokenCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));

    expect(refreshTokenCookie).toContain('Max-Age=');

    // Extract max-age value
    const maxAgeMatch = refreshTokenCookie?.match(/Max-Age=(\d+)/);
    expect(maxAgeMatch).toBeDefined();

    const maxAge = parseInt(maxAgeMatch![1], 10);
    const expectedTTL = getRefreshTokenTTL() / 1000; // Convert to seconds

    // Allow small difference due to processing time
    expect(Math.abs(maxAge - expectedTTL)).toBeLessThan(5);
  });
});
