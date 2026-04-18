/**
 * Template token maintenance for field rename and delete operations.
 *
 * Token patterns handled:
 *   ${table.field}               — display value
 *   $update[table.field]         — edit/create form widget
 *   $search[table.field]         — search form widget
 *   $sort[table.field,Label]     — sortable column header
 *   $thumbnail[table.field]      — image thumbnail
 *
 * SQL alias pattern (in custom_sql):
 *   "table__field" AS "table__field"
 */

import { db } from '../db/knex';

const REVIEW_MARKER = (fieldName: string) =>
  `<<<WDP:REVIEW field "${fieldName}" deleted — remove surrounding HTML>>>`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Load all templates for an app ────────────────────────────────────────────

async function loadAppTemplates(appId: number) {
  const views = await db('views').where({ app_id: appId }).select('id', 'custom_sql');
  const viewIds = views.map((v: any) => v.id);
  const templates = viewIds.length
    ? await db('templates')
        .where({ app_id: appId, template_scope: 'view' })
        .whereIn('related_id', viewIds)
        .select('id', 'content_html')
    : [];
  return { views, templates };
}

// ── Rename ────────────────────────────────────────────────────────────────────

/**
 * Replace every token reference to oldFieldName with newFieldName across all
 * templates and custom_sql entries for the given app + table.
 */
export async function renameFieldInTemplates(
  appId: number,
  tableName: string,
  oldFieldName: string,
  newFieldName: string,
): Promise<void> {
  const { views, templates } = await loadAppTemplates(appId);

  const t    = escapeRegex(tableName);
  const fOld = escapeRegex(oldFieldName);

  // Matches "table.oldField" inside any token — safe because field names are
  // [a-z][a-z0-9_]* so no regex special chars, but we escape anyway.
  const tokenRef  = new RegExp(`${t}\\.${fOld}`, 'g');
  // Matches the SQL alias table__oldField (unquoted or quoted)
  const aliasRef  = new RegExp(`${t}__${fOld}`, 'g');

  for (const tmpl of templates) {
    let html = tmpl.content_html as string;
    html = html.replace(tokenRef, `${tableName}.${newFieldName}`);
    html = html.replace(aliasRef, `${tableName}__${newFieldName}`);
    if (html !== tmpl.content_html) {
      await db('templates').where({ id: tmpl.id }).update({ content_html: html });
    }
  }

  for (const view of views) {
    if (!view.custom_sql) continue;
    let sql = view.custom_sql as string;
    sql = sql.replace(aliasRef, `${tableName}__${newFieldName}`);
    if (sql !== view.custom_sql) {
      await db('views').where({ id: view.id }).update({ custom_sql: sql });
    }
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Remove every token reference to fieldName from all templates.
 *
 * Clean removal (no orphan risk):
 *   - <th> block containing $sort[table.field] → remove whole <th>
 *   - <td> block containing only ${table.field} → remove whole <td>
 *   - Any token alone on its own line → remove the line
 *
 * Ambiguous (marker injected):
 *   - Token embedded in surrounding HTML → replace with <<<WDP:REVIEW ...>>>
 *
 * Also strips the field's column from the custom_sql SELECT list.
 */
export async function deleteFieldFromTemplates(
  appId: number,
  tableName: string,
  fieldName: string,
): Promise<void> {
  const { views, templates } = await loadAppTemplates(appId);

  const t = escapeRegex(tableName);
  const f = escapeRegex(fieldName);
  const marker = REVIEW_MARKER(fieldName);

  // Any token referencing this field (used for early-exit check)
  const anyRef = new RegExp(`${t}[._]{1,2}${f}`);

  // Individual token patterns
  const pDisplay = new RegExp(`\\$\\{${t}\\.${f}\\}`, 'g');
  const pUpdate  = new RegExp(`\\$update\\[${t}\\.${f}[^\\]]*\\]`, 'g');
  const pSearch  = new RegExp(`\\$search\\[${t}\\.${f}[^\\]]*\\]`, 'g');
  const pSort    = new RegExp(`\\$sort\\[${t}\\.${f}[^\\]]*\\]`, 'g');
  const pThumb   = new RegExp(`\\$thumbnail\\[${t}\\.${f}[^\\]]*\\]`, 'g');

  for (const tmpl of templates) {
    let html = tmpl.content_html as string;
    if (!anyRef.test(html)) continue;

    // ── 1. <th>…$sort[table.field…]…</th> → remove entire <th> ──────────────
    html = html.replace(
      new RegExp(`[ \\t]*<th[^>]*>[^<]*\\$sort\\[${t}\\.${f}[^\\]]*\\][^<]*<\\/th>\\n?`, 'g'),
      '',
    );

    // ── 2. <td>…${table.field}…</td> → remove entire <td> ───────────────────
    html = html.replace(
      new RegExp(`[ \\t]*<td[^>]*>\\s*\\$\\{${t}\\.${f}\\}\\s*<\\/td>\\n?`, 'g'),
      '',
    );

    // ── 3. Tokens alone on their own line → remove the line ──────────────────
    const standaloneFormToken = new RegExp(
      `^[ \\t]*\\$(?:update|search|sort|thumbnail)\\[${t}\\.${f}[^\\]]*\\][ \\t]*\\n?`,
      'gm',
    );
    html = html.replace(standaloneFormToken, '');

    const standaloneDisplay = new RegExp(
      `^[ \\t]*\\$\\{${t}\\.${f}\\}[ \\t]*\\n?`,
      'gm',
    );
    html = html.replace(standaloneDisplay, '');

    // ── 4. Remaining occurrences → inject review marker ───────────────────────
    html = html.replace(pUpdate,  marker);
    html = html.replace(pSearch,  marker);
    html = html.replace(pSort,    marker);
    html = html.replace(pThumb,   marker);
    html = html.replace(pDisplay, marker);

    if (html !== tmpl.content_html) {
      await db('templates').where({ id: tmpl.id }).update({ content_html: html });
    }
  }

  // ── Strip column from custom_sql SELECT lists ─────────────────────────────
  for (const view of views) {
    if (!view.custom_sql) continue;
    let sql = view.custom_sql as string;

    // Remove  , "table__field" AS "table__field"  or  "table__field" AS "table__field" ,
    sql = sql.replace(
      new RegExp(`,?\\s*"${t}__${f}"(?:\\s+AS\\s+"${t}__${f}")?\\s*,?`, 'gi'),
      (m) => (m.trim().startsWith(',') && m.trim().endsWith(',') ? ',' : ''),
    );
    // Clean up  SELECT ,  or  , ,  artefacts
    sql = sql.replace(/SELECT\s*,/gi, 'SELECT ');
    sql = sql.replace(/,\s*,/g, ',');
    sql = sql.replace(/,\s*FROM/gi, ' FROM');

    if (sql !== view.custom_sql) {
      await db('views').where({ id: view.id }).update({ custom_sql: sql });
    }
  }
}
