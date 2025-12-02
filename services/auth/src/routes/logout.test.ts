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

describe('POST /logout', () => {
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

    // Extract refresh token cookie
    const cookies = loginResponse.headers['set-cookie'];
    const refreshTokenCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));

    return {
      userData,
      accessToken: loginResponse.body.accessToken,
      refreshTokenCookie,
    };
  };

  it('should logout successfully with valid refresh token', async () => {
    const { refreshTokenCookie } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('message');
  });

  it('should delete device session from database', async () => {
    const { refreshTokenCookie } = await registerAndLoginTestUser();

    // Verify device session exists before logout (1 from registration, 1 from login)
    const sessionsBefore = await testDb.collection('deviceSessions').find({}).toArray();
    expect(sessionsBefore.length).toBe(2);

    await request(app).post('/logout').set('Cookie', refreshTokenCookie).expect(200);

    // Verify only the login device session was deleted (registration session remains)
    const sessionsAfter = await testDb.collection('deviceSessions').find({}).toArray();
    expect(sessionsAfter.length).toBe(1);
  });

  it('should clear refresh token cookie', async () => {
    const { refreshTokenCookie } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    // Check that cookie is cleared
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const clearedCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));
    expect(clearedCookie).toBeDefined();
    // Cookie is cleared with an expired date
    expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('should reject logout without refresh token', async () => {
    await registerAndLoginTestUser();

    const response = await request(app).post('/logout').expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Refresh token not found');
  });

  it('should reject logout with invalid refresh token', async () => {
    await registerAndLoginTestUser();

    const response = await request(app)
      .post('/logout')
      .set('Cookie', 'refreshToken=invalid-token')
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid or expired refresh token');
  });

  it('should reject logout with expired refresh token', async () => {
    const { refreshTokenCookie } = await registerAndLoginTestUser();

    // Delete the device session to simulate expired token
    await testDb.collection('deviceSessions').deleteMany({});

    const response = await request(app)
      .post('/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid refresh token');
  });

  it('should only delete the matching device session', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    await request(app).post('/register').send(userData).expect(201);

    // Clear registration session to have clean state
    await testDb.collection('deviceSessions').deleteMany({});

    // Login from first device
    const login1Response = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .set('User-Agent', 'Device1')
      .expect(200);

    const cookies1 = login1Response.headers['set-cookie'];
    const refreshTokenCookie1 = cookies1.find((cookie: string) =>
      cookie.startsWith('refreshToken=')
    );

    // Login from second device
    await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .set('User-Agent', 'Device2')
      .expect(200);

    // Verify two device sessions exist
    const sessionsBefore = await testDb.collection('deviceSessions').find({}).toArray();
    expect(sessionsBefore.length).toBe(2);

    // Logout from first device
    await request(app).post('/logout').set('Cookie', refreshTokenCookie1).expect(200);

    // Verify only one device session remains
    const sessionsAfter = await testDb.collection('deviceSessions').find({}).toArray();
    expect(sessionsAfter.length).toBe(1);

    // Verify Device1 session was deleted and Device2 remains
    const userAgents = sessionsAfter.map((s) => s.userAgent);
    expect(userAgents).not.toContain('Device1');
    expect(userAgents).toContain('Device2');
  });

  it('should not allow reusing refresh token after logout', async () => {
    // Register and login separately to have clean device sessions
    const userData = {
      username: 'testuser2',
      email: 'test2@example.com',
      password: 'password123',
      name: 'Test User 2',
    };

    await request(app).post('/register').send(userData).expect(201);

    // Clear registration session
    await testDb.collection('deviceSessions').deleteMany({});

    // Login to get a fresh session
    const loginResponse = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    const cookies = loginResponse.headers['set-cookie'];
    const refreshTokenCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));

    // First logout should succeed
    await request(app).post('/logout').set('Cookie', refreshTokenCookie).expect(200);

    // Second logout with same token should fail
    const response = await request(app)
      .post('/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid refresh token');
  });

  it('should not allow using refresh token after logout', async () => {
    // Register and login separately to have clean device sessions
    const userData = {
      username: 'testuser3',
      email: 'test3@example.com',
      password: 'password123',
      name: 'Test User 3',
    };

    await request(app).post('/register').send(userData).expect(201);

    // Clear registration session
    await testDb.collection('deviceSessions').deleteMany({});

    // Login to get a fresh session
    const loginResponse = await request(app)
      .post('/login')
      .send({
        email: userData.email,
        password: userData.password,
      })
      .expect(200);

    const cookies = loginResponse.headers['set-cookie'];
    const refreshTokenCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));

    // Logout
    await request(app).post('/logout').set('Cookie', refreshTokenCookie).expect(200);

    // Try to refresh with the same token
    const response = await request(app)
      .post('/refresh')
      .set('Cookie', refreshTokenCookie)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('Invalid refresh token');
  });

  it('should preserve httpOnly and sameSite attributes when clearing cookie', async () => {
    const { refreshTokenCookie } = await registerAndLoginTestUser();

    const response = await request(app)
      .post('/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    const cookies = response.headers['set-cookie'];
    const clearedCookie = cookies.find((cookie: string) => cookie.startsWith('refreshToken='));

    expect(clearedCookie).toContain('HttpOnly');
    expect(clearedCookie).toContain('SameSite=Lax');
  });

  it('should handle logout with malformed cookie gracefully', async () => {
    await registerAndLoginTestUser();

    const response = await request(app).post('/logout').set('Cookie', 'refreshToken=').expect(401);

    expect(response.body).toHaveProperty('error');
  });
});
