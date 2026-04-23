import type { Knex } from 'knex';

/**
 * The Browse Pets view uses advanced_sql mode. dob was only used inside
 * the julianday() age computation and was never selected as its own alias,
 * so ORDER BY "pets__dob" failed. Add it to the SELECT.
 */
export async function up(knex: Knex): Promise<void> {
  const view = await knex('views').where({ view_name: 'pets_browse' }).first();
  if (!view || !view.custom_sql) return;
  if (view.custom_sql.includes('pets__dob')) return; // already fixed

  const updated = view.custom_sql.replace(
    /("pets"\."breed" AS "pets__breed")/,
    `$1,\n  "pets"."dob" AS "pets__dob"`
  );

  if (updated !== view.custom_sql) {
    await knex('views').where({ id: view.id }).update({ custom_sql: updated });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Not reversible
}
