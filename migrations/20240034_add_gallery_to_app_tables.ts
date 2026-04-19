import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_tables', (t) => {
    t.boolean('is_gallery').notNullable().defaultTo(false);
    t.string('gallery_parent_table').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('app_tables', (t) => {
    t.dropColumn('is_gallery');
    t.dropColumn('gallery_parent_table');
  });
}
