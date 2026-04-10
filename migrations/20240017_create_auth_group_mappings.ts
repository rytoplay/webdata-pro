import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_group_mappings', (t) => {
    t.increments('id').primary();
    t.integer('provider_id')
      .notNullable()
      .references('id')
      .inTable('auth_providers')
      .onDelete('CASCADE');
    t.string('provider_group_value').notNullable();
    t.integer('internal_group_id')
      .notNullable()
      .references('id')
      .inTable('groups')
      .onDelete('CASCADE');
    t.unique(['provider_id', 'provider_group_value']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_group_mappings');
}
