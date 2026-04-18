import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', t => {
    t.string('member_css_url').nullable();
    t.text('member_header_html').nullable();
    t.text('member_footer_html').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', t => {
    t.dropColumn('member_css_url');
    t.dropColumn('member_header_html');
    t.dropColumn('member_footer_html');
  });
}
