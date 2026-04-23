import type { Knex } from 'knex';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

// If DATA_DIR is set (e.g. a Railway Volume at /data), default the control DB
// and session DB there so everything lives on the same persistent disk.
const dataDir      = process.env.DATA_DIR;
const defaultSqlitePath = dataDir
  ? path.join(dataDir, 'webdata-pro.sqlite')
  : './webdata-pro.sqlite';
const sqlitePath   = process.env.SQLITE_PATH || defaultSqlitePath;

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: sqlitePath
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations',
      extension: 'ts',
      loadExtensions: ['.ts']
    },
    seeds: {
      directory: './seeds',
      extension: 'ts',
      loadExtensions: ['.ts']
    }
  },

  production: {
    client: 'better-sqlite3',
    connection: {
      filename: sqlitePath
    },
    useNullAsDefault: true,
    migrations: {
      directory: './dist/migrations',
      extension: 'js'
    },
    seeds: {
      directory: './dist/seeds',
      extension: 'js'
    }
  }
};

export default config;
