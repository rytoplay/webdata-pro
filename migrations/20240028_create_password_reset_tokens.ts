import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.increments('id').primary();
    t.integer('member_id').notNullable().references('id').inTable('members').onDelete('CASCADE');
    t.string('token', 64).notNullable().unique();
    t.datetime('expires_at').notNullable();
    t.datetime('used_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_tokens');
}
