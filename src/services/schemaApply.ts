import { getAppDb } from '../db/adapters/appDb';
import { db as controlDb } from '../db/knex';
import type { App, AppTable, AppField, AppIndex, FieldDataType } from '../domain/types';

// Map our field data types to SQLite column types
const TYPE_MAP: Record<FieldDataType, string> = {
  string:     'TEXT',
  text:       'TEXT',
  integer:    'INTEGER',
  bigInteger: 'INTEGER',
  decimal:    'REAL',
  float:      'REAL',
  boolean:    'INTEGER',
  date:       'TEXT',
  datetime:   'TEXT',
  time:       'TEXT',
  json:       'TEXT',
  uuid:       'TEXT',
  image:      'TEXT',
  upload:     'TEXT',
};

function buildColumnDef(field: AppField): string {
  // INTEGER PRIMARY KEY AUTOINCREMENT is the standard SQLite rowid alias
  if (field.is_primary_key && field.is_auto_increment) {
    return `"${field.field_name}" INTEGER PRIMARY KEY AUTOINCREMENT`;
  }

  const type = TYPE_MAP[field.data_type] ?? 'TEXT';
  const parts: string[] = [`"${field.field_name}" ${type}`];

  if (field.is_primary_key) parts.push('PRIMARY KEY');
  if (field.is_required && !field.is_primary_key) parts.push('NOT NULL');
  if (field.default_value != null && field.default_value !== '') {
    parts.push(`DEFAULT '${field.default_value.replace(/'/g, "''")}'`);
  }

  return parts.join(' ');
}

export type ApplyAction = 'created' | 'updated' | 'unchanged' | 'error';

export interface TableApplyResult {
  table_name: string;
  label: string;
  action: ApplyAction;
  columns_added: string[];
  error?: string;
}

export interface SchemaApplyResult {
  tables: TableApplyResult[];
  success: boolean;
}

export async function applySchema(app: App): Promise<SchemaApplyResult> {
  const appDb = getAppDb(app);

  const tables: AppTable[] = await controlDb('app_tables')
    .where({ app_id: app.id })
    .orderBy('label');

  if (tables.length === 0) {
    return { tables: [], success: true };
  }

  const tableIds = tables.map(t => t.id);

  const allFields: AppField[] = await controlDb('app_fields')
    .whereIn('table_id', tableIds)
    .orderBy('sort_order');

  const fieldsByTable = new Map<number, AppField[]>();
  for (const field of allFields) {
    if (!fieldsByTable.has(field.table_id)) fieldsByTable.set(field.table_id, []);
    fieldsByTable.get(field.table_id)!.push(field);
  }

  const results: TableApplyResult[] = [];

  for (const table of tables) {
    const fields = fieldsByTable.get(table.id) ?? [];
    const result: TableApplyResult = {
      table_name: table.table_name,
      label: table.label,
      action: 'unchanged',
      columns_added: []
    };

    try {
      const tableExists = await appDb.schema.hasTable(table.table_name);

      if (!tableExists) {
        if (fields.length === 0) {
          result.action = 'error';
          result.error = 'No fields defined — add fields before applying';
        } else {
          const colDefs = fields.map(buildColumnDef).join(',\n  ');
          await appDb.raw(`CREATE TABLE "${table.table_name}" (\n  ${colDefs}\n)`);
          result.action = 'created';
        }
      } else {
        // Table exists — find and add any missing columns
        const existingCols = await appDb(table.table_name).columnInfo();
        const existingNames = new Set(Object.keys(existingCols));

        for (const field of fields) {
          if (!existingNames.has(field.field_name)) {
            await appDb.raw(`ALTER TABLE "${table.table_name}" ADD COLUMN ${buildColumnDef(field)}`);
            result.columns_added.push(field.label || field.field_name);
          }
        }

        if (result.columns_added.length > 0) result.action = 'updated';
      }
    } catch (err) {
      result.action = 'error';
      result.error = err instanceof Error ? err.message : String(err);
    }

    results.push(result);
  }

  // Apply indexes (non-fatal — log but continue)
  const indexes: AppIndex[] = await controlDb('app_indexes').whereIn('table_id', tableIds);
  for (const index of indexes) {
    const table = tables.find(t => t.id === index.table_id);
    if (!table) continue;
    try {
      const cols = (JSON.parse(index.column_list_json) as string[])
        .map(c => `"${c}"`)
        .join(', ');
      const unique = index.index_type === 'unique' ? 'UNIQUE ' : '';
      await appDb.raw(
        `CREATE ${unique}INDEX IF NOT EXISTS "${index.index_name}" ON "${table.table_name}" (${cols})`
      );
    } catch { /* non-fatal */ }
  }

  return {
    tables: results,
    success: results.every(r => r.action !== 'error')
  };
}

// Returns which of the given table names actually exist in the app's database
export async function getAppliedTables(app: App, tableNames: string[]): Promise<Set<string>> {
  if (tableNames.length === 0) return new Set();
  try {
    const appDb = getAppDb(app);
    const applied = new Set<string>();
    await Promise.all(
      tableNames.map(async (name) => {
        if (await appDb.schema.hasTable(name)) applied.add(name);
      })
    );
    return applied;
  } catch {
    return new Set();
  }
}
