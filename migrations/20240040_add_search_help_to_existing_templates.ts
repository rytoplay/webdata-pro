import type { Knex } from 'knex';

/**
 * Upgrade existing search_form templates that use the old single-line layout
 * to the new .wdp-search-row wrapper with the (i) help icon.
 *
 * Only touches templates that still contain the original generated form pattern
 * (data-wdp-form="search") and don't already have the new layout.
 */
export async function up(knex: Knex): Promise<void> {
  const rows = await knex('templates')
    .where('template_type', 'search_form')
    .whereRaw(`content_html LIKE '%data-wdp-form%search%'`)
    .whereRaw(`content_html NOT LIKE '%wdp-search-row%'`)
    .select('id', 'content_html');

  const helpIcon = `
    <details class="wdp-search-help">
      <summary title="Search tips">&#x24D8;</summary>
      <div class="wdp-search-help-body">
        <strong>Search tips</strong>
        <ul>
          <li><code>pool view</code> &mdash; both words must appear</li>
          <li><code>&quot;ocean view&quot;</code> &mdash; exact phrase</li>
          <li><code>pool OR beach</code> &mdash; either word</li>
          <li><code>!condo</code> &mdash; exclude a word</li>
          <li><code>pool AND (view OR beach)</code> &mdash; grouping</li>
        </ul>
      </div>
    </details>`;

  for (const row of rows) {
    // Wrap the search input + button line in .wdp-search-row and append the (i)
    // Pattern: replace <input ... class="wdp-input"> with the wrapped version
    let html: string = row.content_html;

    // Add .wdp-search-row div after <form ...> open tag (insert before first <input)
    html = html.replace(
      /(<form[^>]*>)\s*(<input[^>]+name="q"[^>]*>)/,
      `$1\n  <div class="wdp-search-row">\n    $2`
    );

    // Close .wdp-search-row before </form> — insert help icon + closing div before </form>
    html = html.replace(
      /(<\/form>)/,
      `    ${helpIcon.trim()}\n  </div>\n$1`
    );

    if (html !== row.content_html) {
      await knex('templates').where('id', row.id).update({ content_html: html });
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Not reversible — template edits are intentional content changes
}
