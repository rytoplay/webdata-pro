import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('groups', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('group_name').notNullable();
    t.text('description').nullable();
    t.boolean('self_register_enabled').notNullable().defaultTo(false);
    t.integer('default_home_view_id').nullable();
    t.boolean('tfa_required').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['app_id', 'group_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('groups');
}
