import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('members', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.string('email').notNullable();
    t.string('username').nullable();
    t.string('password_hash').notNullable();
    t.string('first_name').nullable();
    t.string('last_name').nullable();
    t.string('avatar_url').nullable();
    t.string('phone').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.string('tfa_secret').nullable();
    t.timestamps(true, true);
    t.unique(['app_id', 'email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('members');
}
