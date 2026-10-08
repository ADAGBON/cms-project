require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  mongoUri:
    process.env.MONGODB_URI ||
    (env === 'test' ? 'mongodb://127.0.0.1:27017/pressroom_test' : 'mongodb://127.0.0.1:27017/pressroom'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  siteName: process.env.SITE_NAME || 'Pressroom',
  siteTagline: process.env.SITE_TAGLINE || 'Stories, ideas and notes from Lagos and beyond',
  baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  seedOnStart: process.env.SEED_ON_START !== 'false',
  maxUploadBytes: 3 * 1024 * 1024,
  postsPerPage: 6,
};
