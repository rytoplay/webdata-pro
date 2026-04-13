import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';
import * as tablesService from '../../services/tables';
import * as aiService from '../../services/ai';
import { CSS_CLASS_REFERENCE } from '../../services/blueprintPrompt';

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

    // Separate decimal/currency fields so we can use $currency[] tokens for them
    const currencyTypes = new Set(['decimal', 'float', 'bigInteger']);

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

    // ── Color theme from style hint ──────────────────────────────────────────
    const hint = styleHint.toLowerCase();
    let colorVars = '--wdp-primary:#1e3a5f;--wdp-on-primary:#fff;--wdp-accent:#2e86de;--wdp-bg:#f0f4f8;--wdp-surface:#fff;--wdp-text:#1a2a3a;--wdp-border:#c8d8e8';
    if (hint.includes('orange'))      colorVars = '--wdp-primary:#c44b00;--wdp-on-primary:#fff;--wdp-accent:#e87722;--wdp-bg:#fff8f0;--wdp-surface:#fff;--wdp-text:#1a0e00;--wdp-border:#f0c090';
    else if (hint.includes('dark'))   colorVars = '--wdp-primary:#1a1a2e;--wdp-on-primary:#e0e0e0;--wdp-accent:#e94560;--wdp-bg:#16213e;--wdp-surface:#0f3460;--wdp-text:#e0e0e0;--wdp-border:#1a4a7a';
    else if (hint.includes('green'))  colorVars = '--wdp-primary:#1a5c2a;--wdp-on-primary:#fff;--wdp-accent:#2d9e4a;--wdp-bg:#f0fff4;--wdp-surface:#fff;--wdp-text:#1a3a1a;--wdp-border:#b7e4c7';
    else if (hint.includes('red'))    colorVars = '--wdp-primary:#8b1a1a;--wdp-on-primary:#fff;--wdp-accent:#c0392b;--wdp-bg:#fff5f5;--wdp-surface:#fff;--wdp-text:#1a0000;--wdp-border:#f5b7b1';
    else if (hint.includes('purple')) colorVars = '--wdp-primary:#4a1a6b;--wdp-on-primary:#fff;--wdp-accent:#8e44ad;--wdp-bg:#f9f0ff;--wdp-surface:#fff;--wdp-text:#1a001a;--wdp-border:#d7b8f0';

    // ── Determine layout pattern ─────────────────────────────────────────────
    const useTable = hint.includes('table') || hint.includes('spreadsheet') || hint.includes('grid');

    // ── Pre-build concrete template examples using real field names ──────────
    // This gives the AI working examples with actual tokens already filled in,
    // dramatically improving output quality.
    const allFields = [...baseFields, ...joinedFields];
    const titleField = allFields[0];
    const subField   = allFields[1];
    const metaField  = allFields[2];
    const titleTok   = titleField ? `\${${titleField.table_name ?? baseTable.table_name}.${titleField.field_name}}` : '';
    const subTok     = subField   ? `\${${subField.table_name   ?? baseTable.table_name}.${subField.field_name}}`   : '';

    // Format currency fields with $currency[], others with plain ${token}
    const metaTok = metaField
      ? (currencyTypes.has(metaField.data_type)
          ? `$currency[${metaField.table_name ?? baseTable.table_name}.${metaField.field_name},2]`
          : `\${${metaField.table_name ?? baseTable.table_name}.${metaField.field_name}}`)
      : '';

    // Build the detail body: one .wdp-field per field
    const detailFields = allFields.map(f => {
      const tbl = f.table_name ?? baseTable.table_name;
      const val = currencyTypes.has(f.data_type)
        ? `$currency[${tbl}.${f.field_name},2]`
        : `\${${tbl}.${f.field_name}}`;
      return `<div class="wdp-field"><div class="wdp-field-label">${f.label || f.field_name}</div><div class="wdp-field-value">${val}</div></div>`;
    }).join('');

    // Map data_type to HTML input type (no ui_widget available at this level)
    const inputTypeFor = (dataType: string) =>
      dataType === 'integer' || dataType === 'decimal' || dataType === 'float' || dataType === 'bigInteger' ? 'number'
      : dataType === 'date' ? 'date'
      : dataType === 'datetime' ? 'datetime-local'
      : dataType === 'boolean' ? 'checkbox'
      : 'text';

    // Build the form fields: one .wdp-form-group per field
    const formFields = allFields.map(f => {
      const tbl       = f.table_name ?? baseTable.table_name;
      const valTok    = `\${${tbl}.${f.field_name}}`;
      const fieldName = f.field_name;
      const lbl       = f.label || f.field_name;
      if (f.data_type === 'text') {
        return `<div class="wdp-form-group"><label class="wdp-label">${lbl}</label><textarea class="wdp-textarea" name="${fieldName}">${valTok}</textarea></div>`;
      }
      return `<div class="wdp-form-group"><label class="wdp-label">${lbl}</label><input class="wdp-input" type="${inputTypeFor(f.data_type)}" name="${fieldName}" value="${valTok}"></div>`;
    }).join('');

    const createFormFields = allFields.map(f => {
      const fieldName = f.field_name;
      const lbl       = f.label || f.field_name;
      if (f.data_type === 'text') {
        return `<div class="wdp-form-group"><label class="wdp-label">${lbl}</label><textarea class="wdp-textarea" name="${fieldName}"></textarea></div>`;
      }
      return `<div class="wdp-form-group"><label class="wdp-label">${lbl}</label><input class="wdp-input" type="${inputTypeFor(f.data_type)}" name="${fieldName}" value=""></div>`;
    }).join('');

    // Table layout: build <th> headers with $sort[] tokens
    const tableHeaders = allFields.slice(0, 5).map(f =>
      `<th>$sort[${f.table_name ?? baseTable.table_name}.${f.field_name},${f.label || f.field_name}]</th>`
    ).join('');
    const tableCells = allFields.slice(0, 5).map(f => {
      const tbl = f.table_name ?? baseTable.table_name;
      const val = currencyTypes.has(f.data_type)
        ? `$currency[${tbl}.${f.field_name},2]`
        : `\${${tbl}.${f.field_name}}`;
      return `<td>${val}</td>`;
    }).join('');

    const styleTag = `<style>:root{${colorVars}}</style>`;
    const tableName = baseTable.label || baseTable.table_name;

    // ── Build concrete "starter" templates ──────────────────────────────────
    let starterSearchForm: string;
    let starterHeader: string;
    let starterRow: string;
    let starterFooter: string;

    if (useTable) {
      starterSearchForm = `${styleTag}<div class="wdp"><div class="wdp-sf"><input type="text" name="q" value="\${_q}" placeholder="Search…"><button type="submit">Search</button>$perpage[10,25,50,100]</div>`;
      starterHeader = `<div class="wdp-hdr"><span class="wdp-hdr-title">${tableName}</span><span class="wdp-hdr-meta">\${_total} results</span></div><table class="wdp-table"><thead><tr>${tableHeaders}</tr></thead><tbody>`;
      starterRow = `<tr data-wdp-action="detail" data-wdp-id="\${_pk}">${tableCells}</tr>`;
      starterFooter = `</tbody></table><div class="wdp-footer">\${_pagination}</div></div>`;
    } else {
      starterSearchForm = `${styleTag}<div class="wdp"><div class="wdp-sf"><input type="text" name="q" value="\${_q}" placeholder="Search…"><button type="submit">Search</button></div>`;
      starterHeader = `<div class="wdp-hdr"><span class="wdp-hdr-title">${tableName}</span><span class="wdp-hdr-meta">\${_total} results</span></div>`;
      const rowMeta = metaTok ? ` &bull; ${metaTok}` : '';
      starterRow = `<div class="wdp-row" data-wdp-action="detail" data-wdp-id="\${_pk}"><div class="wdp-row-body"><div class="wdp-row-title">${titleTok}</div><div class="wdp-row-sub">${subTok}</div><div class="wdp-row-meta">${rowMeta}</div></div><span class="wdp-arr">&#8250;</span></div>`;
      starterFooter = `<div class="wdp-footer">\${_pagination}</div></div>`;
    }

    const starterDetail = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Back</button><h2 class="wdp-detail-title">${titleTok}</h2><div class="wdp-detail-sub">${subTok}</div><div class="wdp-detail-body">${detailFields}</div></div></div>`;
    const starterEditForm = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Cancel</button><h2 class="wdp-detail-title">Edit ${tableName}</h2><form data-wdp-form="edit" data-wdp-id="\${_pk}" style="margin-top:16px">${formFields}<button type="submit" class="wdp-btn">Save Changes</button></form></div></div>`;
    const starterCreateForm = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Cancel</button><h2 class="wdp-detail-title">New ${tableName}</h2><form data-wdp-form="create" style="margin-top:16px">${createFormFields}<button type="submit" class="wdp-btn">Create ${tableName}</button></form></div></div>`;

    // ── Assemble prompts ─────────────────────────────────────────────────────
    const systemPrompt = `You write HTML templates for Webdata Pro data widgets. Use \${token} syntax for data values. Output each template between ===MARKER=== delimiters exactly as shown. No JSON, no markdown, no explanation — just the delimited HTML blocks.

${CSS_CLASS_REFERENCE}`;

    const styleHintLine = styleHint ? `Style: ${styleHint}` : 'Style: clean, professional.';
    const layoutLine = useTable
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

I have pre-built starter templates below. Your job is to REFINE them with the requested style — improve the layout, adjust content, apply the color theme. Do NOT change the structural HTML class names or action attributes. Replace the ${styleTag} color tag if you want different colors.

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
    const templates: Partial<viewsService.ViewTemplates> = Object.keys(blocks).length > 0 ? blocks : {
      search_form:  starterSearchForm,
      header:       starterHeader,
      group_header: `<div class="wdp-grp"><span class="wdp-grp-label">\${_group_value}</span><div class="wdp-grp-bar"></div></div>`,
      row:          starterRow,
      group_footer: '',
      footer:       starterFooter,
      detail:       starterDetail,
      edit_form:    starterEditForm,
      create_form:  starterCreateForm,
    };

    // Fill any missing slots (AI may have skipped create_form)
    const starters: viewsService.ViewTemplates = {
      search_form:  starterSearchForm,
      header:       starterHeader,
      group_header: `<div class="wdp-grp"><span class="wdp-grp-label">\${_group_value}</span><div class="wdp-grp-bar"></div></div>`,
      row:          starterRow,
      group_footer: '',
      footer:       starterFooter,
      detail:       starterDetail,
      edit_form:    starterEditForm,
      create_form:  starterCreateForm,
    };
    for (const key of viewsService.TEMPLATE_TYPES) {
      if (!(key in templates) || !(templates as Record<string, string>)[key]) {
        (templates as Record<string, string>)[key] = starters[key];
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
