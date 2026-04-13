import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', t => {
    t.text('home_template').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', t => {
    t.dropColumn('home_template');
  });
}
