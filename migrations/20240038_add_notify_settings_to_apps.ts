import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', t => {
    t.string('notify_admin_email', 255).nullable();
    t.text('notify_tables_json').nullable();   // JSON string[]  of table_names
    t.string('notify_mode', 20).nullable();    // 'immediate' | 'daily'
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', t => {
    t.dropColumn('notify_admin_email');
    t.dropColumn('notify_tables_json');
    t.dropColumn('notify_mode');
  });
}
