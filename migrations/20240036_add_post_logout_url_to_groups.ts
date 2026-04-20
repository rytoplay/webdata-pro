import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', (t) => {
    t.string('post_logout_url', 500).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', (t) => {
    t.dropColumn('post_logout_url');
  });
}
