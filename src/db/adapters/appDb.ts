import Knex from 'knex';
import path from 'path';
import fs from 'fs';
import type { App, SqliteConfig, RemoteDbConfig } from '../../domain/types';

// Cache one Knex instance per app to avoid re-opening the file on every request
const pool = new Map<number, Knex.Knex>();

export function getAppDb(app: App): Knex.Knex {
  if (pool.has(app.id)) return pool.get(app.id)!;

  let db: Knex.Knex;

  if (app.database_mode === 'sqlite') {
    const cfg = JSON.parse(app.database_config_json || '{}') as Partial<SqliteConfig>;
    const dataDir  = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
    const rawPath  = cfg.path ?? path.join(dataDir, `${app.slug}.sqlite`);
    const filePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: filePath },
      useNullAsDefault: true,
    });

  } else if (app.database_mode === 'mysql') {
    const cfg = JSON.parse(app.database_config_json || '{}') as Partial<RemoteDbConfig>;

    db = Knex({
      client: 'mysql2',
      connection: {
        host:     cfg.host     ?? 'localhost',
        port:     cfg.port     ?? 3306,
        database: cfg.database ?? '',
        user:     cfg.username ?? 'root',
        password: cfg.password ?? '',
      },
      useNullAsDefault: true,
      // Enable ANSI_QUOTES so double-quoted identifiers work (same as SQLite/Postgres)
      pool: {
        afterCreate(conn: any, done: (err: Error | null, conn: any) => void) {
          conn.query('SET SESSION sql_mode = CONCAT(@@sql_mode, ",ANSI_QUOTES")', (err: Error | null) => done(err, conn));
        },
      },
    });

  } else {
    throw new Error(`Database mode "${app.database_mode}" is not yet supported`);
  }

  pool.set(app.id, db);
  return db;
}

// ── MySQL database bootstrap ─────────────────────────────────────────────────

export interface MysqlDbCheckResult {
  created: boolean;
  existingTables: string[];
}

/**
 * For MySQL/Postgres app creation: ensure the target database exists.
 * - If it doesn't exist, creates it and returns { created: true, existingTables: [] }
 * - If it exists and is empty, returns { created: false, existingTables: [] }
 * - If it exists and has tables, returns { created: false, existingTables: [...] }
 */
export async function ensureMysqlDatabase(cfg: {
  host?: string; port?: number; database?: string; username?: string; password?: string;
}): Promise<MysqlDbCheckResult> {
  const host     = cfg.host     ?? 'localhost';
  const port     = cfg.port     ?? 3306;
  const dbName   = (cfg.database ?? '').trim();
  const user     = cfg.username ?? '';
  const password = cfg.password ?? '';

  if (!dbName) return { created: false, existingTables: [] };

  // Connect without selecting a database
  const init = Knex({
    client: 'mysql2',
    connection: { host, port, database: '', user, password },
    pool: { min: 0, max: 1 },
  });

  try {
    // Check if database exists
    const rows = await init.raw('SHOW DATABASES LIKE ?', [dbName]) as any[];
    const exists = (Array.isArray(rows[0]) ? rows[0] : rows).length > 0;

    if (!exists) {
      await init.raw(`CREATE DATABASE \`${dbName}\``);
      return { created: true, existingTables: [] };
    }

    // Database exists — check for tables
    const tableRows = await init.raw(`SHOW TABLES IN \`${dbName}\``) as any[];
    const tables: string[] = (Array.isArray(tableRows[0]) ? tableRows[0] : tableRows)
      .map((r: Record<string, string>) => Object.values(r)[0]);
    return { created: false, existingTables: tables };
  } finally {
    await init.destroy();
  }
}

// Call when an app is deleted or its DB config changes
export function releaseAppDb(appId: number): void {
  const db = pool.get(appId);
  if (db) {
    db.destroy();
    pool.delete(appId);
  }
}

/** Returns the SQL expression to cast a value to a string, compatible with both SQLite and MySQL */
export function castToText(app: App, expr: string): string {
  return app.database_mode === 'mysql' ? `CAST(${expr} AS CHAR)` : `CAST(${expr} AS TEXT)`;
}
