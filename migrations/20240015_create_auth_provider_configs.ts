import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_provider_configs', (t) => {
    t.increments('id').primary();
    t.integer('auth_provider_id')
      .notNullable()
      .references('id')
      .inTable('auth_providers')
      .onDelete('CASCADE');
    t.text('config_json').notNullable().defaultTo('{}');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_provider_configs');
}
