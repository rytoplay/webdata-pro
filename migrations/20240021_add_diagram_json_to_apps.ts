import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.table('apps', t => {
    t.text('diagram_json').nullable();
  });
}

export async function down(knex: Knex) {
  await knex.schema.table('apps', t => {
    t.dropColumn('diagram_json');
  });
}
