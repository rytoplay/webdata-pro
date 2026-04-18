import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_fields', t => {
    t.boolean('is_indexed').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_fields', t => {
    t.dropColumn('is_indexed');
  });
}
