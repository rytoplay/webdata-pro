import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_fields', (t) => {
    t.text('ui_options_json').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_fields', (t) => {
    t.dropColumn('ui_options_json');
  });
}
