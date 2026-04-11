import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.table('apps', t => {
    t.text('allowed_origins_json').nullable();   // JSON array of allowed CORS origins
  });
}

export async function down(knex: Knex) {
  await knex.schema.table('apps', t => {
    t.dropColumn('allowed_origins_json');
  });
}
