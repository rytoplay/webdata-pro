import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex('apps').where({ slug: 'demo' }).first();
  if (existing) return;

  const [appId] = await knex('apps').insert({
    name: 'Demo App',
    slug: 'demo',
    database_mode: 'sqlite',
    database_config_json: null
  });

  // Create a sample "books" table
  const [tableId] = await knex('app_tables').insert({
    app_id: appId,
    table_name: 'books',
    label: 'Books',
    description: 'Sample books table',
    is_public_addable: false,
    is_member_editable: true
  });

  // Add fields
  await knex('app_fields').insert([
    {
      table_id: tableId,
      field_name: 'title',
      label: 'Title',
      data_type: 'string',
      is_required: true,
      is_primary_key: false,
      is_auto_increment: false,
      default_value: null,
      is_searchable_default: true,
      is_visible_default: true,
      ui_widget: 'text',
      sort_order: 0
    },
    {
      table_id: tableId,
      field_name: 'author',
      label: 'Author',
      data_type: 'string',
      is_required: false,
      is_primary_key: false,
      is_auto_increment: false,
      default_value: null,
      is_searchable_default: true,
      is_visible_default: true,
      ui_widget: 'text',
      sort_order: 1
    },
    {
      table_id: tableId,
      field_name: 'published_year',
      label: 'Published year',
      data_type: 'integer',
      is_required: false,
      is_primary_key: false,
      is_auto_increment: false,
      default_value: null,
      is_searchable_default: false,
      is_visible_default: true,
      ui_widget: 'number',
      sort_order: 2
    },
    {
      table_id: tableId,
      field_name: 'summary',
      label: 'Summary',
      data_type: 'text',
      is_required: false,
      is_primary_key: false,
      is_auto_increment: false,
      default_value: null,
      is_searchable_default: false,
      is_visible_default: false,
      ui_widget: 'textarea',
      sort_order: 3
    }
  ]);

  // Default member group
  const [groupId] = await knex('groups').insert({
    app_id: appId,
    group_name: 'Members',
    description: 'Default member group',
    self_register_enabled: false,
    tfa_required: false
  });

  // Table permission for group
  await knex('group_table_permissions').insert({
    group_id: groupId,
    table_id: tableId,
    can_add: true,
    can_edit: true,
    can_delete: false,
    can_view: true,
    can_edit_all_records: false,
    can_edit_own_records_only: true,
    can_view_all_records: true,
    can_view_own_records_only: false
  });

  // Local auth provider
  await knex('auth_providers').insert({
    app_id: appId,
    provider_name: 'local',
    provider_type: 'local',
    is_enabled: true,
    is_default: true
  });

  console.log('Seed: Demo app created with books table and default group.');
}
