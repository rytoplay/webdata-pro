import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: process.env.SQLITE_PATH || './webdata-pro.sqlite'
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
      filename: process.env.SQLITE_PATH || './webdata-pro.sqlite'
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
