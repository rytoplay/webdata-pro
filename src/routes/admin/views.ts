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

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('admin/views/editor', {
      title: `Templates — ${view.label}`,
      view, baseTable, templates,
      baseFields, joinedFields,
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

    const html = await viewsService.renderViewList(app, view, baseTable.table_name, templates, {});
    res.json({ html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
      sampleRows  = await appDb.raw(`SELECT * FROM (${sql}) AS _s LIMIT 4`) as Record<string, unknown>[];
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

${CSS_CLASS_REFERENCE}`;

    const styleHintLine = styleHint ? `Style: ${styleHint}` : 'Style: clean, professional.';
    const hint2 = styleHint.toLowerCase();
    const layoutLine = (hint2.includes('table') || hint2.includes('spreadsheet') || hint2.includes('grid'))
      ? 'Layout: TABLE (header opens <table class="wdp-table">, each row is a <tr>, footer closes </tbody></table>)'
      : 'Layout: CARD LIST (each row is a .wdp-row card)';

    const userPrompt = `Write templates for a "${baseTable.table_name}" widget.
${styleHintLine}
${layoutLine}

Available tokens (copy exactly including \${ and }):
${tokenLines.join('\n')}
\${_pk}          — primary key
\${_total}       — total record count
\${_q}           — search query string
\${_pagination}  — pagination HTML (place in footer)
\${_group_value} — group label (group_header only)

Sample data:
${sampleText}

I have pre-built starter templates below. Your job is to REFINE them with the requested style — improve the layout, adjust content, apply the color theme. Do NOT change the structural HTML class names or action attributes. You may replace the <style>:root{...}</style> color block if you want different colors.

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

Now rewrite all 8 templates above, improving the style to match: ${styleHintLine}
Keep the same HTML structure and CSS classes. Adapt only visual details (colors via the :root style tag, spacing, extra elements). Output each template between its ===MARKER=== delimiters.`;

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
