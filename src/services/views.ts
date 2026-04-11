import { db } from '../db/knex';
import { getAppDb } from '../db/adapters/appDb';
import { buildJoinQuery, parseColumnRefs } from './queryBuilder';
import type { App, View, CreateViewInput, UpdateViewInput } from '../domain/types';

// ── Template types ──────────────────────────────────────────────────────────

export const TEMPLATE_TYPES = [
  'search_form',
  'header',
  'group_header',
  'row',
  'group_footer',
  'footer',
  'detail',
] as const;

export type ViewTemplateType = typeof TEMPLATE_TYPES[number];
export type ViewTemplates = Record<ViewTemplateType, string>;

export const TEMPLATE_LABELS: Record<ViewTemplateType, string> = {
  search_form:  'Search Form',
  header:       'Header',
  group_header: 'Group Header',
  row:          'Row',
  group_footer: 'Group Footer',
  footer:       'Footer',
  detail:       'Detail View',
};

export const DEFAULT_TEMPLATES: ViewTemplates = {
  search_form: `<form data-wdp-form="search" class="wdp-search">
  <input type="text" name="q" value="\${_q}" placeholder="Search…" class="wdp-input">
  <button type="submit" class="wdp-btn">Search</button>
  \${_q ? '<a data-wdp-action="clear" class="wdp-btn-link">Clear</a>' : ''}
</form>`,
  header: `<div class="wdp-header">
  <span class="wdp-count">\${_total} record\${_total == 1 ? '' : 's'}</span>
</div>`,
  group_header: `<div class="wdp-group-header">\${_group_value}</div>`,
  row: `<div class="wdp-row" data-wdp-action="detail" data-wdp-id="\${_pk}" style="cursor:pointer;padding:0.5rem 0;border-bottom:1px solid #eee;">
  Record #\${_pk}
</div>`,
  group_footer: '',
  footer: `<div class="wdp-footer">\${_pagination}</div>`,
  detail: `<div class="wdp-detail">
  <button data-wdp-action="back" class="wdp-btn-link">&lsaquo; Back</button>
  <div class="wdp-detail-body" style="margin-top:1rem;">
    Record #\${_pk}
  </div>
</div>`,
};

// ── View CRUD ───────────────────────────────────────────────────────────────

export async function listViews(appId: number): Promise<View[]> {
  return db('views').where({ app_id: appId }).orderBy('label');
}

export async function getView(id: number): Promise<View | undefined> {
  return db('views').where({ id }).first();
}

export async function getViewByName(appId: number, viewName: string): Promise<View | undefined> {
  return db('views').where({ app_id: appId, view_name: viewName }).first();
}

export async function createView(input: CreateViewInput): Promise<View> {
  const [id] = await db('views').insert(input);
  return getView(id) as Promise<View>;
}

export async function updateView(id: number, input: UpdateViewInput): Promise<View> {
  await db('views').where({ id }).update({ ...input, updated_at: new Date().toISOString() });
  return getView(id) as Promise<View>;
}

export async function deleteView(id: number): Promise<void> {
  await db('templates').where({ related_id: id, template_scope: 'view' }).delete();
  await db('views').where({ id }).delete();
}

// ── Template CRUD ───────────────────────────────────────────────────────────

export async function getViewTemplates(appId: number, viewId: number): Promise<ViewTemplates> {
  const rows = await db('templates')
    .where({ app_id: appId, related_id: viewId, template_scope: 'view' })
    .select('template_type', 'content_html');

  const result: ViewTemplates = { ...DEFAULT_TEMPLATES };
  for (const row of rows) {
    if (TEMPLATE_TYPES.includes(row.template_type as ViewTemplateType)) {
      result[row.template_type as ViewTemplateType] = row.content_html;
    }
  }
  return result;
}

export async function saveViewTemplates(
  appId: number,
  viewId: number,
  templates: Partial<ViewTemplates>
): Promise<void> {
  for (const [type, content] of Object.entries(templates)) {
    const existing = await db('templates')
      .where({ app_id: appId, related_id: viewId, template_scope: 'view', template_type: type })
      .first();

    if (existing) {
      await db('templates').where({ id: existing.id }).update({ content_html: content });
    } else {
      await db('templates').insert({
        app_id: appId,
        template_scope: 'view',
        template_type: type,
        related_id: viewId,
        content_html: content ?? '',
      });
    }
  }
}

// ── SQL generation ──────────────────────────────────────────────────────────

/** Parse ${table.field} tokens from view templates, ignoring system ${_*} tokens */
export function parseViewTokens(templates: Partial<ViewTemplates>) {
  const combined = Object.values(templates).filter(Boolean).join('\n');
  return parseColumnRefs(combined).filter(r => !r.table.startsWith('_'));
}

export async function generateViewSql(
  appId: number,
  baseTableName: string,
  templates: Partial<ViewTemplates>
): Promise<string> {
  const tokens = parseViewTokens(templates);

  // Always include the base table's PK so ${_pk} and detail navigation work,
  // even when the template never explicitly references it.
  const pkField = await db('app_fields')
    .join('app_tables', 'app_fields.table_id', 'app_tables.id')
    .where({ 'app_tables.app_id': appId, 'app_tables.table_name': baseTableName, 'app_fields.is_primary_key': true })
    .select('app_fields.field_name')
    .first();

  if (pkField) {
    const pkRef = { table: baseTableName, field: pkField.field_name as string };
    const alreadyPresent = tokens.some(t => t.table === pkRef.table && t.field === pkRef.field);
    if (!alreadyPresent) tokens.unshift(pkRef);
  }

  if (tokens.length === 0) {
    return `SELECT *\nFROM "${baseTableName}"`;
  }
  const result = await buildJoinQuery(appId, baseTableName, tokens);
  return result.sql;
}

// ── Token rendering ─────────────────────────────────────────────────────────

export function renderTokens(template: string, data: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, token: string) => {
    if (token in data) return String(data[token] ?? '');
    if (token.includes('.')) {
      const alias = token.replace('.', '__');
      if (alias in data) return String(data[alias] ?? '');
    }
    return '';
  });
}

function buildPaginationHtml(page: number, totalPages: number): string {
  if (totalPages <= 1) return '';
  const prev = page > 1
    ? `<button data-wdp-action="page" data-wdp-page="${page - 1}" class="wdp-page-btn">&lsaquo; Prev</button>`
    : `<button class="wdp-page-btn" disabled>&lsaquo; Prev</button>`;
  const next = page < totalPages
    ? `<button data-wdp-action="page" data-wdp-page="${page + 1}" class="wdp-page-btn">Next &rsaquo;</button>`
    : `<button class="wdp-page-btn" disabled>Next &rsaquo;</button>`;
  return `<div class="wdp-pagination">${prev} <span class="wdp-page-info">Page ${page} of ${totalPages}</span> ${next}</div>`;
}

// ── View rendering ──────────────────────────────────────────────────────────

export interface RenderParams {
  q?: string;
  page?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export async function renderViewList(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  params: RenderParams
): Promise<string> {
  const appDb   = getAppDb(app);
  const page     = Math.max(1, params.page ?? 1);
  const pageSize = view.pagination_enabled ? (view.page_size ?? 25) : 10000;
  const offset   = (page - 1) * pageSize;

  // Load pk field for the base table
  const pkField = await db('app_fields')
    .where({ table_id: view.base_table_id, is_primary_key: true })
    .first();
  const pkName = pkField?.field_name ?? 'id';

  // Build base SQL
  let baseSql: string;
  if (view.query_mode === 'advanced_sql' && view.custom_sql) {
    baseSql = view.custom_sql;
  } else {
    baseSql = await generateViewSql(app.id, baseTableName, templates);
  }

  // Determine sort — for auto SQL the columns are aliased as table__field,
  // so we must prefix the sort/group field names with the base table name.
  const isAuto = view.query_mode !== 'advanced_sql';
  const rawSort  = params.sort ?? view.primary_sort_field ?? null;
  const sortField = rawSort ? (isAuto ? `${baseTableName}__${rawSort}` : rawSort) : null;
  const sortDir   = (params.dir ?? view.primary_sort_direction ?? 'asc').toUpperCase();
  const rawSecondary = view.secondary_sort_field ?? null;
  const secondarySort = rawSecondary ? (isAuto ? `${baseTableName}__${rawSecondary}` : rawSecondary) : null;
  const rawGroup = view.grouping_field ?? null;
  const groupField = rawGroup ? (isAuto ? `${baseTableName}__${rawGroup}` : rawGroup) : null;

  // Wrap for search + sort + count
  const q = params.q?.trim() ?? '';
  let whereSql = '';

  if (q && view.query_mode !== 'advanced_sql') {
    // Determine searchable fields from tokens
    const tokens = parseViewTokens(templates);
    const fieldTypes = await db('app_fields')
      .whereIn('table_id', await db('app_tables').where({ app_id: app.id }).pluck('id'))
      .select('field_name', 'data_type');
    const textTypes = new Set(['text', 'varchar', 'char', 'string', 'json']);
    const fieldTypeMap = new Map(fieldTypes.map(f => [f.field_name, f.data_type]));

    const searchableCols = tokens
      .filter(t => {
        const dt = fieldTypeMap.get(t.field) ?? 'text';
        return textTypes.has(dt.toLowerCase());
      })
      .map(t => `"${t.table}__${t.field}"`);

    if (searchableCols.length > 0) {
      const likeClause = searchableCols.map(c => `${c} LIKE ?`).join(' OR ');
      whereSql = `WHERE (${likeClause})`;
    }
  }

  const likeBindings = q && whereSql
    ? whereSql.split('?').length - 1 > 0
      ? Array(whereSql.split('?').length - 1).fill(`%${q.replace(/'/g, "''")}%`)
      : []
    : [];

  const outerSql = `SELECT * FROM (${baseSql}) AS _v ${whereSql}`;

  let sortSql = '';
  if (sortField) {
    sortSql = ` ORDER BY "${sortField}" ${sortDir}`;
    if (secondarySort) sortSql += `, "${secondarySort}" ASC`;
  }

  // Total count
  const countResult = await appDb.raw(
    `SELECT COUNT(*) AS _t FROM (${outerSql}) AS _c`,
    likeBindings
  );
  const total      = Number(((countResult as unknown[])[0] as Record<string, unknown>)?.['_t'] ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Data rows
  const rows = await appDb.raw(
    `${outerSql}${sortSql} LIMIT ? OFFSET ?`,
    [...likeBindings, pageSize, offset]
  ) as Record<string, unknown>[];

  // System data
  const sys: Record<string, unknown> = {
    _q:           q,
    _page:        page,
    _total:       total,
    _total_pages: totalPages,
    _has_prev:    page > 1 ? 'true' : '',
    _has_next:    page < totalPages ? 'true' : '',
    _prev_page:   Math.max(1, page - 1),
    _next_page:   Math.min(totalPages, page + 1),
    _sort:        sortField ?? '',
    _dir:         sortDir.toLowerCase(),
    _pagination:  buildPaginationHtml(page, totalPages),
  };

  const parts: string[] = [];

  parts.push(renderTokens(templates.search_form, sys));
  parts.push(renderTokens(templates.header, sys));

  let lastGroup: unknown = Symbol('none');
  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const pkVal  = String(row[pkName] ?? row[`${baseTableName}__${pkName}`] ?? '');
    const rowData = { ...sys, ...row, _pk: pkVal, _row_num: offset + i + 1 };

    if (groupField) {
      const gv = row[groupField];
      if (gv !== lastGroup) {
        if (lastGroup !== Symbol('none') && templates.group_footer)
          parts.push(renderTokens(templates.group_footer, { ...rowData, _group_value: String(lastGroup) }));
        if (templates.group_header)
          parts.push(renderTokens(templates.group_header, { ...rowData, _group_value: String(gv) }));
        lastGroup = gv;
      }
    }

    parts.push(renderTokens(templates.row, rowData));
  }

  if (groupField && lastGroup !== Symbol('none') && templates.group_footer)
    parts.push(renderTokens(templates.group_footer, { ...sys, _group_value: String(lastGroup) }));

  parts.push(renderTokens(templates.footer, sys));

  return parts.join('\n');
}

export async function renderViewDetail(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  recordId: string
): Promise<string> {
  const appDb  = getAppDb(app);
  const pkField = await db('app_fields')
    .where({ table_id: view.base_table_id, is_primary_key: true })
    .first();
  const pkName = pkField?.field_name ?? 'id';

  let baseSql: string;
  let pkAlias: string;
  if (view.query_mode === 'advanced_sql' && view.custom_sql) {
    baseSql  = view.custom_sql;
    pkAlias  = pkName;  // custom SQL uses whatever the user named it
  } else {
    baseSql  = await generateViewSql(app.id, baseTableName, templates);
    pkAlias  = `${baseTableName}__${pkName}`;  // auto SQL always aliases as table__field
  }

  const rows = await appDb.raw(
    `SELECT * FROM (${baseSql}) AS _v WHERE "${pkAlias}" = ? LIMIT 1`,
    [recordId]
  ) as Record<string, unknown>[];

  if (!rows.length) return '<p class="wdp-error">Record not found.</p>';

  const row     = rows[0];
  const pkVal   = String(row[pkName] ?? row[`${baseTableName}__${pkName}`] ?? recordId);
  const rowData = { _pk: pkVal, _row_num: 1, ...row };

  return renderTokens(templates.detail, rowData);
}
