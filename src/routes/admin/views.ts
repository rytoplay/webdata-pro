import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';
import * as tablesService from '../../services/tables';
import * as aiService from '../../services/ai';
import { CSS_CLASS_REFERENCE } from '../../services/blueprintPrompt';
import { buildStarterTemplates } from '../../services/templateGen';

export const viewsRouter = Router();

function buildPublicInputSnippet(field: {
  field_name: string;
  ui_widget: string;
  ui_options_json: string | null;
  is_required: boolean;
}): string {
  const name = field.field_name;
  const id   = `f-${name}`;
  const req  = field.is_required ? ' required' : '';

  if (field.ui_widget === 'textarea') {
    let rows = 3;
    try { rows = (JSON.parse(field.ui_options_json ?? '{}') as { rows?: number }).rows ?? 3; } catch {}
    return `<textarea name="${name}" id="${id}" rows="${rows}"${req}></textarea>`;
  }
  if (field.ui_widget === 'checkbox') {
    return `<input type="checkbox" name="${name}" id="${id}" value="on">`;
  }
  if (field.ui_widget === 'select') {
    let opts: string[] = [];
    try { opts = (JSON.parse(field.ui_options_json ?? '{}') as { options?: string[] }).options ?? []; } catch {}
    const optHtml = ['', ...opts]
      .map(o => `<option value="${o}">${o || '— select —'}</option>`).join('');
    return `<select name="${name}" id="${id}"${req}>${optHtml}</select>`;
  }
  const typeMap: Record<string, string> = {
    number: 'number', date: 'date', datetime: 'datetime-local', email: 'email',
  };
  const inputType = typeMap[field.ui_widget] ?? 'text';
  if (inputType === 'text') {
    let maxlen = 255;
    try { maxlen = (JSON.parse(field.ui_options_json ?? '{}') as { max_length?: number }).max_length ?? 255; } catch {}
    return `<input type="text" name="${name}" id="${id}" value="" maxlength="${maxlen}"${req}>`;
  }
  return `<input type="${inputType}" name="${name}" id="${id}"${req}>`;
}

const ViewSchema = z.object({
  view_name:               z.string().min(1).regex(/^[a-z0-9_-]+$/, 'URL slug: lowercase letters, numbers, - or _'),
  label:                   z.string().min(1),
  base_table_id:           z.coerce.number().int().positive(),
  is_public:               z.preprocess(v => v === 'on' || v === true || v === '1', z.boolean()).optional(),
  pagination_enabled:      z.preprocess(v => v === 'on' || v === true || v === '1', z.boolean()).optional(),
  page_size:               z.coerce.number().int().min(1).max(500).optional(),
  query_mode:              z.enum(['automatic', 'advanced_sql']).optional(),
  custom_sql:              z.string().optional().nullable(),
  primary_sort_field:      z.string().optional().nullable(),
  primary_sort_direction:  z.enum(['asc', 'desc']).optional().nullable(),
  secondary_sort_field:    z.string().optional().nullable(),
  secondary_sort_direction:z.enum(['asc', 'desc']).optional().nullable(),
  // grouping_field is derived: if group_by_sort checkbox is on, it equals primary_sort_field
  group_by_sort:           z.preprocess(v => v === 'on' || v === true || v === '1', z.boolean()).optional(),
  grouping_field:          z.string().optional().nullable(),
}).transform(data => {
  // Derive grouping_field from primary_sort_field when checkbox is checked
  const grouping_field = data.group_by_sort ? (data.primary_sort_field ?? null) : null;
  const { group_by_sort: _, ...rest } = data;
  return { ...rest, grouping_field };
});

type FieldInfo = { field_name: string; label: string; ui_widget: string; ui_options_json: string | null; is_required: boolean };

function buildChildFormBlock(
  appSlug: string,
  childTableName: string,
  fkFieldName: string,
  baseTableName: string,
  basePkFieldName: string,
  fields: FieldInfo[],
): string {
  const action   = `/api/v/${appSlug}/form/${childTableName}`;
  const fkToken  = `\${${baseTableName}.${basePkFieldName}}`;
  const lines: string[] = [
    `<form method="POST" action="${action}">`,
    `  <input type="hidden" name="${fkFieldName}" value="${fkToken}">`,
  ];

  for (const f of fields) {
    if (f.field_name === fkFieldName) continue;
    const id  = `f-${f.field_name}`;
    const lbl = f.label || f.field_name;
    const req = f.is_required ? ' required' : '';

    if (f.ui_widget === 'checkbox') {
      lines.push(`  <div class="wdp-field">`, `    <label><input type="checkbox" name="${f.field_name}" id="${id}" value="on"> ${lbl}</label>`, `  </div>`);
      continue;
    }

    let input: string;
    if (f.ui_widget === 'textarea') {
      let rows = 3;
      try { rows = (JSON.parse(f.ui_options_json ?? '{}') as { rows?: number }).rows ?? 3; } catch {}
      input = `<textarea class="wdp-input" name="${f.field_name}" id="${id}" rows="${rows}"${req}></textarea>`;
    } else if (f.ui_widget === 'select') {
      let opts: string[] = [];
      try { opts = (JSON.parse(f.ui_options_json ?? '{}') as { options?: string[] }).options ?? []; } catch {}
      const optHtml = ['', ...opts].map(o => `<option value="${o}">${o || '— select —'}</option>`).join('');
      input = `<select class="wdp-select" name="${f.field_name}" id="${id}"${req}>${optHtml}</select>`;
    } else {
      const typeMap: Record<string, string> = { number: 'number', date: 'date', datetime: 'datetime-local', email: 'email' };
      const inputType = typeMap[f.ui_widget] ?? 'text';
      let extra = '';
      if (inputType === 'text') {
        let maxlen = 255;
        try { maxlen = (JSON.parse(f.ui_options_json ?? '{}') as { max_length?: number }).max_length ?? 255; } catch {}
        extra = ` maxlength="${maxlen}"`;
      }
      input = `<input type="${inputType}" class="wdp-input" name="${f.field_name}" id="${id}" value=""${extra}${req}>`;
    }
    lines.push(`  <div class="wdp-field">`, `    <label class="wdp-field-label" for="${id}">${lbl}</label>`, `    ${input}`, `  </div>`);
  }

  lines.push(`  <div class="wdp-field">`, `    <button type="submit" class="wdp-btn">Submit</button>`, `  </div>`, `</form>`);
  return lines.join('\n');
}

async function findChildFormTables(
  appId: number,
  baseTableId: number,
  baseTableName: string,
  appSlug: string,
): Promise<{ table: { table_name: string; label: string }; formBlock: string }[]> {
  const [joins, publicTables, basePkField] = await Promise.all([
    db('app_joins').where({ app_id: appId }),
    db('app_tables').where({ app_id: appId, is_public_addable: true }).whereNot({ id: baseTableId }),
    db('app_fields').where({ table_id: baseTableId, is_primary_key: true }).first(),
  ]);
  const basePkName = basePkField?.field_name ?? 'id';

  const result: { table: { table_name: string; label: string }; formBlock: string }[] = [];

  for (const pt of publicTables) {
    let fkFieldName: string | null = null;
    let basePkFieldName = basePkName;

    // Check for a defined join between this table and the base table
    const join = joins.find((j: { left_table_id: number; right_table_id: number }) =>
      (j.left_table_id === pt.id && j.right_table_id === baseTableId) ||
      (j.right_table_id === pt.id && j.left_table_id === baseTableId),
    );

    if (join) {
      if (join.left_table_id === pt.id) {
        fkFieldName    = join.left_field_name;
        basePkFieldName = join.right_field_name;
      } else {
        fkFieldName    = join.right_field_name;
        basePkFieldName = join.left_field_name;
      }
    } else {
      // Fallback: look for a field named {baseTableName}_id or {singular}_id
      const singular = baseTableName.replace(/ies$/i, 'y').replace(/s$/i, '');
      const candidates = [...new Set([`${baseTableName}_id`, `${singular}_id`])];
      const fkField = await db('app_fields')
        .where({ table_id: pt.id })
        .whereIn('field_name', candidates)
        .first();
      if (fkField) fkFieldName = fkField.field_name;
    }

    if (!fkFieldName) continue;

    const fields: FieldInfo[] = await db('app_fields')
      .where({ table_id: pt.id, is_primary_key: false })
      .whereNotIn('data_type', ['image', 'upload'])
      .orderBy('sort_order');

    result.push({
      table:     pt,
      formBlock: buildChildFormBlock(appSlug, pt.table_name, fkFieldName, baseTableName, basePkFieldName, fields),
    });
  }

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getReachableFields(appId: number, baseTableId: number) {
  // Get fields from the base table and all tables reachable via joins
  const allTables = await db('app_tables').where({ app_id: appId });
  const tableById  = new Map(allTables.map(t => [t.id, t]));
  const baseTable  = tableById.get(baseTableId);
  if (!baseTable) return { baseFields: [], joinedFields: [] };

  const joins = await db('app_joins').where({ app_id: appId });

  // BFS from base table
  const visited  = new Set<number>([baseTableId]);
  const queue    = [baseTableId];
  const reachable: number[] = [baseTableId];

  while (queue.length) {
    const tid = queue.shift()!;
    for (const j of joins) {
      let neighbor: number | null = null;
      if (j.left_table_id === tid && !visited.has(j.right_table_id))  neighbor = j.right_table_id;
      if (j.right_table_id === tid && !visited.has(j.left_table_id)) neighbor = j.left_table_id;
      if (neighbor) { visited.add(neighbor); queue.push(neighbor); reachable.push(neighbor); }
    }
  }

  const fields = await db('app_fields')
    .whereIn('table_id', reachable)
    .orderBy('table_id').orderBy('sort_order')
    .select('field_name', 'label', 'data_type', 'table_id');

  const baseFields   = fields.filter(f => f.table_id === baseTableId)
    .map(f => ({ ...f, table_name: baseTable.table_name }));
  const joinedFields = fields.filter(f => f.table_id !== baseTableId)
    .map(f => ({ ...f, table_name: tableById.get(f.table_id)?.table_name ?? '' }));

  return { baseFields, joinedFields, baseTable };
}

// ── GET /admin/views ─────────────────────────────────────────────────────────

viewsRouter.get('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const views  = await viewsService.listViews(app.id);
    const tables = await tablesService.listTables(app.id);
    const tableById = new Map(tables.map(t => [t.id, t]));
    const flash  = req.session.flash;
    delete req.session.flash;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.render('admin/views/list', { title: 'Views', views, tableById, flash, baseUrl });
  } catch (err) { next(err); }
});

// ── GET /admin/views/new ─────────────────────────────────────────────────────

// ── GET /admin/views/fields/:tableId — field list for a table (used by form JS) ──

viewsRouter.get('/fields/:tableId', async (req, res, next) => {
  try {
    const app     = res.locals.currentApp as App;
    const tableId = Number(req.params.tableId);
    const table   = await db('app_tables').where({ id: tableId, app_id: app.id }).first();
    if (!table) return res.status(404).json({ error: 'Table not found' });
    const fields = await db('app_fields')
      .where({ table_id: tableId })
      .orderBy('sort_order')
      .select('field_name', 'label', 'is_primary_key');
    res.json(fields);
  } catch (err) { next(err); }
});

viewsRouter.get('/new', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const tables = await tablesService.listTables(app.id);
    res.render('admin/views/form', { title: 'New View', tables, view: null, baseFields: [], errors: null });
  } catch (err) { next(err); }
});

// ── POST /admin/views ────────────────────────────────────────────────────────

viewsRouter.post('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const parsed = ViewSchema.safeParse(req.body);
    if (!parsed.success) {
      const tables     = await tablesService.listTables(app.id);
      const tableId    = Number(req.body.base_table_id);
      const baseFields = tableId ? await db('app_fields').where({ table_id: tableId }).orderBy('sort_order').select('field_name', 'label') : [];
      return res.render('admin/views/form', {
        title: 'New View', tables, view: req.body, baseFields,
        errors: parsed.error.flatten().fieldErrors
      });
    }
    const view = await viewsService.createView({ app_id: app.id, ...parsed.data });
    // Seed default templates
    await viewsService.saveViewTemplates(app.id, view.id, viewsService.DEFAULT_TEMPLATES ?? {});
    req.session.flash = { type: 'success', message: 'View created.' };
    res.redirect(`/admin/views/${view.id}/templates`);
  } catch (err) { next(err); }
});

// ── GET /admin/views/:id/edit ────────────────────────────────────────────────

viewsRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const view   = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });
    const tables     = await tablesService.listTables(app.id);
    const baseFields = await db('app_fields').where({ table_id: view.base_table_id }).orderBy('sort_order').select('field_name', 'label');
    res.render('admin/views/form', { title: `Edit — ${view.label}`, tables, view, baseFields, errors: null });
  } catch (err) { next(err); }
});

// ── POST /admin/views/:id/edit ───────────────────────────────────────────────

viewsRouter.post('/:id/edit', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });

    const parsed = ViewSchema.safeParse(req.body);
    if (!parsed.success) {
      const tables     = await tablesService.listTables(app.id);
      const tableId    = Number(req.body.base_table_id || view.base_table_id);
      const baseFields = tableId ? await db('app_fields').where({ table_id: tableId }).orderBy('sort_order').select('field_name', 'label') : [];
      return res.render('admin/views/form', {
        title: `Edit — ${view.label}`, tables, view: req.body, baseFields,
        errors: parsed.error.flatten().fieldErrors
      });
    }
    await viewsService.updateView(view.id, parsed.data);
    req.session.flash = { type: 'success', message: 'View settings saved.' };
    res.redirect(`/admin/views/${view.id}/templates`);
  } catch (err) { next(err); }
});

// ── POST /admin/views/:id/delete ─────────────────────────────────────────────

viewsRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });
    await viewsService.deleteView(view.id);
    req.session.flash = { type: 'success', message: 'View deleted.' };
    res.redirect('/admin/views');
  } catch (err) { next(err); }
});

// ── GET /admin/views/:id/templates ───────────────────────────────────────────

viewsRouter.get('/:id/templates', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    const templates = await viewsService.getViewTemplates(app.id, view.id);
    const { baseFields, joinedFields } = await getReachableFields(app.id, view.base_table_id);

    let generatedSql = '';
    try {
      generatedSql = await viewsService.generateViewSql(app.id, baseTable?.table_name ?? '', templates);
    } catch (_) {}

    // Child tables (public-addable, with FK to base table) — one-click form insertion
    const childFormTables = await findChildFormTables(app.id, view.base_table_id, baseTable?.table_name ?? '', app.slug);

    // Collect public-addable tables with their non-PK fields for the form builder panel
    const publicAddableTables = await db('app_tables')
      .where({ app_id: app.id, is_public_addable: true })
      .orderBy('label');
    const publicTableFields: {
      table: { table_name: string; label: string };
      fields: { field_name: string; label: string; ui_widget: string; inputSnippet: string }[];
    }[] = [];
    for (const t of publicAddableTables) {
      const tFields = await db('app_fields')
        .where({ table_id: t.id, is_primary_key: false })
        .whereNotIn('data_type', ['image', 'upload'])
        .orderBy('sort_order');
      publicTableFields.push({
        table: t,
        fields: tFields.map((f: { field_name: string; label: string; ui_widget: string; ui_options_json: string | null; is_required: boolean }) => ({
          ...f,
          inputSnippet: buildPublicInputSnippet(f),
        })),
      });
    }

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('admin/views/editor', {
      title: `Templates — ${view.label}`,
      view, baseTable, templates,
      baseFields, joinedFields,
      childFormTables,
      publicTableFields,
      templateTypes: viewsService.TEMPLATE_TYPES,
      templateLabels: viewsService.TEMPLATE_LABELS,
      generatedSql,
      flash,
    });
  } catch (err) { next(err); }
});

// ── POST /admin/views/:id/templates ──────────────────────────────────────────

viewsRouter.post('/:id/templates', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });

    // Save each template
    const templateData: Partial<viewsService.ViewTemplates> = {};
    for (const type of viewsService.TEMPLATE_TYPES) {
      if (type in req.body) templateData[type] = req.body[type] ?? '';
    }
    await viewsService.saveViewTemplates(app.id, view.id, templateData);

    // Save SQL mode + custom SQL
    const queryMode = req.body.query_mode === 'advanced_sql' ? 'advanced_sql' : 'automatic';
    await viewsService.updateView(view.id, {
      query_mode: queryMode,
      custom_sql: queryMode === 'advanced_sql' ? (req.body.custom_sql ?? null) : null,
    });

    req.session.flash = { type: 'success', message: 'Templates saved.' };
    res.redirect(`/admin/views/${view.id}/templates`);
  } catch (err) { next(err); }
});

// ── GET /admin/views/:id/preview ─────────────────────────────────────────────

viewsRouter.get('/:id/preview', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'View not found' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.render('admin/views/preview', { title: `Preview — ${view.label}`, view, currentApp: app, baseUrl });
  } catch (err) { next(err); }
});

// ── GET /admin/views/:id/preview-popup — bare popup shell for live preview ────

viewsRouter.get('/:id/preview-popup', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).send('<p>View not found.</p>');
    res.render('admin/views/preview-popup', { view });
  } catch (err) { next(err); }
});

// ── POST /admin/views/:id/preview-render — render with template overrides ─────

viewsRouter.post('/:id/preview-render', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id)
      return res.status(404).json({ error: 'View not found' });

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).json({ error: 'Base table not found' });

    // Merge saved templates with any overrides from request body
    const saved = await viewsService.getViewTemplates(app.id, view.id);
    const overrides: Partial<viewsService.ViewTemplates> = {};
    for (const type of viewsService.TEMPLATE_TYPES) {
      if (req.body[type] !== undefined) overrides[type as keyof viewsService.ViewTemplates] = req.body[type];
    }
    const templates = { ...saved, ...overrides };

    // Forward search/pagination state from query string
    const q    = req.query['q']    as string | undefined;
    const page = req.query['page'] ? Number(req.query['page']) : undefined;
    const sort = req.query['sort'] as string | undefined;
    const dir  = req.query['dir'] === 'desc' ? 'desc' : req.query['dir'] === 'asc' ? 'asc' : undefined;
    const fieldFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (k.startsWith('f_') && typeof v === 'string' && v) fieldFilters[k.slice(2)] = v;
    }

    const sqlCapture: string[] = [];
    const html = await viewsService.renderViewList(app, view, baseTable.table_name, templates,
      { q, page, sort, dir, fieldFilters, sqlCapture });
    res.json({ html, sql: sqlCapture[0] ?? '' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── POST /admin/views/:id/ai-fix — AI error fixer ────────────────────────────

viewsRouter.post('/:id/ai-fix', async (req, res) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id) return res.json({ error: 'View not found' });

    const errorMsg: string = (req.body.error ?? '').trim();
    if (!errorMsg) return res.json({ error: 'No error message provided' });

    const { baseFields, joinedFields, baseTable } =
      await getReachableFields(app.id, view.base_table_id);
    if (!baseTable) return res.json({ error: 'Base table not found' });

    // Current templates — prefer overrides from request body (what's in the editor right now)
    const saved = await viewsService.getViewTemplates(app.id, view.id);
    const overrides: Partial<viewsService.ViewTemplates> = {};
    for (const type of viewsService.TEMPLATE_TYPES) {
      if (req.body[type] !== undefined) overrides[type as keyof viewsService.ViewTemplates] = req.body[type];
    }
    const templates = { ...saved, ...overrides };

    // Current SQL
    const customSql: string = (req.body.custom_sql ?? view.custom_sql ?? '').trim();
    const queryMode: string = req.body.query_mode ?? view.query_mode ?? 'automatic';

    // Build schema context
    const schemaLines: string[] = [];
    for (const f of baseFields)   schemaLines.push(`  ${baseTable.table_name}.${f.field_name} (${f.data_type}) — ${f.label || f.field_name}`);
    for (const f of joinedFields) schemaLines.push(`  ${f.table_name}.${f.field_name} (${f.data_type}) — ${f.label || f.field_name}`);

    // Extract keywords from the error to identify which templates are relevant
    const errorKeywords = (errorMsg.match(/\b\w+\b/g) ?? [])
      .filter(w => w.length > 3)
      .map(w => w.toLowerCase());

    // Build template block — only include templates that mention error keywords,
    // or all templates if we can't narrow it down. This keeps the AI payload small.
    const tplLines: string[] = [];
    for (const type of viewsService.TEMPLATE_TYPES) {
      const body = templates[type as keyof viewsService.ViewTemplates];
      if (!body?.trim()) continue;
      const lower = body.toLowerCase();
      const relevant = errorKeywords.length === 0 || errorKeywords.some(kw => lower.includes(kw));
      if (relevant) tplLines.push(`=== ${type} ===\n${body}\n`);
    }
    // If nothing matched, include all non-empty templates
    if (tplLines.length === 0) {
      for (const type of viewsService.TEMPLATE_TYPES) {
        const body = templates[type as keyof viewsService.ViewTemplates];
        if (body?.trim()) tplLines.push(`=== ${type} ===\n${body}\n`);
      }
    }

    const systemPrompt = `You are an expert at debugging Webdata Pro view templates and SQL.

Webdata Pro views use two modes:
- "automatic": templates use \${table.field} tokens, SQL is auto-generated from those tokens
- "advanced_sql": templates use \${alias} tokens where aliases come from the custom SQL SELECT

Template types: header, row, footer, search_form, detail, edit_form, create_form

Common bugs you fix:
- Trailing comma before FROM in SQL (a deleted field left a comma behind)
- \${table.field} token referencing a field that no longer exists in the schema
- SQL alias mismatch between custom SQL and templates
- Any other syntax error in SQL or templates

Return ONLY a single valid JSON object — no markdown fences, no explanation outside the JSON:
{
  "custom_sql": "<fixed SQL string or null if no change needed>",
  "templates": { "<type>": "<fixed HTML or null if unchanged>", ... },
  "explanation": "<one or two sentences describing what was wrong and what you fixed>"
}

Only change what is necessary to fix the error. Do not redesign or rewrite templates.`;

    const userPrompt = `ERROR MESSAGE:
${errorMsg}

QUERY MODE: ${queryMode}

ACTUAL TABLE SCHEMA (these are the fields that currently exist):
${schemaLines.join('\n')}

CURRENT CUSTOM SQL:
${customSql || '(none — automatic mode)'}

CURRENT TEMPLATES:
${tplLines.join('\n') || '(none)'}

Fix the error. Return only the JSON object described above.`;

    const aiSettings = await aiService.getAiSettings();
    const raw = await aiService.callAi(aiSettings, systemPrompt, userPrompt, 4096, 0.1);

    // Extract JSON from response (strip any accidental markdown fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.json({ error: 'AI returned no valid JSON. Raw: ' + raw.slice(0, 200) });

    let parsed: { custom_sql?: string | null; templates?: Record<string, string | null>; explanation?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.json({ error: 'AI returned invalid JSON. Raw: ' + raw.slice(0, 300) });
    }

    res.json({
      custom_sql:  parsed.custom_sql  ?? null,
      templates:   parsed.templates   ?? {},
      explanation: parsed.explanation ?? 'Fix applied.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ error: msg });
  }
});

// ── POST /admin/views/:id/generate-templates — AI template generation ────────

viewsRouter.post('/:id/generate-templates', async (req, res) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id) return res.json({ error: 'View not found' });

    const styleHint = (req.body.style_hint as string ?? '').trim();

    // ── Build schema context ─────────────────────────────────────────────────
    const { baseFields, joinedFields, baseTable } =
      await getReachableFields(app.id, view.base_table_id);

    if (!baseTable) return res.json({ error: 'Base table not found' });

    const tokenLines: string[] = [];
    for (const f of baseFields)  tokenLines.push(`\${${baseTable.table_name}.${f.field_name}} — ${f.label || f.field_name} (${f.data_type})`);
    for (const f of joinedFields) tokenLines.push(`\${${f.table_name}.${f.field_name}} — ${f.label || f.field_name} (${f.data_type})`);

    // ── Pull sample data ────────────────────────────────────────────────────
    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb      = getAppDb(app);
    const dummyTpls  = viewsService.DEFAULT_TEMPLATES;
    let sampleRows: Record<string, unknown>[] = [];
    try {
      const sql   = await viewsService.generateViewSql(app.id, baseTable.table_name, dummyTpls);
      const sampleRaw = await appDb.raw(`SELECT * FROM (${sql}) AS _s LIMIT 4`);
      sampleRows = (app.database_mode === 'mysql'
        ? (sampleRaw as [Record<string, unknown>[], unknown])[0]
        : sampleRaw) as Record<string, unknown>[];
    } catch { /* ignore — schema may have no data yet */ }

    const sampleText = sampleRows.length
      ? sampleRows.map((r, i) => `Row ${i + 1}: ` + Object.entries(r).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')).join('\n')
      : '(no sample data available)';

    // ── Build concrete "starter" templates via shared templateGen service ────
    const allFields = [...baseFields, ...joinedFields];
    const starters  = buildStarterTemplates(baseTable, allFields, styleHint);

    const starterSearchForm  = starters.search_form;
    const starterHeader      = starters.header;
    const starterRow         = starters.row;
    const starterFooter      = starters.footer;
    const starterDetail      = starters.detail;
    const starterEditForm    = starters.edit_form;
    const starterCreateForm  = starters.create_form;

    // ── Assemble prompts ─────────────────────────────────────────────────────
    const systemPrompt = `You write HTML templates for Webdata Pro data widgets. Use \${token} syntax for data values. Output each template between ===MARKER=== delimiters exactly as shown. No JSON, no markdown, no explanation — just the delimited HTML blocks.

${CSS_CLASS_REFERENCE}

## Design Principles — apply these to every template

VISUAL HIERARCHY
- Every list row must have exactly three levels of information:
  1. TITLE — the record's primary identifier, bold and prominent (.wdp-row-title)
  2. SUBTITLE — the most important secondary detail, accent color (.wdp-row-sub)
  3. META — supporting info (date, location, count), small and muted (.wdp-row-meta)
- Never put everything at equal visual weight. If all fields look the same, the design has failed.
- In detail views, group related fields together. Most important fields first.

BADGES
- Use .wdp-badge for: status fields, boolean yes/no fields, category/type fields with few options.
- A badge should contain a SHORT label (1-3 words). Never put a full sentence in a badge.
- Boolean true → show the badge. Boolean false → omit the badge entirely (don't show "No").
- Example: good_for_kids=true → <span class="wdp-badge">Kid Friendly</span>

NUMBERS & PRICES
- Currency/price fields: bold, right-aligned or prominently placed. Use $currency[] token.
- Dates: always muted small text. Never make a date the dominant element.
- IDs and foreign keys: never display raw integer IDs to the user.

ROW CONTENT SELECTION
- Show only 3-5 fields in a list row. Choose the fields a user would scan to identify records.
- The fields you OMIT from the row are as important as the ones you include.
- Put full detail in the detail view — the row is a preview, not a data dump.

DOMAIN AWARENESS
- Look at the table name and field names to identify the domain, then apply professional conventions:
  - Pet adoption: warm/friendly colors, animal name as hero title, species+breed as subtitle,
    age+good_for_kids badges in meta. Detail view should feel welcoming, not clinical.
  - Real estate: address as title, price bold and prominent, beds/baths/sqft on subtitle,
    status badge (Active/Pending/Sold). Professional and trustworthy color scheme.
  - Classifieds / marketplace: title prominent, price right-aligned bold, category badge,
    posted date muted. Dense and scannable.
  - Vehicles: Year Make Model as title, price prominent, mileage+condition on subtitle.
  - Documents / records: title/name as title, date on subtitle, type/category badge.
  - Events: event name as title, date+time as subtitle (formatted nicely), location as meta.
  - People / contacts: full name as title, role/company as subtitle, email/phone as meta.`;

    const styleHintLine = styleHint ? `Style: ${styleHint}` : 'Style: clean, professional.';
    const hint2 = styleHint.toLowerCase();
    const layoutLine = (hint2.includes('table') || hint2.includes('spreadsheet') || hint2.includes('grid'))
      ? 'Layout: TABLE (header opens <table class="wdp-table">, each row is a <tr>, footer closes </tbody></table>)'
      : 'Layout: CARD LIST (each row is a .wdp-row card)';

    const userPrompt = `Write templates for a "${baseTable.table_name}" widget.
${styleHintLine}
${layoutLine}

First, identify the domain from the table name "${baseTable.table_name}" and field names below.
Then apply the professional design conventions for that domain from the Design Principles.

Available tokens (copy exactly including \${ and }):
${tokenLines.join('\n')}
\${_pk}          — primary key
\${_total}       — total record count
\${_q}           — search query string
\${_pagination}  — pagination HTML (place in footer)
\${_group_value} — group label (group_header only)

Sample data (use this to understand real content and choose the right fields to display):
${sampleText}

I have pre-built starter templates below. IMPROVE them significantly:
- Apply domain-appropriate design conventions
- Enforce visual hierarchy (title > subtitle > meta)
- Use .wdp-badge for boolean and status fields
- Select only the most meaningful fields for the row view
- Make it look like it was designed by an experienced professional, not auto-generated
Do NOT change structural HTML class names or data-wdp-* action attributes.
You MAY replace the <style>:root{...}</style> color block with better colors for this domain.

===SEARCH_FORM===
${starterSearchForm}
===END===
===HEADER===
${starterHeader}
===END===
===GROUP_HEADER===
<div class="wdp-grp"><span class="wdp-grp-label">\${_group_value}</span><div class="wdp-grp-bar"></div></div>
===END===
===ROW===
${starterRow}
===END===
===GROUP_FOOTER===

===END===
===FOOTER===
${starterFooter}
===END===
===DETAIL===
${starterDetail}
===END===
===EDIT_FORM===
${starterEditForm}
===END===

Now rewrite all 8 templates, applying professional domain-appropriate design.
Output each template between its ===MARKER=== delimiters. Nothing else.`;

    // ── Call AI ──────────────────────────────────────────────────────────────
    const aiSettings = await aiService.getAiSettings();
    const raw        = await aiService.callAi(aiSettings, systemPrompt, userPrompt, 8192);
    const blocks     = aiService.extractTemplateBlocks(raw, viewsService.TEMPLATE_TYPES);

    // If AI produced nothing useful, return the starters directly
    const templates: Partial<viewsService.ViewTemplates> = Object.keys(blocks).length > 0 ? blocks : starters;

    // Fill any missing slots (AI may have skipped create_form etc.)
    for (const key of viewsService.TEMPLATE_TYPES) {
      if (!(key in templates) || !(templates as Record<string, string>)[key]) {
        (templates as Record<string, string>)[key] = starters[key as keyof typeof starters];
      }
    }

    res.json({ templates });
  } catch (err: unknown) {
    res.json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /admin/views/:id/generate-sql ───────────────────────────────────────

viewsRouter.post('/:id/generate-sql', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const view = await viewsService.getView(Number(req.params.id));
    if (!view || view.app_id !== app.id) return res.json({ error: 'View not found' });

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.json({ error: 'Base table not found' });

    const templates = req.body as Partial<viewsService.ViewTemplates>;
    const sql       = await viewsService.generateViewSql(app.id, baseTable.table_name, templates);
    res.json({ sql });
  } catch (err: unknown) {
    res.json({ error: err instanceof Error ? err.message : String(err) });
  }
});
