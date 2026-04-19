import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_tables', (t) => {
    t.text('ui_options_json').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_tables', (t) => {
    t.dropColumn('ui_options_json');
  });
}
