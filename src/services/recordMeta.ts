import { db } from '../db/knex';

export interface RecordMeta {
  created_by_id:   number | null;
  created_by_name: string | null;
  created_at:      string | null;
  updated_by_id:   number | null;
  updated_by_name: string | null;
  updated_at:      string | null;
}

export async function getRecordMeta(
  appId: number,
  tableName: string,
  recordId: string | number
): Promise<RecordMeta | null> {
  const row = await db('record_metadata')
    .where({ app_id: appId, table_name: tableName, record_id: String(recordId) })
    .first();
  return row ?? null;
}

export async function touchRecordMeta(
  appId: number,
  tableName: string,
  recordId: string | number,
  memberId: number | null,
  memberName: string | null,
  now: string
): Promise<void> {
  const key = { app_id: appId, table_name: tableName, record_id: String(recordId) };
  const existing = await db('record_metadata').where(key).first();

  if (!existing) {
    // First touch — set both created and updated
    await db('record_metadata').insert({
      ...key,
      created_by_id:   memberId,
      created_by_name: memberName,
      created_at:      now,
      updated_by_id:   memberId,
      updated_by_name: memberName,
      updated_at:      now,
    });
  } else {
    // Subsequent edit — update only the updated_* fields
    await db('record_metadata').where(key).update({
      updated_by_id:   memberId,
      updated_by_name: memberName,
      updated_at:      now,
    });
  }
}

// Convert a RecordMeta row into the flat _meta__* keys injected into rowData
export function metaToRowKeys(meta: RecordMeta | null): Record<string, string> {
  if (!meta) return {};
  return {
    '_meta__created_by':  meta.created_by_name ?? '',
    '_meta__created_at':  meta.created_at      ?? '',
    '_meta__updated_by':  meta.updated_by_name ?? '',
    '_meta__updated_at':  meta.updated_at      ?? '',
  };
}
