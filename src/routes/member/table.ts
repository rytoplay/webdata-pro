import { Router } from 'express';
import type { App, AppField } from '../../domain/types';
import { db as controlDb } from '../../db/knex';
import { getAppDb } from '../../db/adapters/appDb';
import { touchRecordMeta } from '../../services/recordMeta';
import { maybeNotify } from '../../services/notifications';
import { memoryUpload, saveUpload, deleteUpload } from '../../services/uploads';
import { getBranding } from './branding';

export const memberTableRouter = Router({ mergeParams: true });

// ── Shared helpers (mirrors admin/data.ts) ───────────────────────────────────

type EnrichedField = AppField & { ui_options: Record<string, unknown> };

function enrichFields(fields: AppField[]): EnrichedField[] {
  return fields.map(f => ({
    ...f,
    ui_options: f.ui_options_json ? (JSON.parse(f.ui_options_json) as Record<string, unknown>) : {},
  }));
}

function buildRecord(
  fields: AppField[],
  body: Record<string, unknown>,
  opts: { skipAutoIncrementPk?: boolean; skipPk?: boolean } = {},
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    if (opts.skipPk && field.is_primary_key) continue;
    if (opts.skipAutoIncrementPk && field.is_primary_key && field.is_auto_increment) continue;
    if (field.data_type === 'image' || field.data_type === 'upload') continue;
    const raw = body[field.field_name];
    if (field.data_type === 'boolean' || field.ui_widget === 'checkbox') {
      record[field.field_name] = raw === 'on' || raw === '1' || raw === 'true' ? 1 : 0;
    } else if (raw === '' || raw === undefined || raw === null) {
      record[field.field_name] = null;
    } else {
      record[field.field_name] = raw;
    }
  }
  return record;
}

async function processUploads(
  files: Express.Multer.File[],
  fields: EnrichedField[],
  app: App,
  tableName: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of files) {
    const field = fields.find(f => f.field_name === file.fieldname);
    if (!field) continue;
    if (field.data_type !== 'image' && field.data_type !== 'upload') continue;
    result[file.fieldname] = await saveUpload(
      file.buffer, file.mimetype, app.slug, tableName, file.fieldname,
      field.data_type === 'image',
    );
  }
  return result;
}

interface TablePerm {
  can_add:       boolean;
  can_edit:      boolean;
  can_delete:    boolean;
  manage_all:    boolean;
  single_record: boolean;
}

async function getTablePerm(
  groupIds: number[],
  tableId: number,
): Promise<TablePerm | null> {
  if (!groupIds.length) return null;
  const rows = await controlDb('group_table_permissions')
    .whereIn('group_id', groupIds)
    .where({ table_id: tableId })
    .select('can_add', 'can_edit', 'can_delete', 'manage_all', 'single_record');
  if (!rows.length) return null;
  return rows.reduce((acc: TablePerm, p: any) => ({
    can_add:       acc.can_add       || !!p.can_add,
    can_edit:      acc.can_edit      || !!p.can_edit,
    can_delete:    acc.can_delete    || !!p.can_delete,
    manage_all:    acc.manage_all    || !!p.manage_all,
    single_record: acc.single_record || !!p.single_record,
  }), { can_add: false, can_edit: false, can_delete: false, manage_all: false, single_record: false });
}

async function getMemberName(memberId: number): Promise<string | null> {
  const row = await controlDb('members')
    .where({ id: memberId })
    .select('first_name', 'last_name', 'email')
    .first();
  if (!row) return null;
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
}

// Safe metadata lookup — returns null if _wdpro_metadata table doesn't exist yet
async function getOwnMeta(appDb: ReturnType<typeof getAppDb>, tableName: string, memberId: number) {
  try {
    return await appDb('_wdpro_metadata')
      .where({ table_name: tableName, created_by_id: memberId })
      .orderBy('created_at', 'desc')
      .first();
  } catch {
    return null;
  }
}

// ── GET /table/:tableName — list records (or redirect for single_record) ──────

memberTableRouter.get('/:tableName', async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const { tableName } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You do not have access to this table.' });
    }

    const appDb = getAppDb(app);

    // single_record: redirect straight to edit or new
    if (perm.single_record) {
      const meta = await getOwnMeta(appDb, tableName, member.memberId);
      if (meta?.record_id) {
        return res.redirect(`/app/${app.slug}/table/${tableName}/${meta.record_id}/edit`);
      } else if (perm.can_add) {
        return res.redirect(`/app/${app.slug}/table/${tableName}/new`);
      } else {
        return res.status(403).render('admin/error', { title: 'No Record', message: 'You do not have a record here yet.' });
      }
    }

    const fields   = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField  = fields.find(f => f.is_primary_key) ?? null;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const searchableFields = fields.filter(f =>
      !f.is_primary_key &&
      f.ui_widget !== 'checkbox' &&
      f.ui_widget !== 'hidden' &&
      !['boolean', 'integer', 'int', 'bigint', 'float', 'decimal', 'double', 'date', 'datetime', 'time']
        .includes(f.data_type.toLowerCase())
    );

    let records: Record<string, unknown>[] = [];

    if (!perm.manage_all) {
      // Restrict to own records via metadata
      let ownIds: string[] = [];
      try {
        const metas = await appDb('_wdpro_metadata')
          .where({ table_name: tableName, created_by_id: member.memberId })
          .select('record_id');
        ownIds = metas.map((m: any) => m.record_id);
      } catch { /* metadata table doesn't exist yet */ }

      if (ownIds.length > 0 && pkField) {
        let query = appDb(tableName).whereIn(pkField.field_name, ownIds).limit(200).select('*');
        if (q && searchableFields.length > 0) {
          query = query.where(function (this: any) {
            for (const field of searchableFields) this.orWhere(field.field_name, 'like', `%${q}%`);
          });
        }
        records = await query;
      }
    } else {
      let query = appDb(tableName).limit(200).select('*');
      if (q && searchableFields.length > 0) {
        query = query.where(function (this: any) {
          for (const field of searchableFields) this.orWhere(field.field_name, 'like', `%${q}%`);
        });
      }
      records = await query;
    }

    const flash = req.session.flash; delete req.session.flash;
    const { headerHtml, footerHtml } = await getBranding(app, member.memberId);

    res.render('member/table-list', {
      title: table.label,
      table, fields, pkField, records, q, perm,
      tableUrl:  `/app/${app.slug}/table/${tableName}`,
      newUrl:    perm.can_add ? `/app/${app.slug}/table/${tableName}/new` : null,
      homeUrl:   `/app/${app.slug}/`,
      sitemapUrl:`/app/${app.slug}/sitemap`,
      memberLogoutUrl: `/app/${app.slug}/logout`,
      suppressPortalNav: !!headerHtml,
      headerHtml, footerHtml,
      flash,
    });
  } catch (err) { next(err); }
});

// ── GET /table/:tableName/new — create form ────────────────────────────────────

memberTableRouter.get('/:tableName/new', async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const { tableName } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm?.can_add) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You cannot add records to this table.' });
    }

    // single_record: if already has a record redirect to edit
    if (perm.single_record) {
      const appDb = getAppDb(app);
      const meta = await getOwnMeta(appDb, tableName, member.memberId);
      if (meta?.record_id) {
        return res.redirect(`/app/${app.slug}/table/${tableName}/${meta.record_id}/edit`);
      }
    }

    const fields  = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField = fields.find(f => f.is_primary_key) ?? null;
    const { headerHtml, footerHtml } = await getBranding(app, member.memberId);

    res.render('member/table-form', {
      title: `New ${table.label}`,
      table, fields, pkField, record: null, errors: null, perm,
      formAction:  `/app/${app.slug}/table/${tableName}/new`,
      backUrl:     `/app/${app.slug}/`,
      canDelete:   false,
      homeUrl:     `/app/${app.slug}/`,
      sitemapUrl:  `/app/${app.slug}/sitemap`,
      memberLogoutUrl: `/app/${app.slug}/logout`,
      suppressPortalNav: !!headerHtml,
      headerHtml, footerHtml,
    });
  } catch (err) { next(err); }
});

// ── POST /table/:tableName/new — create record ─────────────────────────────────

memberTableRouter.post('/:tableName/new', memoryUpload, async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) return res.redirect(`/app/${app.slug}/login`);

    const { tableName } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm?.can_add) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You cannot add records to this table.' });
    }

    const fields    = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField   = fields.find(f => f.is_primary_key);
    const appDb     = getAppDb(app);

    const record    = buildRecord(fields, req.body, { skipAutoIncrementPk: true });
    const filePaths = await processUploads((req.files as Express.Multer.File[]) || [], fields, app, tableName);
    Object.assign(record, filePaths);

    const [newId]  = await appDb(tableName).insert(record);
    const recordId = pkField?.is_auto_increment
      ? String(newId)
      : String(record[pkField?.field_name ?? ''] ?? newId);

    const memberName = await getMemberName(member.memberId);
    await touchRecordMeta(app, tableName, recordId, member.memberId, memberName, new Date().toISOString());
    await maybeNotify(app, tableName, recordId, memberName || `Member #${member.memberId}`);

    req.session.flash = { type: 'success', message: 'Record created.' };
    res.redirect(
      perm.single_record
        ? `/app/${app.slug}/table/${tableName}/${recordId}/edit`
        : `/app/${app.slug}/table/${tableName}`,
    );
  } catch (err) { next(err); }
});

// ── GET /table/:tableName/:id/edit — edit form ─────────────────────────────────

memberTableRouter.get('/:tableName/:id/edit', async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const { tableName, id } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm?.can_edit && !perm?.manage_all) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You cannot edit records in this table.' });
    }

    const fields  = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb  = getAppDb(app);
    const record = await appDb(tableName).where({ [pkField.field_name]: id }).first();
    if (!record) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Record not found' });

    // Ownership check (skipped for manage_all)
    if (!perm.manage_all) {
      let meta: any = null;
      try {
        meta = await appDb('_wdpro_metadata')
          .where({ table_name: tableName, record_id: String(id) })
          .first();
      } catch { /* no metadata table */ }
      if (!meta || meta.created_by_id !== member.memberId) {
        return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You can only edit your own records.' });
      }
    }

    const galleryTable = await controlDb('app_tables')
      .where({ app_id: app.id, gallery_parent_table: tableName, is_gallery: true })
      .first() ?? null;

    const flash = req.session.flash; delete req.session.flash;
    const { headerHtml, footerHtml } = await getBranding(app, member.memberId);

    res.render('member/table-form', {
      title: `Edit ${table.label}`,
      table, fields, pkField, record, errors: null, perm,
      formAction:  `/app/${app.slug}/table/${tableName}/${id}/edit`,
      backUrl:     perm.single_record ? `/app/${app.slug}/` : `/app/${app.slug}/table/${tableName}`,
      canDelete:   !!(perm.can_delete || perm.manage_all),
      deleteAction:`/app/${app.slug}/table/${tableName}/${id}/delete`,
      galleryTable, appSlug: app.slug,
      homeUrl:     `/app/${app.slug}/`,
      sitemapUrl:  `/app/${app.slug}/sitemap`,
      memberLogoutUrl: `/app/${app.slug}/logout`,
      suppressPortalNav: !!headerHtml,
      headerHtml, footerHtml,
      flash,
    });
  } catch (err) { next(err); }
});

// ── POST /table/:tableName/:id/edit — update record ────────────────────────────

memberTableRouter.post('/:tableName/:id/edit', memoryUpload, async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) return res.redirect(`/app/${app.slug}/login`);

    const { tableName, id } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm?.can_edit && !perm?.manage_all) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You cannot edit records in this table.' });
    }

    const fields  = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb = getAppDb(app);

    if (!perm.manage_all) {
      let meta: any = null;
      try {
        meta = await appDb('_wdpro_metadata')
          .where({ table_name: tableName, record_id: String(id) })
          .first();
      } catch { /* no metadata table */ }
      if (!meta || meta.created_by_id !== member.memberId) {
        return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You can only edit your own records.' });
      }
    }

    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    if (uploadedFiles.length > 0) {
      const existing = await appDb(tableName).where({ [pkField.field_name]: id }).first();
      for (const file of uploadedFiles) {
        const field = fields.find(f => f.field_name === file.fieldname);
        if (!field) continue;
        const oldPath = existing?.[file.fieldname];
        if (oldPath) deleteUpload(String(oldPath));
      }
    }

    const record    = buildRecord(fields, req.body, { skipPk: true });
    const filePaths = await processUploads(uploadedFiles, fields, app, tableName);
    Object.assign(record, filePaths);

    await appDb(tableName).where({ [pkField.field_name]: id }).update(record);

    const memberName = await getMemberName(member.memberId);
    await touchRecordMeta(app, tableName, id, member.memberId, memberName, new Date().toISOString());

    req.session.flash = { type: 'success', message: 'Record updated.' };
    res.redirect(
      perm.single_record
        ? `/app/${app.slug}/table/${tableName}/${id}/edit`
        : `/app/${app.slug}/table/${tableName}`,
    );
  } catch (err) { next(err); }
});

// ── POST /table/:tableName/:id/delete — delete record ─────────────────────────

memberTableRouter.post('/:tableName/:id/delete', async (req, res, next) => {
  try {
    const app    = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) return res.redirect(`/app/${app.slug}/login`);

    const { tableName, id } = req.params;
    const table = await controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const perm = await getTablePerm(member.groupIds, table.id);
    if (!perm?.can_delete && !perm?.manage_all) {
      return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You cannot delete records in this table.' });
    }

    const fields  = enrichFields(await controlDb('app_fields').where({ table_id: table.id }).orderBy('sort_order'));
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb = getAppDb(app);

    if (!perm.manage_all) {
      let meta: any = null;
      try {
        meta = await appDb('_wdpro_metadata')
          .where({ table_name: tableName, record_id: String(id) })
          .first();
      } catch { /* no metadata table */ }
      if (!meta || meta.created_by_id !== member.memberId) {
        return res.status(403).render('admin/error', { title: 'Forbidden', message: 'You can only delete your own records.' });
      }
    }

    await appDb(tableName).where({ [pkField.field_name]: id }).delete();

    req.session.flash = { type: 'success', message: 'Record deleted.' };
    res.redirect(
      perm.single_record
        ? `/app/${app.slug}/`
        : `/app/${app.slug}/table/${tableName}`,
    );
  } catch (err) { next(err); }
});
