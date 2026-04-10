import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('member_group_assignments', (t) => {
    t.increments('id').primary();
    t.integer('member_id').notNullable().references('id').inTable('members').onDelete('CASCADE');
    t.integer('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.unique(['member_id', 'group_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('member_group_assignments');
}
