import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('_wdpro_geocode', t => {
    t.increments('id');
    t.text('address').notNullable().unique();
    t.real('lat').notNullable();
    t.real('lng').notNullable();
    t.datetime('fetched_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('_wdpro_geocode');
}
