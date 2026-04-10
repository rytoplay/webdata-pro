import Knex from 'knex';
import path from 'path';
import fs from 'fs';
import type { App, SqliteConfig } from '../../domain/types';

// Cache one Knex instance per app to avoid re-opening the file on every request
const pool = new Map<number, Knex.Knex>();

export function getAppDb(app: App): Knex.Knex {
  if (pool.has(app.id)) return pool.get(app.id)!;

  if (app.database_mode !== 'sqlite') {
    throw new Error(`Database mode "${app.database_mode}" is not yet supported`);
  }

  const cfg = JSON.parse(app.database_config_json || '{}') as Partial<SqliteConfig>;
  // Fall back to a path derived from the app slug if config is missing
  const rawPath = cfg.path ?? `./data/${app.slug}.sqlite`;
  const filePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);

  // Ensure the directory exists (SQLite won't create it)
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = Knex({
    client: 'better-sqlite3',
    connection: { filename: filePath },
    useNullAsDefault: true
  });

  pool.set(app.id, db);
  return db;
}

// Call when an app is deleted or its DB config changes
export function releaseAppDb(appId: number): void {
  const db = pool.get(appId);
  if (db) {
    db.destroy();
    pool.delete(appId);
  }
}
