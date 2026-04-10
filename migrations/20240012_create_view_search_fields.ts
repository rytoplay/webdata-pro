import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('view_search_fields', (t) => {
    t.increments('id').primary();
    t.integer('view_id').notNullable().references('id').inTable('views').onDelete('CASCADE');
    t.integer('group_id').nullable().references('id').inTable('groups').onDelete('SET NULL');
    t.string('field_token').notNullable();
    t.string('search_type').notNullable().defaultTo('contains');
    t.string('label').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('view_search_fields');
}
