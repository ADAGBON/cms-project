const config = require('./src/config');
const db = require('./src/config/db');
const { createApp } = require('./src/app');
const { publishDue } = require('./src/services/posts');
const { ensureSeed } = require('./src/seed');

async function main() {
  await db.connect();
  console.log('Connected to MongoDB');

  if (config.seedOnStart) await ensureSeed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`${config.siteName} running on http://localhost:${config.port}`);
  });

  // Scheduler: every minute, publish posts whose scheduled time has passed.
  const timer = setInterval(() => publishDue().catch((e) => console.error('Scheduler error', e)), 60 * 1000);
  publishDue().catch(() => {});

  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await db.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
