import { createApp } from './app';
import { config } from './config';
import { db } from './db/knex';

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

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Webdata Pro 2.0 running at http://localhost:${config.port}`);
    console.log(`Admin panel: http://localhost:${config.port}/admin`);
    console.log(`Environment: ${config.env}`);
  });
}

start();
