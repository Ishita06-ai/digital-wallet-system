const request = require('supertest');
const express = require('express');
const { createAuthLimiter } = require('../src/middleware/rateLimit.middleware');
const mongoose = require('mongoose');

// Import route handlers and validators directly
const { userLoginController, userLogoutController, userRegisterController } = require('../src/controllers/auth.controller');
const { validateRegister, validateLogin } = require('../src/validators');

const loginEndpoint = '/api/auth/login';
const registerEndpoint = '/api/auth/register';

// Factory to create a fresh app with fresh rate limiter for test isolation
function createTestApp() {
  const app = express();

  // Basic middleware
  app.use(express.json());

  // Apply fresh rate limiter instance for each test app
  const authLimiter = createAuthLimiter();

  // Auth routes with fresh limiter
  app.post('/api/auth/register', authLimiter, validateRegister, userRegisterController);
  app.post('/api/auth/login', authLimiter, validateLogin, userLoginController);
  app.post('/api/auth/logout', userLogoutController);

  return app;
}

describe('Auth Rate Limiting', () => {
  const validUser = {
    email: 'test@example.com',
    password: 'password123',
  };

  beforeAll(async () => {
    // Wait for MongoDB connection to be ready
    if (mongoose.connection.readyState !== 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  describe('POST /api/auth/login', () => {
    let app;

    beforeEach(() => {
      app = createTestApp();
    });

    it('should allow requests within the rate limit', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post(loginEndpoint)
          .send({ email: `user${i}@example.com`, password: 'wrongpassword' });
        // Should not be rate limited (429)
        expect(response.status).not.toBe(429);
      }
    });

    it('should return 429 when rate limit is exceeded', async () => {
      // Make 10 requests (limit is 10 per 15 minutes)
      const responses = [];
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post(loginEndpoint)
          .send({ email: `ratelimit${i}@example.com`, password: 'wrongpassword' });
        responses.push(response);
      }

      // The 11th request should be rate limited
      const rateLimitedResponse = await request(app)
        .post(loginEndpoint)
        .send({ email: 'ratelimit-final@example.com', password: 'wrongpassword' });

      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body).toHaveProperty('message');
      expect(rateLimitedResponse.body.message).toContain('Too many authentication attempts');
    });

    it('should have RateLimit headers on response', async () => {
      const response = await request(app)
        .post(loginEndpoint)
        .send({ email: 'header-test@example.com', password: 'wrongpassword' });

      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');
    });
  });

  describe('POST /api/auth/register', () => {
    let app;

    beforeEach(() => {
      app = createTestApp();
    });

    it('should allow requests within the rate limit', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post(registerEndpoint)
          .send({ name: `User ${i}`, email: `register${i}@example.com`, password: 'password123' });
        expect(response.status).not.toBe(429);
      }
    });

    it('should return 429 when rate limit is exceeded', async () => {
      // Make 10 requests (limit is 10 per 15 minutes)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(registerEndpoint)
          .send({ name: `RateLimit User ${i}`, email: `register-rl${i}@example.com`, password: 'password123' });
      }

      // The 11th request should be rate limited
      const rateLimitedResponse = await request(app)
        .post(registerEndpoint)
        .send({ name: 'RateLimit Final', email: 'register-final@example.com', password: 'password123' });

      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body).toHaveProperty('message');
      expect(rateLimitedResponse.body.message).toContain('Too many authentication attempts');
    });
  });

  describe('Normal authentication should still work', () => {
    let app;

    beforeEach(() => {
      app = createTestApp();
    });

    beforeEach(async () => {
      // Create a test user
      const userModel = require('../src/models/user.model');
      const accountModel = require('../src/models/account.model');
      await userModel.create({
        name: 'Test User',
        email: 'testuser@example.com',
        password: 'password123',
      });
      const user = await userModel.findOne({ email: 'testuser@example.com' });
      await accountModel.create({ user: user._id, balance: 0 });
    });

    it('should successfully login with valid credentials', async () => {
      const response = await request(app)
        .post(loginEndpoint)
        .send({ email: 'testuser@example.com', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
    });

    it('should return 400 for invalid credentials (not rate limited)', async () => {
      const response = await request(app)
        .post(loginEndpoint)
        .send({ email: 'testuser@example.com', password: 'wrongpassword' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid email or password');
    });

    it('should successfully register a new user', async () => {
      const response = await request(app)
        .post(registerEndpoint)
        .send({ name: 'New User', email: 'newuser@example.com', password: 'password123' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
    });
  });
});