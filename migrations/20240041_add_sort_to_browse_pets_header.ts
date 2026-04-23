import type { Knex } from 'knex';

/**
 * Adds $order[] sort links to the Browse Pets view header template.
 * Targets any view named 'pets_browse' (the pet-shelter app's public list view).
 */
export async function up(knex: Knex): Promise<void> {
  const view = await knex('views').where({ view_name: 'pets_browse' }).first();
  if (!view) return;

  const existing = await knex('templates')
    .where({ related_id: view.id, template_scope: 'view', template_type: 'header' })
    .first();
  if (!existing) return;

  // Only update if the header doesn't already have sort links
  if (existing.content_html.includes('$order[')) return;

  const updated = existing.content_html.replace(
    /(<span[^>]*wdp-hdr-meta[^>]*>[\s\S]*?<\/span>)/,
    `$1
  <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:0.82rem;">
    <span style="opacity:0.55;">Sort by:</span>
    $order[pets.animal_type, Type]
    $order[pets.breed, Breed]
    $order[pets.dob, DOB]
  </div>`
  );

  if (updated !== existing.content_html) {
    await knex('templates').where({ id: existing.id }).update({ content_html: updated });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Not reversible — template edits are intentional content changes
}
