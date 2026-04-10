import { db } from '../db/knex';
import type { AppTable, CreateTableInput, UpdateTableInput, AppField } from '../domain/types';

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

  return db('app_tables').where({ id: tableId }).first() as Promise<AppTable>;
}

export async function updateTable(id: number, input: UpdateTableInput): Promise<AppTable | undefined> {
  await db('app_tables').where({ id }).update(input);
  return getTable(id);
}

export async function deleteTable(id: number): Promise<void> {
  await db('app_tables').where({ id }).delete();
}

export async function getTableWithFields(id: number): Promise<(AppTable & { fields: AppField[] }) | undefined> {
  const table = await getTable(id);
  if (!table) return undefined;
  const fields = await db('app_fields').where({ table_id: id }).orderBy('sort_order');
  return { ...table, fields };
}
