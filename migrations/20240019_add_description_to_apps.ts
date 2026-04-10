import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', (t) => {
    t.string('description', 100).nullable().after('slug');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', (t) => {
    t.dropColumn('description');
  });
}
