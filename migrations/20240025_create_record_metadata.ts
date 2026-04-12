import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('record_metadata', t => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('table_name').notNullable();
    t.string('record_id').notNullable();          // stringified PK — works for any PK type
    t.integer('created_by_id').nullable();        // member.id at creation time
    t.string('created_by_name').nullable();       // snapshot: email or display name
    t.timestamp('created_at').nullable();
    t.integer('updated_by_id').nullable();        // member.id of last editor
    t.string('updated_by_name').nullable();       // snapshot
    t.timestamp('updated_at').nullable();
    t.unique(['app_id', 'table_name', 'record_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('record_metadata');
}
