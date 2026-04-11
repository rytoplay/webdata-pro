import { Router } from 'express';
import { db } from '../../db/knex';
import { appCors } from '../../middleware/cors';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';

export const apiViewsRouter = Router({ mergeParams: true });

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
    const { q, page, sort, dir } = req.query as Record<string, string>;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    // Auth check: private views require a JWT (stub — always allow for now)
    if (!view.is_public) {
      // TODO: JWT verification against member/group permissions
      // For now, return 401 placeholder
      return res.status(401).send('<p class="wdp-error">This view requires authentication.</p>');
    }

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).send('<p class="wdp-error">Base table not configured.</p>');

    const templates = await viewsService.getViewTemplates(app.id, view.id);

    const html = await viewsService.renderViewList(app, view, baseTable.table_name, templates, {
      q:    q ?? '',
      page: page ? parseInt(page, 10) : 1,
      sort: sort ?? undefined,
      dir:  (dir === 'desc' ? 'desc' : 'asc'),
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

    if (!view.is_public) {
      return res.status(401).send('<p class="wdp-error">This view requires authentication.</p>');
    }

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
