import { Router, Request, Response } from 'express';
import { db } from '../../db/knex';
import { appCors } from '../../middleware/cors';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';

export const apiViewsRouter = Router({ mergeParams: true });

// ── Auth helper ──────────────────────────────────────────────────────────────
// Returns true if the request is allowed to access the view.
// Sends a 401 response and returns false if not.

async function checkViewAccess(req: Request, res: Response, app: App, view: { id: number; is_public: boolean; view_name?: string }, asJson = false): Promise<boolean> {
  if (view.is_public) return true;

  // Admin session: full access
  if ((req.session as any)?.admin?.isAdmin === true) return true;

  // Member session: must be logged into this app and have a group with can_view
  const memberSession = (req.session as any)?.member;
  if (memberSession?.appId === app.id && Array.isArray(memberSession.groupIds) && memberSession.groupIds.length > 0) {
    const perm = await db('view_group_permissions')
      .whereIn('group_id', memberSession.groupIds)
      .where({ view_id: view.id, can_view: true })
      .first();
    if (perm) return true;
  }

  // Not authorised — send login link
  const loginUrl = `/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`;
  if (asJson) {
    res.status(401).json({ error: 'Authentication required', loginUrl });
  } else {
    res.status(401).send(
      `<p class="wdp-error">This view requires authentication. ` +
      `<a href="${loginUrl}">Sign in</a></p>`
    );
  }
  return false;
}

// ── Load app by slug, apply CORS ────────────────────────────────────────────

apiViewsRouter.use(async (req, res, next) => {
  const { appSlug } = req.params as { appSlug: string };
  const app = await db('apps').where({ slug: appSlug }).first() as App | undefined;
  if (!app) return res.status(404).json({ error: 'App not found' });
  res.locals.apiApp = app;
  next();
}, appCors);

// ── GET /api/v/:appSlug/:viewName — list / search ───────────────────────────

apiViewsRouter.get('/:viewName', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName } = req.params;
    const query = req.query as Record<string, string>;
    const { q, page, sort, dir, searchOnly } = query;

    // Collect per-field filters submitted by $search[...] inputs (prefixed f_)
    const fieldFilters: Record<string, string> = {};
    for (const [key, val] of Object.entries(query)) {
      if (key.startsWith('f_') && val) fieldFilters[key.slice(2)] = val;
    }

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    if (!await checkViewAccess(req, res, app, view)) return;

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).send('<p class="wdp-error">Base table not configured.</p>');

    const templates = await viewsService.getViewTemplates(app.id, view.id);

    const hasFieldFilters = Object.keys(fieldFilters).length > 0;
    const html = await viewsService.renderViewList(app, view, baseTable.table_name, templates, {
      q:            q ?? '',
      page:         page ? parseInt(page, 10) : 1,
      sort:         sort ?? undefined,
      dir:          (dir === 'desc' ? 'desc' : 'asc'),
      searchOnly:   searchOnly === '1' && !hasFieldFilters,
      fieldFilters,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v/:appSlug/:viewName/:recordId — detail view ───────────────────

apiViewsRouter.get('/:viewName/:recordId', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName, recordId } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    if (!await checkViewAccess(req, res, app, view)) return;

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).send('<p class="wdp-error">Base table not configured.</p>');

    const templates = await viewsService.getViewTemplates(app.id, view.id);
    const html      = await viewsService.renderViewDetail(app, view, baseTable.table_name, templates, recordId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v/:appSlug/:viewName/:recordId/edit — edit form ────────────────

apiViewsRouter.get('/:viewName/:recordId/edit', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName, recordId } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    if (!await checkViewAccess(req, res, app, view)) return;

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).send('<p class="wdp-error">Base table not configured.</p>');

    const templates = await viewsService.getViewTemplates(app.id, view.id);
    const html      = await viewsService.renderViewEditForm(app, view, baseTable.table_name, templates, recordId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v/:appSlug/:viewName/:recordId — update record ───────────────

apiViewsRouter.patch('/:viewName/:recordId', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName, recordId } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).json({ error: 'View not found' });

    if (!await checkViewAccess(req, res, app, view, true)) return;

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).json({ error: 'Base table not configured' });

    // Whitelist: only update fields that exist in this table (never the PK)
    const allFields = await db('app_fields').where({ table_id: view.base_table_id });
    const pkField   = allFields.find((f: { is_primary_key: boolean }) => f.is_primary_key);
    const pkName    = pkField?.field_name ?? 'id';
    const allowed   = new Set(
      allFields
        .filter((f: { field_name: string; is_primary_key: boolean }) => !f.is_primary_key)
        .map((f: { field_name: string }) => f.field_name)
    );

    const body = req.body as Record<string, string | string[]>;

    // Resolve checkbox sentinels: _wdpcb_field means the field was present in the form.
    // If the checkbox itself is absent (unchecked), set it to '0'.
    for (const key of Object.keys(body)) {
      if (key.startsWith('_wdpcb_')) {
        const fieldName = key.slice(7);
        if (!(fieldName in body) && allowed.has(fieldName)) body[fieldName] = '0';
      }
    }

    const data: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (key.startsWith('_wdpcb_')) continue;
      // Accept "fieldname" or "table__fieldname" (strip table prefix if present)
      const fieldName = key.includes('__') ? key.split('__').slice(1).join('__') : key;
      if (!allowed.has(fieldName)) continue;
      // Arrays can happen if duplicate form names — take the last value
      data[fieldName] = Array.isArray(val) ? val[val.length - 1] : val;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const updated = await appDb(baseTable.table_name).where({ [pkName]: recordId }).update(data);

    if (!updated) return res.status(404).json({ error: 'Record not found' });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
