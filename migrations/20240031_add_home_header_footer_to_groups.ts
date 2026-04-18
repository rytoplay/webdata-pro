import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', t => {
    t.text('home_header_html').nullable();
    t.text('home_footer_html').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', t => {
    t.dropColumn('home_header_html');
    t.dropColumn('home_footer_html');
  });
}
