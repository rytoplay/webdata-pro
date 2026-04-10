import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_providers', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('provider_name').notNullable();
    t.string('provider_type').notNullable().defaultTo('local');
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.boolean('is_default').notNullable().defaultTo(false);
    t.unique(['app_id', 'provider_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_providers');
}
