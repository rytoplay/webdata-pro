import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('group_table_permissions', t => {
    t.boolean('single_record').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('view_group_permissions', t => {
    t.dropColumn('single_record');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('view_group_permissions', t => {
    t.boolean('single_record').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('group_table_permissions', t => {
    t.dropColumn('single_record');
  });
}
