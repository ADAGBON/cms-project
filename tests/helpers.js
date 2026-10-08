process.env.NODE_ENV = 'test';
process.env.SEED_ON_START = 'false';

const mongoose = require('mongoose');
const request = require('supertest');
const db = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User');
const cache = require('../src/services/cache');

// Deliberately never falls back to MONGODB_URI: tests drop the database they use.
const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/pressroom_test';

async function setup() {
  await db.connect(TEST_URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  cache.clear();
  return createApp();
}

async function teardown() {
  await mongoose.connection.db.dropDatabase();
  await db.disconnect();
}

async function makeUser(role, email = `${role}@test.dev`, password = 'Password123!') {
  const u = new User({ name: `${role[0].toUpperCase()}${role.slice(1)} User`, email, role });
  await u.setPassword(password);
  await u.save();
  return u;
}

const csrfFrom = (html) => {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/) || html.match(/name="csrf-token" content="([a-f0-9]+)"/);
  return m ? m[1] : '';
};

// Logged-in supertest agent that keeps cookies and knows its CSRF token.
async function login(app, email, password = 'Password123!') {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  const res = await agent.post('/admin/login').type('form').send({ email, password, _csrf: csrfFrom(page.text) });
  if (res.status !== 302) throw new Error(`login failed (${res.status})`);
  const dash = await agent.get('/admin');
  agent.csrf = csrfFrom(dash.text);
  return agent;
}

module.exports = { setup, teardown, makeUser, login, csrfFrom, request };
