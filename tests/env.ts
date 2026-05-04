// Runs in the test worker process BEFORE any module imports.
// Sets env vars so singletons (db, appDb pool) initialise with test paths.
import os   from 'os';
import path from 'path';

const TEST_DIR = path.join(os.tmpdir(), 'wdp-test');

process.env.DATA_DIR        = TEST_DIR;
process.env.SQLITE_PATH     = path.join(TEST_DIR, 'control.sqlite');
process.env.ADMIN_USERNAME  = 'admin';
process.env.ADMIN_PASSWORD  = 'testpass';
process.env.SESSION_SECRET  = 'test-secret-do-not-use-in-prod';
// Silence pino output during tests
process.env.LOG_LEVEL       = 'silent';
