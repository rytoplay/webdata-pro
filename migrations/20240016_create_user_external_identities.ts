import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_external_identities', (t) => {
    t.increments('id').primary();
    t.integer('member_id').notNullable().references('id').inTable('members').onDelete('CASCADE');
    t.integer('provider_id')
      .notNullable()
      .references('id')
      .inTable('auth_providers')
      .onDelete('CASCADE');
    t.string('external_subject').notNullable();
    t.string('external_email').nullable();
    t.unique(['provider_id', 'external_subject']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_external_identities');
}
