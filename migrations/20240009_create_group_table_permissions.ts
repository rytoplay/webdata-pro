import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('group_table_permissions', (t) => {
    t.increments('id').primary();
    t.integer('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.integer('table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.boolean('can_add').notNullable().defaultTo(false);
    t.boolean('can_edit').notNullable().defaultTo(false);
    t.boolean('can_delete').notNullable().defaultTo(false);
    t.boolean('can_view').notNullable().defaultTo(false);
    t.boolean('can_edit_all_records').notNullable().defaultTo(false);
    t.boolean('can_edit_own_records_only').notNullable().defaultTo(false);
    t.boolean('can_view_all_records').notNullable().defaultTo(false);
    t.boolean('can_view_own_records_only').notNullable().defaultTo(false);
    t.unique(['group_id', 'table_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('group_table_permissions');
}
