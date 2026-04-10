import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_joins', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.integer('left_table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.string('left_field_name').notNullable();
    t.integer('right_table_id').notNullable().references('id').inTable('app_tables').onDelete('CASCADE');
    t.string('right_field_name').notNullable();
    t.string('join_type_default').notNullable().defaultTo('left');
    t.string('relationship_label').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_joins');
}
