import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('views', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('view_name').notNullable();
    t.string('label').notNullable();
    t.integer('base_table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.boolean('is_public').notNullable().defaultTo(false);
    t.boolean('pagination_enabled').notNullable().defaultTo(true);
    t.integer('page_size').notNullable().defaultTo(25);
    t.string('query_mode').notNullable().defaultTo('automatic');
    t.text('custom_sql').nullable();
    t.string('primary_sort_field').nullable();
    t.string('primary_sort_direction').nullable();
    t.string('secondary_sort_field').nullable();
    t.string('secondary_sort_direction').nullable();
    t.string('grouping_field').nullable();
    t.timestamps(true, true);
    t.unique(['app_id', 'view_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('views');
}
