import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_tables', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('table_name').notNullable();
    t.string('label').notNullable();
    t.text('description').nullable();
    t.boolean('is_public_addable').notNullable().defaultTo(false);
    t.boolean('is_member_editable').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['app_id', 'table_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_tables');
}
