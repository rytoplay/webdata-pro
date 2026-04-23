import { createApp } from './app';
import { config } from './config';
import { db } from './db/knex';
import { sendDailyDigest } from './services/email';
import { maybeSeedDemo } from './services/seedDemo';

async function start() {
  try {
    await db.raw('SELECT 1');
    console.log('Database connection OK');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }

  try {
    const [completed] = await db.migrate.latest();
    if (completed.length > 0) {
      console.log(`Migrations applied: ${completed.join(', ')}`);
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }

  await maybeSeedDemo().catch(err => {
    console.warn('[seed] Demo seed failed (non-fatal):', err);
  });

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Webdata Pro 2.0 running at http://localhost:${config.port}`);
    console.log(`Admin panel: http://localhost:${config.port}/admin`);
    console.log(`Environment: ${config.env}`);
  });

  // Daily digest — runs once per day (every 24 hours)
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    sendDailyDigest().catch((err: unknown) => {
      console.error('[daily-digest] failed:', err);
    });
  }, TWENTY_FOUR_HOURS);
}

start();
