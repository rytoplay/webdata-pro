import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // group_table_permissions: add manage_all (overrides own-record restriction)
  await knex.schema.alterTable('group_table_permissions', t => {
    t.boolean('manage_all').notNullable().defaultTo(false);
  });

  // view_group_permissions: add limit_to_own_records (replaces can_search_own_records_only)
  await knex.schema.alterTable('view_group_permissions', t => {
    t.boolean('limit_to_own_records').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('group_table_permissions', t => {
    t.dropColumn('manage_all');
  });
  await knex.schema.alterTable('view_group_permissions', t => {
    t.dropColumn('limit_to_own_records');
  });
}
