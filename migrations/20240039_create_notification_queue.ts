import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_queue', t => {
    t.increments('id');
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('table_name', 255).notNullable();
    t.string('table_label', 255).nullable();
    t.string('record_id', 255).nullable();
    t.string('submitted_by', 255).nullable();
    t.datetime('queued_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_queue');
}
