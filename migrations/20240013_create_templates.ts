import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('templates', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('template_scope').notNullable();
    t.string('template_type').notNullable();
    t.integer('related_id').nullable();
    t.text('content_html').notNullable().defaultTo('');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('templates');
}
