import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_indexes', (t) => {
    t.increments('id').primary();
    t.integer('table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.string('index_name').notNullable();
    t.string('index_type').notNullable().defaultTo('normal');
    t.text('column_list_json').notNullable();
    t.unique(['table_id', 'index_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_indexes');
}
