import { Router, Request, Response } from 'express';
import nunjucks from 'nunjucks';
import { db } from '../../db/knex';
import { appCors } from '../../middleware/cors';
import type { App } from '../../domain/types';
import * as viewsService from '../../services/views';
import { memoryUpload, saveUpload, deleteUpload, validateUpload, type UploadRestrictions } from '../../services/uploads';
import { touchRecordMeta } from '../../services/recordMeta';
import { maybeNotify } from '../../services/notifications';

async function getPortalContext(app: App, req: Request): Promise<{ portalHeader: string; portalFooter: string }> {
  if (!app.member_header_html && !app.member_footer_html) return { portalHeader: '', portalFooter: '' };
  const memberSession = (req.session as any)?.member;
  const memberData = memberSession?.memberId
    ? await db('members').where({ id: memberSession.memberId }).first()
    : null;
  const ctx = { app, member: memberData ?? null, logoutUrl: `/app/${app.slug}/logout` };
  const render = (tpl: string) => { try { return nunjucks.renderString(tpl, ctx); } catch { return ''; } };
  return {
    portalHeader: app.member_header_html ? render(app.member_header_html) : '',
    portalFooter: app.member_footer_html ? render(app.member_footer_html) : '',
  };
}

async function processUploadedFiles(
  files: Express.Multer.File[],
  allFields: { field_name: string; data_type: string; ui_options_json?: string | null }[],
  app: App,
  tableName: string,
): Promise<{ paths: Record<string, string>; errors: string[] }> {
  const paths: Record<string, string> = {};
  const errors: string[] = [];
  for (const file of files) {
    if (!file.size) continue;
    const field = allFields.find(f => f.field_name === file.fieldname);
    if (!field || (field.data_type !== 'image' && field.data_type !== 'upload')) continue;

    // Validate against per-field restrictions
    let restrictions: UploadRestrictions = {};
    try { restrictions = JSON.parse(field.ui_options_json ?? '{}'); } catch {}
    const err = validateUpload(file, restrictions);
    if (err) { errors.push(`${file.fieldname}: ${err}`); continue; }

    paths[file.fieldname] = await saveUpload(
      file.buffer, file.mimetype, app.slug, tableName, file.fieldname, field.data_type === 'image',
    );
  }
  return { paths, errors };
}

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
    const { q, page, sort, dir, searchOnly, per_page } = query;

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
    const { portalHeader, portalFooter } = await getPortalContext(app, req);

    const hasFieldFilters = Object.keys(fieldFilters).length > 0;
    const html = await viewsService.renderViewList(app, view, baseTable.table_name, templates, {
      q:            q ?? '',
      page:         page ? parseInt(page, 10) : 1,
      perPage:      per_page ? parseInt(per_page, 10) : undefined,
      sort:         sort ?? undefined,
      dir:          (dir === 'desc' ? 'desc' : 'asc'),
      searchOnly:   searchOnly === '1' && !hasFieldFilters,
      fieldFilters,
      ownerId,
      portalHeader,
      portalFooter,
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
    const { portalHeader, portalFooter } = await getPortalContext(app, req);
    const html = await viewsService.renderViewCreateForm(app, view, baseTable.table_name, templates, { portalHeader, portalFooter });

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
    const { portalHeader, portalFooter } = await getPortalContext(app, req);
    const html      = await viewsService.renderViewDetail(app, view, baseTable.table_name, templates, recordId, { portalHeader, portalFooter });

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
    const { portalHeader, portalFooter } = await getPortalContext(app, req);
    const html      = await viewsService.renderViewEditForm(app, view, baseTable.table_name, templates, recordId, { portalHeader, portalFooter });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v/:appSlug/:viewName — create record ──────────────────────────

apiViewsRouter.post('/:viewName', memoryUpload, async (req, res, next) => {
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

    // Process any uploaded files (image/upload fields)
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const { paths: filePaths, errors: uploadErrors } = await processUploadedFiles(uploadedFiles, allFields, app, baseTable.table_name);
    if (uploadErrors.length) return res.status(400).json({ error: uploadErrors.join('; ') });
    Object.assign(data, filePaths);

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

apiViewsRouter.patch('/:viewName/:recordId', memoryUpload, async (req, res, next) => {
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

    // Process any uploaded files, deleting old ones if replaced
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    if (uploadedFiles.some(f => f.size > 0)) {
      const { paths: filePaths, errors: uploadErrors } = await processUploadedFiles(uploadedFiles, allFields, app, baseTable.table_name);
      if (uploadErrors.length) return res.status(400).json({ error: uploadErrors.join('; ') });
      const { getAppDb: getAppDbForOld } = await import('../../db/adapters/appDb');
      const oldRecord = await getAppDbForOld(app)(baseTable.table_name).where({ [pkName]: recordId }).first();
      for (const [fieldName, newPath] of Object.entries(filePaths)) {
        const oldPath = oldRecord?.[fieldName];
        if (oldPath) deleteUpload(oldPath);
        data[fieldName] = newPath;
      }
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

// ── Gallery photo endpoints ────────────────────────────────────────────────────
// These operate on `{parent}_photos` tables created by the gallery field type.
// The URL param can be either the gallery table name OR the parent table name —
// resolveGalleryTable() handles both so $gallery[properties] and $gallery[properties_photos] both work.

async function resolveGalleryTable(appId: number, param: string): Promise<string | null> {
  // Try direct match (gallery table name)
  let row = await db('app_tables')
    .where({ app_id: appId, table_name: param, is_gallery: true })
    .first();
  if (row) return row.table_name;
  // Try as parent table name → find its gallery child
  row = await db('app_tables')
    .where({ app_id: appId, gallery_parent_table: param, is_gallery: true })
    .first();
  if (row) return row.table_name;
  // Try dot notation: "products.photos" → look for table named "products_photos"
  if (param.includes('.')) {
    const candidate = param.replace('.', '_');
    row = await db('app_tables')
      .where({ app_id: appId, table_name: candidate, is_gallery: true })
      .first();
    if (row) return row.table_name;
  }
  return null;
}

// GET — list photos for a record
apiViewsRouter.get('/gallery/:galleryTable/:recordId', async (req, res, next) => {
  try {
    const app = res.locals.apiApp as App;
    const { galleryTable: param, recordId } = req.params;

    const galleryTable = await resolveGalleryTable(app.id, param);
    if (!galleryTable) return res.status(404).json({ error: 'Gallery table not found' });

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const photos = await appDb(galleryTable)
      .where({ record_id: recordId })
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .select('id', 'record_id', 'file_path', 'original_name', 'sort_order', 'caption');

    res.json({ photos });
  } catch (err) {
    next(err);
  }
});

// POST — upload one or more photos for a record
apiViewsRouter.post('/gallery/:galleryTable/:recordId', memoryUpload, async (req, res, next) => {
  try {
    const app = res.locals.apiApp as App;
    const { galleryTable: param, recordId } = req.params;

    // Require authentication (admin or member session)
    const isAdmin = (req.session as any)?.admin?.isAdmin === true;
    const memberSession = (req.session as any)?.member;
    if (!isAdmin && !(memberSession?.appId === app.id)) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const galleryTable = await resolveGalleryTable(app.id, param);
    if (!galleryTable) return res.status(404).json({ error: 'Gallery table not found' });

    const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Load per-gallery upload restrictions from app_tables.ui_options_json
    const galleryTableRow = await db('app_tables')
      .where({ app_id: app.id, table_name: galleryTable })
      .first();
    let galleryRestrictions: UploadRestrictions = {};
    try { galleryRestrictions = JSON.parse(galleryTableRow?.ui_options_json ?? '{}'); } catch {}

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);

    // Get current max sort_order for this record
    const maxRow = await appDb(galleryTable)
      .where({ record_id: recordId })
      .max('sort_order as maxSort')
      .first() as any;
    let nextSort = (maxRow?.maxSort ?? -1) + 1;

    const inserted: unknown[] = [];
    const skipped: string[]   = [];
    for (const file of files) {
      if (!file.size) continue;
      const validErr = validateUpload(file, galleryRestrictions);
      if (validErr) { skipped.push(`${file.originalname}: ${validErr}`); continue; }
      const filePath = await saveUpload(
        file.buffer, file.mimetype, app.slug, galleryTable, 'photo', true
      );
      const [id] = await appDb(galleryTable).insert({
        record_id: recordId,
        file_path: filePath,
        original_name: file.originalname ?? null,
        sort_order: nextSort++,
        caption: null,
        created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      inserted.push({ id, file_path: filePath });
    }

    if (!inserted.length && skipped.length) {
      return res.status(400).json({ error: skipped.join('; ') });
    }
    res.json({ ok: true, inserted, ...(skipped.length ? { skipped } : {}) });
  } catch (err) {
    next(err);
  }
});

// POST — remove a single photo
apiViewsRouter.post('/gallery/:galleryTable/photo/:photoId/delete', async (req, res, next) => {
  try {
    const app = res.locals.apiApp as App;
    const { galleryTable: param, photoId } = req.params;

    const isAdmin = (req.session as any)?.admin?.isAdmin === true;
    const memberSession = (req.session as any)?.member;
    if (!isAdmin && !(memberSession?.appId === app.id)) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const galleryTable = await resolveGalleryTable(app.id, param);
    if (!galleryTable) return res.status(404).json({ error: 'Gallery table not found' });

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);
    const photo = await appDb(galleryTable).where({ id: photoId }).first();
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const { deleteUpload } = await import('../../services/uploads');
    deleteUpload(photo.file_path);
    await appDb(galleryTable).where({ id: photoId }).delete();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Public form submission ────────────────────────────────────────────────────
// POST /api/v/:appSlug/form/:tableName
// Accepts submissions from public-facing $formopen/$form tokens.
// Only works when the table has is_public_addable = true.

apiViewsRouter.post('/form/:tableName', async (req, res, next) => {
  try {
    const app = res.locals.apiApp as App;
    const { tableName } = req.params;

    // Validate table name (alphanumeric + underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).send('Invalid table name.');
    }

    const table = await db('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) return res.status(404).send('Table not found.');
    if (!table.is_public_addable) return res.status(403).send('This table does not accept public submissions.');

    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);

    // Load non-PK fields to know what to accept
    const fields = await db('app_fields')
      .where({ table_id: table.id, is_primary_key: false })
      .orderBy('sort_order');

    const record: Record<string, unknown> = {};
    for (const field of fields) {
      // Skip image/upload fields — public forms don't handle file uploads
      if (field.data_type === 'image' || field.data_type === 'upload') continue;
      const name = field.field_name as string;
      // Accept both "fieldName" and "tableName__fieldName" (WDP convention)
      const raw  = req.body[name] ?? req.body[`${tableName}__${name}`];
      if (raw === undefined) {
        // Unchecked checkboxes are omitted by the browser; default to false/0
        if (field.ui_widget === 'checkbox') record[name] = 0;
        continue;
      }
      if (field.ui_widget === 'checkbox') {
        record[name] = (raw === 'on' || raw === '1' || raw === 'true' || raw === true) ? 1 : 0;
      } else {
        record[name] = raw === '' ? null : raw;
      }
    }

    const [newId] = await appDb(tableName).insert(record);

    // Write metadata so ownership can be tracked (anonymous public submission)
    if (newId) {
      await touchRecordMeta(app, tableName, String(newId), null, 'Public', new Date().toISOString());
      await maybeNotify(app, tableName, String(newId), 'Public');
    }

    const redirectTo = String(req.body._redirect || req.headers.referer || '/');
    res.redirect(redirectTo);
  } catch (err) {
    next(err);
  }
});

// POST — reorder photos
apiViewsRouter.post('/gallery/:galleryTable/:recordId/reorder', async (req, res, next) => {
  try {
    const app = res.locals.apiApp as App;
    const { galleryTable: param, recordId } = req.params;

    const isAdmin = (req.session as any)?.admin?.isAdmin === true;
    const memberSession = (req.session as any)?.member;
    if (!isAdmin && !(memberSession?.appId === app.id)) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const galleryTable = await resolveGalleryTable(app.id, param);
    if (!galleryTable) return res.status(404).json({ error: 'Gallery table not found' });

    const order: { id: number; sort_order: number }[] = req.body.order || [];
    const { getAppDb } = await import('../../db/adapters/appDb');
    const appDb = getAppDb(app);

    for (const item of order) {
      await appDb(galleryTable)
        .where({ id: item.id, record_id: recordId })
        .update({ sort_order: item.sort_order });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
