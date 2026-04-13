import { Router, Request, Response } from 'express';
import { db } from '../../db/knex';
import { appCors } from '../../middleware/cors';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';

export const apiViewsRouter = Router({ mergeParams: true });

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function checkViewAccess(req: Request, res: Response, app: App, view: { id: number; is_public: boolean; view_name?: string }, asJson = false): Promise<boolean> {
  if (view.is_public) return true;
  if ((req.session as any)?.admin?.isAdmin === true) return true;

  const memberSession = (req.session as any)?.member;
  if (memberSession?.appId === app.id && Array.isArray(memberSession.groupIds) && memberSession.groupIds.length > 0) {
    const perm = await db('view_group_permissions')
      .whereIn('group_id', memberSession.groupIds)
      .where({ view_id: view.id, can_view: true })
      .first();
    if (perm) return true;
  }

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

// Returns ownership filter state for the current member session on this view
async function getOwnerFilter(app: App, viewId: number, memberSession: any): Promise<number | undefined> {
  if (!memberSession || memberSession.appId !== app.id || !Array.isArray(memberSession.groupIds)) return undefined;
  const perm = await db('view_group_permissions')
    .whereIn('group_id', memberSession.groupIds)
    .where({ view_id: viewId, can_view: true })
    .first();
  if (!perm || !perm.limit_to_own_records) return undefined;
  return memberSession.memberId ?? undefined;
}

// Check table-level permission (can_add / can_edit / can_delete) + manage_all
async function checkTablePermission(
  app: App,
  tableId: number,
  memberSession: any,
  action: 'can_add' | 'can_edit' | 'can_delete'
): Promise<{ allowed: boolean; manageAll: boolean }> {
  if (!memberSession || memberSession.appId !== app.id || !Array.isArray(memberSession.groupIds)) {
    return { allowed: false, manageAll: false };
  }
  const perm = await db('group_table_permissions')
    .whereIn('group_id', memberSession.groupIds)
    .where({ table_id: tableId, [action]: true })
    .first();
  if (!perm) return { allowed: false, manageAll: false };
  return { allowed: true, manageAll: !!perm.manage_all };
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

    const fieldFilters: Record<string, string> = {};
    for (const [key, val] of Object.entries(query)) {
      if (key.startsWith('f_') && val) fieldFilters[key.slice(2)] = val;
    }

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    if (!await checkViewAccess(req, res, app, view)) return;

    const memberSession = (req.session as any)?.member;
    const ownerId = await getOwnerFilter(app, view.id, memberSession);

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
      ownerId,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v/:appSlug/:viewName/new — create form ─────────────────────────
// NOTE: must be defined before /:viewName/:recordId to avoid "new" matching as a recordId

apiViewsRouter.get('/:viewName/new', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).send('<p class="wdp-error">View not found.</p>');

    if (!await checkViewAccess(req, res, app, view)) return;

    if (!((req.session as any)?.admin?.isAdmin === true)) {
      const memberSession = (req.session as any)?.member;
      const { allowed } = await checkTablePermission(app, view.base_table_id, memberSession, 'can_add');
      if (!allowed) return res.status(403).send('<p class="wdp-error">You do not have permission to create records.</p>');
    }

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).send('<p class="wdp-error">Base table not configured.</p>');

    const templates = await viewsService.getViewTemplates(app.id, view.id);
    const html = await viewsService.renderViewCreateForm(app, view, baseTable.table_name, templates);

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

// ── POST /api/v/:appSlug/:viewName — create record ──────────────────────────

apiViewsRouter.post('/:viewName', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).json({ error: 'View not found' });

    if (!await checkViewAccess(req, res, app, view, true)) return;

    if (!((req.session as any)?.admin?.isAdmin === true)) {
      const memberSession = (req.session as any)?.member;
      const { allowed } = await checkTablePermission(app, view.base_table_id, memberSession, 'can_add');
      if (!allowed) return res.status(403).json({ error: 'You do not have permission to create records.' });
    }

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).json({ error: 'Base table not configured' });

    const allFields = await db('app_fields').where({ table_id: view.base_table_id });
    const allowed = new Set(
      allFields
        .filter((f: { is_primary_key: boolean }) => !f.is_primary_key)
        .map((f: { field_name: string }) => f.field_name)
    );

    const body = req.body as Record<string, string | string[]>;

    for (const key of Object.keys(body)) {
      if (key.startsWith('_wdpcb_')) {
        const fieldName = key.slice(7);
        if (!(fieldName in body) && allowed.has(fieldName)) body[fieldName] = '0';
      }
    }

    const data: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (key.startsWith('_wdpcb_')) continue;
      const fieldName = key.includes('__') ? key.split('__').slice(1).join('__') : key;
      if (!allowed.has(fieldName)) continue;
      data[fieldName] = Array.isArray(val) ? val[val.length - 1] : val;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to insert' });
    }

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const [newId] = await appDb(baseTable.table_name).insert(data);

    const { touchRecordMeta } = await import('../../services/recordMeta');
    const memberSession = (req.session as any)?.member;
    const memberId   = memberSession?.memberId ?? null;
    const memberName = memberId
      ? await db('members').where({ id: memberId }).first().then((m: any) =>
          m ? (m.first_name && m.last_name ? `${m.first_name} ${m.last_name}`.trim() : m.email) : null
        )
      : null;
    await touchRecordMeta(app, baseTable.table_name, String(newId), memberId, memberName, new Date().toISOString());

    res.json({ ok: true, id: newId });
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

    // Check can_edit + ownership (admins bypass)
    if (!((req.session as any)?.admin?.isAdmin === true)) {
      const memberSession = (req.session as any)?.member;
      const { allowed, manageAll } = await checkTablePermission(app, view.base_table_id, memberSession, 'can_edit');
      if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit records.' });

      if (!manageAll) {
        const { getRecordMeta } = await import('../../services/recordMeta');
        const meta = await getRecordMeta(app, baseTable.table_name, recordId);
        if (!meta || meta.created_by_id !== memberSession?.memberId) {
          return res.status(403).json({ error: 'You can only edit records you created.' });
        }
      }
    }

    const allFields = await db('app_fields').where({ table_id: view.base_table_id });
    const pkField   = allFields.find((f: { is_primary_key: boolean }) => f.is_primary_key);
    const pkName    = pkField?.field_name ?? 'id';
    const allowed   = new Set(
      allFields
        .filter((f: { field_name: string; is_primary_key: boolean }) => !f.is_primary_key)
        .map((f: { field_name: string }) => f.field_name)
    );

    const body = req.body as Record<string, string | string[]>;

    for (const key of Object.keys(body)) {
      if (key.startsWith('_wdpcb_')) {
        const fieldName = key.slice(7);
        if (!(fieldName in body) && allowed.has(fieldName)) body[fieldName] = '0';
      }
    }

    const data: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (key.startsWith('_wdpcb_')) continue;
      const fieldName = key.includes('__') ? key.split('__').slice(1).join('__') : key;
      if (!allowed.has(fieldName)) continue;
      data[fieldName] = Array.isArray(val) ? val[val.length - 1] : val;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const updated = await appDb(baseTable.table_name).where({ [pkName]: recordId }).update(data);

    if (!updated) return res.status(404).json({ error: 'Record not found' });

    const { touchRecordMeta } = await import('../../services/recordMeta');
    const memberSession = (req.session as any)?.member;
    const memberId   = memberSession?.memberId ?? null;
    const memberName = memberId
      ? await db('members').where({ id: memberId }).first().then((m: any) =>
          m ? (m.first_name && m.last_name ? `${m.first_name} ${m.last_name}`.trim() : m.email) : null
        )
      : null;
    await touchRecordMeta(app, baseTable.table_name, recordId, memberId, memberName, new Date().toISOString());

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v/:appSlug/:viewName/:recordId/delete — delete record ──────────

apiViewsRouter.post('/:viewName/:recordId/delete', async (req, res, next) => {
  try {
    const app      = res.locals.apiApp as App;
    const { viewName, recordId } = req.params;

    const view = await viewsService.getViewByName(app.id, viewName);
    if (!view) return res.status(404).json({ error: 'View not found' });

    if (!await checkViewAccess(req, res, app, view, true)) return;

    const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
    if (!baseTable) return res.status(500).json({ error: 'Base table not configured' });

    // Check can_delete + ownership (admins bypass)
    if (!((req.session as any)?.admin?.isAdmin === true)) {
      const memberSession = (req.session as any)?.member;
      const { allowed, manageAll } = await checkTablePermission(app, view.base_table_id, memberSession, 'can_delete');
      if (!allowed) return res.status(403).json({ error: 'You do not have permission to delete records.' });

      if (!manageAll) {
        const { getRecordMeta } = await import('../../services/recordMeta');
        const meta = await getRecordMeta(app, baseTable.table_name, recordId);
        if (!meta || meta.created_by_id !== memberSession?.memberId) {
          return res.status(403).json({ error: 'You can only delete records you created.' });
        }
      }
    }

    const allFields = await db('app_fields').where({ table_id: view.base_table_id });
    const pkField   = allFields.find((f: { is_primary_key: boolean }) => f.is_primary_key);
    const pkName    = pkField?.field_name ?? 'id';

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const deleted = await appDb(baseTable.table_name).where({ [pkName]: recordId }).delete();

    if (!deleted) return res.status(404).json({ error: 'Record not found' });

    // Clean up ownership metadata (best-effort)
    try {
      await appDb('_wdpro_metadata')
        .where({ table_name: baseTable.table_name, record_id: String(recordId) })
        .delete();
    } catch {
      // table may not exist yet — not an error
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
