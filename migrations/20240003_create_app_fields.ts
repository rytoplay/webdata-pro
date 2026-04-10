import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_fields', (t) => {
    t.increments('id').primary();
    t.integer('table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.string('field_name').notNullable();
    t.string('label').notNullable();
    t.string('data_type').notNullable().defaultTo('string');
    t.boolean('is_required').notNullable().defaultTo(false);
    t.boolean('is_primary_key').notNullable().defaultTo(false);
    t.boolean('is_auto_increment').notNullable().defaultTo(false);
    t.string('default_value').nullable();
    t.boolean('is_searchable_default').notNullable().defaultTo(false);
    t.boolean('is_visible_default').notNullable().defaultTo(true);
    t.string('ui_widget').notNullable().defaultTo('text');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.unique(['table_id', 'field_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_fields');
}
