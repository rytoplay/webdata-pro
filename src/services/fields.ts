import { db } from '../db/knex';
import type { AppField, CreateFieldInput, UpdateFieldInput } from '../domain/types';
import { getTable } from './tables';
import { getApp } from './apps';
import { getAppDb } from '../db/adapters/appDb';

const RESERVED_NAMES = new Set(['id', 'created_at', 'updated_at']);

// SQLite type map for DDL generation
const TYPE_MAP: Record<string, string> = {
  string: 'TEXT', text: 'TEXT', integer: 'INTEGER', bigInteger: 'INTEGER',
  decimal: 'REAL', float: 'REAL', boolean: 'INTEGER',
  date: 'TEXT', datetime: 'TEXT', time: 'TEXT', json: 'TEXT', uuid: 'TEXT',
  image: 'TEXT', upload: 'TEXT'
};

export function validateFieldName(name: string): string | null {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return 'Field name must start with a letter and contain only lowercase letters, numbers, and underscores';
  }
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" is a reserved field name`;
  }
  return null;
}

// Build a column definition safe for ALTER TABLE ADD COLUMN.
// SQLite rejects NOT NULL without a DEFAULT for ADD COLUMN, so we only
// include NOT NULL when the field also has a default value.
function buildAddColumnDef(field: AppField): string {
  const type = TYPE_MAP[field.data_type] ?? 'TEXT';
  const parts: string[] = [`"${field.field_name}" ${type}`];

  if (field.default_value != null && field.default_value !== '') {
    if (field.is_required) parts.push('NOT NULL');
    parts.push(`DEFAULT '${field.default_value.replace(/'/g, "''")}'`);
  }
  // Without a default, we silently drop NOT NULL — existing rows would
  // otherwise violate the constraint and SQLite would reject the ALTER TABLE.

  return parts.join(' ');
}

export async function listFields(tableId: number): Promise<AppField[]> {
  return db('app_fields').where({ table_id: tableId }).orderBy('sort_order');
}

export async function getField(id: number): Promise<AppField | undefined> {
  return db('app_fields').where({ id }).first();
}

export async function createField(input: CreateFieldInput): Promise<AppField> {
  const error = validateFieldName(input.field_name);
  if (error) throw new Error(error);

  const maxOrder = await db('app_fields')
    .where({ table_id: input.table_id })
    .max('sort_order as max')
    .first();
  const nextOrder = (maxOrder?.max ?? -1) + 1;

  const [id] = await db('app_fields').insert({
    table_id: input.table_id,
    field_name: input.field_name,
    label: input.label,
    data_type: input.data_type,
    is_required: input.is_required ?? false,
    is_primary_key: input.is_primary_key ?? false,
    is_auto_increment: input.is_auto_increment ?? false,
    default_value: input.default_value ?? null,
    is_searchable_default: input.is_searchable_default ?? false,
    is_visible_default: input.is_visible_default ?? true,
    ui_widget: input.ui_widget ?? 'text',
    ui_options_json: input.ui_options_json ?? null,
    sort_order: input.sort_order ?? nextOrder
  });

  const field = await db('app_fields').where({ id }).first() as AppField;

  // Skip DDL for primary key fields — can't add PK columns via ALTER TABLE
  if (!field.is_primary_key) {
    try {
      const table = await getTable(field.table_id);
      if (table) {
        const app = await getApp(table.app_id);
        if (app) {
          const appDb = getAppDb(app);
          await appDb.raw(`ALTER TABLE "${table.table_name}" ADD COLUMN ${buildAddColumnDef(field)}`);
        }
      }
    } catch (ddlErr) {
      // Roll back the metadata insert if DDL fails
      await db('app_fields').where({ id }).delete();
      throw ddlErr;
    }
  }

  return field;
}

export async function updateField(id: number, input: UpdateFieldInput): Promise<AppField | undefined> {
  if (input.field_name) {
    const error = validateFieldName(input.field_name);
    if (error) throw new Error(error);
  }

  const existing = await getField(id);
  await db('app_fields').where({ id }).update(input);

  // If the field name changed, rename the column in the app database
  if (input.field_name && existing && input.field_name !== existing.field_name && !existing.is_primary_key) {
    try {
      const table = await getTable(existing.table_id);
      if (table) {
        const app = await getApp(table.app_id);
        if (app) {
          const appDb = getAppDb(app);
          await appDb.raw(
            `ALTER TABLE "${table.table_name}" RENAME COLUMN "${existing.field_name}" TO "${input.field_name}"`
          );
        }
      }
    } catch { /* non-fatal — SQLite < 3.25 doesn't support RENAME COLUMN */ }
  }

  return getField(id);
}

export async function reorderFields(order: { id: number; sort_order: number }[]): Promise<void> {
  await Promise.all(
    order.map(item => db('app_fields').where({ id: item.id }).update({ sort_order: item.sort_order }))
  );
}

export async function deleteField(id: number): Promise<void> {
  const field = await getField(id);
  await db('app_fields').where({ id }).delete();

  // Drop the column from the app database (best-effort — SQLite 3.35+ only)
  if (field && !field.is_primary_key) {
    try {
      const table = await getTable(field.table_id);
      if (table) {
        const app = await getApp(table.app_id);
        if (app) {
          const appDb = getAppDb(app);
          await appDb.raw(`ALTER TABLE "${table.table_name}" DROP COLUMN "${field.field_name}"`);
        }
      }
    } catch { /* non-fatal */ }
  }
}
