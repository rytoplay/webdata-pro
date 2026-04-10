import { db } from '../db/knex';
import type { AppField, CreateFieldInput, UpdateFieldInput } from '../domain/types';

const RESERVED_NAMES = new Set(['created_at', 'updated_at']);

export function validateFieldName(name: string): string | null {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return 'Field name must start with a letter and contain only lowercase letters, numbers, and underscores';
  }
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" is a reserved field name`;
  }
  return null;
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
    sort_order: input.sort_order ?? nextOrder
  });
  return db('app_fields').where({ id }).first() as Promise<AppField>;
}

export async function updateField(id: number, input: UpdateFieldInput): Promise<AppField | undefined> {
  if (input.field_name) {
    const error = validateFieldName(input.field_name);
    if (error) throw new Error(error);
  }
  await db('app_fields').where({ id }).update(input);
  return getField(id);
}

export async function deleteField(id: number): Promise<void> {
  await db('app_fields').where({ id }).delete();
}
