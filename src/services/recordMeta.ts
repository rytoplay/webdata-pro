import { getAppDb } from '../db/adapters/appDb';
import type { App } from '../domain/types';

// ── Lazy table creation ──────────────────────────────────────────────────────
// _wdpro_metadata is created in the app's own database on first use.
// Using a prefixed name so DBAs can easily identify it as a WDP system table.

const _initializedApps = new Set<number>();

async function ensureMetaTable(app: App): Promise<void> {
  if (_initializedApps.has(app.id)) return;
  const appDb = getAppDb(app);
  const exists = await appDb.schema.hasTable('_wdpro_metadata');
  if (!exists) {
    await appDb.schema.createTable('_wdpro_metadata', t => {
      t.increments('id').primary();
      t.string('table_name').notNullable();
      t.string('record_id').notNullable();     // stringified PK — works for any PK type
      t.integer('created_by_id').nullable();   // member.id at creation time
      t.string('created_by_name').nullable();  // snapshot: display name or email
      t.datetime('created_at').nullable();
      t.integer('updated_by_id').nullable();   // member.id of last editor
      t.string('updated_by_name').nullable();  // snapshot
      t.datetime('updated_at').nullable();
      t.unique(['table_name', 'record_id']);
    });
  }
  _initializedApps.add(app.id);
}

// ── Public interface ─────────────────────────────────────────────────────────

export interface RecordMeta {
  created_by_id:   number | null;
  created_by_name: string | null;
  created_at:      string | null;
  updated_by_id:   number | null;
  updated_by_name: string | null;
  updated_at:      string | null;
}

export async function getRecordMeta(
  app: App,
  tableName: string,
  recordId: string | number
): Promise<RecordMeta | null> {
  await ensureMetaTable(app);
  const appDb = getAppDb(app);
  const row = await appDb('_wdpro_metadata')
    .where({ table_name: tableName, record_id: String(recordId) })
    .first();
  return row ?? null;
}

export async function touchRecordMeta(
  app: App,
  tableName: string,
  recordId: string | number,
  memberId: number | null,
  memberName: string | null,
  now: string
): Promise<void> {
  await ensureMetaTable(app);
  const appDb = getAppDb(app);
  // MySQL DATETIME requires "YYYY-MM-DD HH:MM:SS" — strip the T and fractional seconds/Z
  const ts = now.slice(0, 19).replace('T', ' ');
  const key = { table_name: tableName, record_id: String(recordId) };
  const existing = await appDb('_wdpro_metadata').where(key).first();

  if (!existing) {
    await appDb('_wdpro_metadata').insert({
      ...key,
      created_by_id:   memberId,
      created_by_name: memberName,
      created_at:      ts,
      updated_by_id:   memberId,
      updated_by_name: memberName,
      updated_at:      ts,
    });
  } else {
    await appDb('_wdpro_metadata').where(key).update({
      updated_by_id:   memberId,
      updated_by_name: memberName,
      updated_at:      ts,
    });
  }
}

// Convert a RecordMeta row into the flat _meta__* keys injected into rowData
export function metaToRowKeys(meta: RecordMeta | null): Record<string, string> {
  if (!meta) return {};
  return {
    '_meta__created_by': meta.created_by_name ?? '',
    '_meta__created_at': meta.created_at      ?? '',
    '_meta__updated_by': meta.updated_by_name ?? '',
    '_meta__updated_at': meta.updated_at      ?? '',
  };
}
