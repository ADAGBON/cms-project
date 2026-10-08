const path = require('path');
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const mongoose = require('mongoose');

const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { csrf, sanitizeInput, flash } = require('./middleware/security');
const { formatDate } = require('./utils/text');
const workflow = require('./services/workflow');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1); // behind Render's proxy: needed for secure cookies and rate-limit IPs
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(compression());
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  // Self-hosted rich text editor (no third-party CDN needed).
  app.use('/vendor/quill', express.static(path.join(__dirname, '..', 'node_modules', 'quill', 'dist'), { maxAge: config.isProd ? '30d' : 0 }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/favicon.svg'));
  app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'manifest.webmanifest')));
  app.get('/sw.js', (req, res) => {
    res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, '..', 'public', 'js', 'sw.js'));
  });
  app.get('/healthz', (req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down' });
  });

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(sanitizeInput);

  app.use(
    session({
      name: 'pressroom.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: config.isTest
        ? undefined
        : MongoStore.create({
          client: mongoose.connection.getClient(),
          ttl: 60 * 60 * 24 * 7,
          // "native" uses a MongoDB TTL index (Atlas). "interval" is for Mongo-compatible servers without TTL support.
          autoRemove: process.env.SESSION_AUTOREMOVE || 'native',
        }),
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 1000 * 60 * 60 * 24 * 7 },
    })
  );

  app.use(loadUser);
  app.use(flash);

  // Safe defaults so error pages render even if a request fails before the usual locals are set.
  Object.assign(app.locals, { currentUser: null, flash: null, path: '/', baseUrl: config.baseUrl, csrfToken: '' });
  app.locals.siteName = config.siteName;
  app.locals.siteTagline = config.siteTagline;
  app.locals.formatDate = formatDate;
  app.locals.statusLabels = workflow.LABELS;
  app.use((req, res, next) => {
    res.locals.baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;
    res.locals.path = req.path;
    next();
  });

  // Headless JSON API (read-only, public) — mounted before CSRF since it has no forms.
  app.use('/api', require('./routes/api'));

  app.use(csrf);
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/public'));

  app.use((req, res) => {
    res.status(404).render('public/404', { title: 'Page not found', meta: {} });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!config.isTest) console.error(err);
    const status = err.status || 500;
    res.status(status);
    if (req.path.startsWith('/api')) return res.json({ error: status === 500 ? 'Server error' : err.message });
    return res.render('public/error', { title: 'Something went wrong', meta: {}, message: status === 500 ? 'Something went wrong on our side.' : err.message });
  });

  return app;
}

module.exports = { createApp };
