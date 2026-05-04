// Plain JS so Jest can run it without TypeScript transformation.
// Registers ts-node manually so Knex can load .ts migration files.
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'wdp-test');

module.exports = async function globalSetup() {
  // Clean slate for each test run
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Set env vars so the Knex instance below (and any child processes) see them
  process.env.DATA_DIR    = TEST_DIR;
  process.env.SQLITE_PATH = path.join(TEST_DIR, 'control.sqlite');

  // Register ts-node so Knex can require() TypeScript migration files
  require('ts-node').register({
    project:      path.join(process.cwd(), 'tsconfig.json'),
    transpileOnly: true,
  });

  const Knex = require('knex');
  const db = Knex({
    client:           'better-sqlite3',
    connection:       { filename: path.join(TEST_DIR, 'control.sqlite') },
    useNullAsDefault: true,
    migrations: {
      directory:      path.join(process.cwd(), 'migrations'),
      extension:      'ts',
      loadExtensions: ['.ts'],
    },
  });

  try {
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
};
