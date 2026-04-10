import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('view_group_permissions', (t) => {
    t.increments('id').primary();
    t.integer('view_id').notNullable().references('id').inTable('views').onDelete('CASCADE');
    t.integer('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.boolean('can_view').notNullable().defaultTo(false);
    t.boolean('can_search_all_records').notNullable().defaultTo(false);
    t.boolean('can_search_own_records_only').notNullable().defaultTo(false);
    t.unique(['view_id', 'group_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('view_group_permissions');
}
