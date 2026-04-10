import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_audit_log', (t) => {
    t.increments('id').primary();
    t.integer('app_id').notNullable().references('id').inTable('apps').onDelete('CASCADE');
    t.integer('member_id').nullable().references('id').inTable('members').onDelete('SET NULL');
    t.integer('provider_id')
      .nullable()
      .references('id')
      .inTable('auth_providers')
      .onDelete('SET NULL');
    t.string('event_type').notNullable();
    t.text('event_data_json').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_audit_log');
}
