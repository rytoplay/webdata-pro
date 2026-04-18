import { db } from '../db/knex';
import type { AppTable, CreateTableInput, UpdateTableInput, AppField, FieldDataType, UIWidget } from '../domain/types';
import { getApp } from './apps';
import { getAppDb } from '../db/adapters/appDb';

function mysqlTypeToWdp(raw: string): { data_type: FieldDataType; ui_widget: UIWidget } {
  const t = raw.toLowerCase().replace(/\(.*\)/, '').trim();
  if (['int', 'tinyint', 'smallint', 'mediumint'].includes(t)) return { data_type: 'integer',    ui_widget: 'number'   };
  if (t === 'bigint')                                            return { data_type: 'bigInteger', ui_widget: 'number'   };
  if (['float', 'double', 'real'].includes(t))                  return { data_type: 'float',      ui_widget: 'number'   };
  if (['decimal', 'numeric'].includes(t))                       return { data_type: 'decimal',    ui_widget: 'number'   };
  if (['varchar', 'char', 'enum', 'set'].includes(t))           return { data_type: 'string',     ui_widget: 'text'     };
  if (['text', 'tinytext', 'mediumtext', 'longtext'].includes(t)) return { data_type: 'text',     ui_widget: 'textarea' };
  if (t === 'date')                                             return { data_type: 'date',       ui_widget: 'date'     };
  if (['datetime', 'timestamp'].includes(t))                    return { data_type: 'datetime',   ui_widget: 'datetime' };
  if (t === 'time')                                             return { data_type: 'time',       ui_widget: 'time'     };
  if (t === 'json')                                             return { data_type: 'json',       ui_widget: 'textarea' };
  if (['boolean', 'bool', 'bit'].includes(t))                   return { data_type: 'boolean',    ui_widget: 'checkbox' };
  return { data_type: 'text', ui_widget: 'textarea' };
}

function sqliteTypeToWdp(raw: string): { data_type: FieldDataType; ui_widget: UIWidget } {
  const t = raw.toLowerCase().trim();
  if (t.startsWith('int') || t === 'integer')                        return { data_type: 'integer',    ui_widget: 'number'   };
  if (['float', 'double', 'real'].some(x => t.includes(x)))         return { data_type: 'float',      ui_widget: 'number'   };
  if (t.includes('decimal') || t.includes('numeric'))                return { data_type: 'decimal',    ui_widget: 'number'   };
  if (t === 'text' || t.startsWith('clob'))                          return { data_type: 'text',       ui_widget: 'textarea' };
  if (t.startsWith('varchar') || t.startsWith('char') || t === 'nvarchar') return { data_type: 'string', ui_widget: 'text' };
  if (t === 'date')                                                  return { data_type: 'date',       ui_widget: 'date'     };
  if (t === 'datetime' || t === 'timestamp')                         return { data_type: 'datetime',   ui_widget: 'datetime' };
  if (t === 'boolean' || t === 'bool')                               return { data_type: 'boolean',    ui_widget: 'checkbox' };
  return { data_type: 'text', ui_widget: 'textarea' };
}

export async function listTables(appId: number): Promise<AppTable[]> {
  return db('app_tables').where({ app_id: appId }).orderBy('label');
}

export async function getTable(id: number): Promise<AppTable | undefined> {
  return db('app_tables').where({ id }).first();
}

export async function getTableByName(appId: number, tableName: string): Promise<AppTable | undefined> {
  return db('app_tables').where({ app_id: appId, table_name: tableName }).first();
}

export async function createTable(input: CreateTableInput): Promise<AppTable> {
  const [tableId] = await db('app_tables').insert({
    app_id: input.app_id,
    table_name: input.table_name,
    label: input.label,
    description: input.description ?? null,
    is_public_addable: input.is_public_addable ?? false,
    is_member_editable: input.is_member_editable ?? false
  });

  await db('app_fields').insert({
    table_id: tableId,
    field_name: 'id',
    label: 'ID',
    data_type: 'integer',
    is_required: true,
    is_primary_key: true,
    is_auto_increment: true,
    default_value: null,
    is_searchable_default: false,
    is_visible_default: false,
    ui_widget: 'hidden',
    sort_order: 0
  });

  // Create the actual table in the app database immediately
  try {
    const app = await getApp(input.app_id);
    if (app) {
      const appDb = getAppDb(app);
      const idColDef = app.database_mode === 'mysql'
        ? `"id" INT NOT NULL AUTO_INCREMENT PRIMARY KEY`
        : `"id" INTEGER PRIMARY KEY AUTOINCREMENT`;
      await appDb.raw(`CREATE TABLE "${input.table_name}" (${idColDef})`);
    }
  } catch (ddlErr) {
    // Roll back the metadata if DDL fails
    await db('app_tables').where({ id: tableId }).delete();
    throw ddlErr;
  }

  return db('app_tables').where({ id: tableId }).first() as Promise<AppTable>;
}

export async function updateTable(id: number, input: UpdateTableInput): Promise<AppTable | undefined> {
  await db('app_tables').where({ id }).update(input);
  return getTable(id);
}

export async function deleteTable(id: number): Promise<void> {
  const table = await getTable(id);
  if (table) {
    // Drop the physical table from the app database
    try {
      const app = await getApp(table.app_id);
      if (app) {
        const appDb = getAppDb(app);
        await appDb.raw(`DROP TABLE IF EXISTS "${table.table_name}"`);
      }
    } catch { /* non-fatal — metadata cleanup proceeds regardless */ }

    // Delete related fields (SQLite FK cascade isn't enabled by default)
    await db('app_fields').where({ table_id: id }).delete();
  }
  await db('app_tables').where({ id }).delete();
}

/**
 * Register an existing physical table in app_tables without running CREATE TABLE.
 * Introspects the DB columns and registers them as app_fields automatically.
 */
export async function importExistingTable(appId: number, tableName: string): Promise<AppTable> {
  const label = tableName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const [tableId] = await db('app_tables').insert({
    app_id: appId,
    table_name: tableName,
    label,
    description: null,
    is_public_addable: false,
    is_member_editable: false
  });

  // Always register the id field first
  await db('app_fields').insert({
    table_id: tableId,
    field_name: 'id',
    label: 'ID',
    data_type: 'integer',
    is_required: true,
    is_primary_key: true,
    is_auto_increment: true,
    default_value: null,
    is_searchable_default: false,
    is_visible_default: false,
    ui_widget: 'hidden',
    sort_order: 0
  });

  // Introspect and register remaining columns
  try {
    const app = await getApp(appId);
    if (app) {
      const appDb = getAppDb(app);
      type ColInfo = { name: string; type: string; nullable: boolean };
      const columns: ColInfo[] = [];

      if (app.database_mode === 'mysql') {
        const result = await appDb.raw(`SHOW COLUMNS FROM \`${tableName}\``) as any[];
        const rows = Array.isArray(result[0]) ? result[0] : result;
        for (const row of rows) {
          if (row.Field === 'id') continue;
          columns.push({ name: row.Field, type: row.Type, nullable: row.Null === 'YES' });
        }
      } else {
        const rows = await appDb.raw(`PRAGMA table_info("${tableName}")`) as any[];
        for (const row of rows) {
          if (row.name === 'id') continue;
          columns.push({ name: row.name, type: row.type, nullable: !row.notnull });
        }
      }

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const colLabel = col.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const { data_type, ui_widget } = app.database_mode === 'mysql'
          ? mysqlTypeToWdp(col.type)
          : sqliteTypeToWdp(col.type);

        await db('app_fields').insert({
          table_id: tableId,
          field_name: col.name,
          label:      colLabel,
          data_type,
          is_required:           !col.nullable,
          is_primary_key:        false,
          is_auto_increment:     false,
          default_value:         null,
          is_searchable_default: data_type === 'string',
          is_visible_default:    true,
          ui_widget,
          sort_order: i + 1
        });
      }
    }
  } catch (err) {
    // Non-fatal — table is registered, columns can be added manually
    console.warn(`Column detection failed while importing "${tableName}":`, err);
  }

  return db('app_tables').where({ id: tableId }).first() as Promise<AppTable>;
}

export async function getTableWithFields(id: number): Promise<(AppTable & { fields: AppField[] }) | undefined> {
  const table = await getTable(id);
  if (!table) return undefined;
  const fields = await db('app_fields').where({ table_id: id }).orderBy('sort_order');
  return { ...table, fields };
}
