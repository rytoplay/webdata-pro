import { Router } from 'express';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import type { App, AppField } from '../../domain/types';
import { db as controlDb } from '../../db/knex';
import { getAppDb } from '../../db/adapters/appDb';
import { memoryUpload, saveUpload, deleteUpload } from '../../services/uploads';
import { maybeNotify } from '../../services/notifications';

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('csvfile');

export const dataRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

type EnrichedField = AppField & { ui_options: Record<string, unknown> };

function enrichFields(fields: AppField[]): EnrichedField[] {
  return fields.map(f => ({
    ...f,
    ui_options: f.ui_options_json ? (JSON.parse(f.ui_options_json) as Record<string, unknown>) : {}
  }));
}

function buildRecord(
  fields: AppField[],
  body: Record<string, unknown>,
  opts: { skipAutoIncrementPk?: boolean; skipPk?: boolean } = {}
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    if (opts.skipPk && field.is_primary_key) continue;
    if (opts.skipAutoIncrementPk && field.is_primary_key && field.is_auto_increment) continue;

    // File fields are handled separately via multer — skip here
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

async function loadTable(app: App, tableName: string) {
  return controlDb('app_tables').where({ app_id: app.id, table_name: tableName }).first();
}

async function loadFields(tableId: number): Promise<EnrichedField[]> {
  const fields: AppField[] = await controlDb('app_fields')
    .where({ table_id: tableId })
    .orderBy('sort_order');
  return enrichFields(fields);
}

/** Process multer files for image/upload fields, returns {fieldName → relativePath} */
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
    const isImage = field.data_type === 'image';
    result[file.fieldname] = await saveUpload(
      file.buffer,
      file.mimetype,
      app.slug,
      tableName,
      file.fieldname,
      isImage,
    );
  }
  return result;
}

// ── GET /data — table index ─────────────────────────────────────────────────

dataRouter.get('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const tables = await controlDb('app_tables')
      .where({ app_id: app.id, is_gallery: false })
      .orderBy('label');

    // Attach record counts for each table
    const appDb = getAppDb(app);
    const tablesWithCounts = await Promise.all(tables.map(async (t: { table_name: string; id: number; label: string; is_public_addable: boolean }) => {
      try {
        const exists = await appDb.schema.hasTable(t.table_name);
        const count  = exists ? Number((await appDb(t.table_name).count('* as n').first())?.n ?? 0) : 0;
        return { ...t, count, exists };
      } catch {
        return { ...t, count: 0, exists: false };
      }
    }));

    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/data/index', { title: 'Data', tables: tablesWithCounts, flash });
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName — list records ────────────────────────────────────

dataRouter.get('/:tableName', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key) ?? null;

    const appDb = getAppDb(app);
    const tableExists = await appDb.schema.hasTable(tableName);

    const q    = typeof req.query.q    === 'string' ? req.query.q.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';
    const dir  = req.query.dir === 'desc' ? 'desc' : 'asc';

    let records: Record<string, unknown>[] = [];
    if (tableExists) {
      const searchableFields = fields.filter(f =>
        !f.is_primary_key &&
        f.ui_widget !== 'checkbox' &&
        f.ui_widget !== 'hidden' &&
        !['boolean', 'integer', 'int', 'bigint', 'float', 'decimal', 'double', 'date', 'datetime', 'time'].includes(f.data_type.toLowerCase())
      );

      let query = appDb(tableName).limit(200).select('*');

      if (q && searchableFields.length > 0) {
        query = query.where(function () {
          for (const field of searchableFields) {
            this.orWhere(field.field_name, 'like', `%${q}%`);
          }
        });
      }

      // Sort — validate field name against known fields to prevent injection
      const sortField = fields.find(f => f.field_name === sort);
      if (sortField) {
        query = query.orderBy(sort, dir);
      }

      records = await query;
    }

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('admin/data/list', {
      title: `${table.label}`,
      table,
      fields,
      pkField,
      records,
      tableExists,
      q,
      sort,
      dir,
      flash
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/export ────────────────────────────────────────────
// Must be before /:tableName/:id routes

dataRouter.get('/:tableName/export', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).send('Table not found');

    const fields = await loadFields(table.id);
    const appDb  = getAppDb(app);

    const tableExists = await appDb.schema.hasTable(tableName);
    if (!tableExists) return res.status(404).send('Table does not exist');

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const searchableFields = fields.filter(f =>
      !f.is_primary_key &&
      f.ui_widget !== 'checkbox' &&
      f.ui_widget !== 'hidden' &&
      !['boolean', 'integer', 'int', 'bigint', 'float', 'decimal', 'double', 'date', 'datetime', 'time'].includes(f.data_type.toLowerCase())
    );

    let query = appDb(tableName).select('*');
    if (q && searchableFields.length > 0) {
      query = query.where(function () {
        for (const field of searchableFields) {
          this.orWhere(field.field_name, 'like', `%${q}%`);
        }
      });
    }

    const records = await query;

    function csvCell(val: unknown): string {
      const s = val === null || val === undefined ? '' : String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const headerRow = fields.map(f => csvCell(f.label)).join(',');
    const dataRows  = records.map((rec: Record<string, unknown>) =>
      fields.map(f => csvCell(rec[f.field_name])).join(',')
    );
    const csv = [headerRow, ...dataRows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/new ────────────────────────────────────────────────

dataRouter.get('/:tableName/new', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key) ?? null;

    res.render('admin/data/form', {
      title: `New ${table.label}`,
      table,
      fields,
      pkField,
      record: null,
      errors: null
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/import ────────────────────────────────────────────
// Must be before /:tableName/:id routes so "import" isn't captured as an id

dataRouter.get('/:tableName/import', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;
    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    const fields = await loadFields(table.id);
    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/data/import', { title: `Import — ${table.label}`, table, fields, flash, preview: null });
  } catch (err) { next(err); }
});

dataRouter.post('/:tableName/import', csvUpload, async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;
    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    const fields = await loadFields(table.id);

    if (!req.file) {
      req.session.flash = { type: 'danger', message: 'No file uploaded.' };
      return res.redirect(`/admin/data/${tableName}/import`);
    }

    let rows: Record<string, string>[];
    try {
      rows = csvParse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, string>[];
    } catch (e: unknown) {
      req.session.flash = { type: 'danger', message: `CSV parse error: ${e instanceof Error ? e.message : String(e)}` };
      return res.redirect(`/admin/data/${tableName}/import`);
    }

    if (rows.length === 0) {
      req.session.flash = { type: 'warning', message: 'The CSV file has no data rows.' };
      return res.redirect(`/admin/data/${tableName}/import`);
    }

    const csvColumns = Object.keys(rows[0]);
    const preview    = rows.slice(0, 5);

    const autoMap: Record<string, string> = {};
    for (const col of csvColumns) {
      const match = fields.find(
        f => f.field_name.toLowerCase() === col.toLowerCase() ||
             f.label.toLowerCase() === col.toLowerCase()
      );
      if (match && !match.is_primary_key && !match.is_auto_increment) {
        autoMap[col] = match.field_name;
      }
    }

    res.render('admin/data/import', {
      title:       `Import — ${table.label}`,
      table,
      fields:      fields.filter(f => !f.is_auto_increment),
      flash:       null,
      preview,
      csvColumns,
      autoMap,
      totalRows:   rows.length,
      rowsPayload: Buffer.from(JSON.stringify(rows)).toString('base64'),
    });
  } catch (err) { next(err); }
});

dataRouter.post('/:tableName/import/confirm', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;
    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields  = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key);

    let allRows: Record<string, string>[];
    try {
      allRows = JSON.parse(Buffer.from(req.body.rows_payload as string, 'base64').toString('utf8'));
    } catch {
      req.session.flash = { type: 'danger', message: 'Import data was corrupted. Please upload the CSV again.' };
      return res.redirect(`/admin/data/${tableName}/import`);
    }

    const mapping: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.body as Record<string, string>)) {
      if (key.startsWith('map_') && val) mapping[key.slice(4)] = val;
    }

    if (Object.keys(mapping).length === 0) {
      req.session.flash = { type: 'warning', message: 'No columns were mapped. Nothing imported.' };
      return res.redirect(`/admin/data/${tableName}/import`);
    }

    const appDb = getAppDb(app);
    let imported = 0;
    let skipped  = 0;
    const errors: string[] = [];

    for (let i = 0; i < allRows.length; i++) {
      const row    = allRows[i];
      const record: Record<string, unknown> = {};

      for (const [csvCol, fieldName] of Object.entries(mapping)) {
        const field = fields.find(f => f.field_name === fieldName);
        if (!field || (field.is_primary_key && field.is_auto_increment)) continue;
        const raw = row[csvCol];
        if (field.data_type === 'boolean' || field.ui_widget === 'checkbox') {
          record[fieldName] = ['1', 'true', 'yes', 'y'].includes((raw ?? '').toLowerCase()) ? 1 : 0;
        } else if (raw === '' || raw === undefined || raw === null) {
          record[fieldName] = null;
        } else {
          record[fieldName] = raw;
        }
      }

      const nonPkKeys = Object.keys(record).filter(k => k !== pkField?.field_name);
      if (nonPkKeys.length === 0 || nonPkKeys.every(k => record[k] === null || record[k] === '')) {
        skipped++; continue;
      }

      try {
        await appDb(tableName).insert(record);
        imported++;
      } catch (e: unknown) {
        errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
        if (errors.length >= 10) break;
      }
    }

    const parts = [`${imported} record${imported !== 1 ? 's' : ''} imported`];
    if (skipped  > 0) parts.push(`${skipped} skipped (empty)`);
    if (errors.length > 0) parts.push(`${errors.length} error(s): ${errors[0]}`);

    req.session.flash = {
      type:    errors.length > 0 && imported === 0 ? 'danger' : 'success',
      message: parts.join('. ') + '.',
    };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) { next(err); }
});

// ── POST /data/:tableName — create record ──────────────────────────────────

dataRouter.post('/:tableName', memoryUpload, async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields     = await loadFields(table.id);
    const record     = buildRecord(fields, req.body, { skipAutoIncrementPk: true });
    const filePaths  = await processUploads((req.files as Express.Multer.File[]) || [], fields, app, tableName);
    Object.assign(record, filePaths);

    const appDb = getAppDb(app);
    const [newId] = await appDb(tableName).insert(record);
    await maybeNotify(app, tableName, newId ? String(newId) : null, 'Admin');

    req.session.flash = { type: 'success', message: 'Record created.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/:id/edit ──────────────────────────────────────────

dataRouter.get('/:tableName/:id/edit', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields  = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb  = getAppDb(app);
    const record = await appDb(tableName).where({ [pkField.field_name]: id }).first();
    if (!record) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Record not found' });

    // Check for a gallery child table
    const galleryTable = await controlDb('app_tables')
      .where({ app_id: app.id, gallery_parent_table: tableName, is_gallery: true })
      .first() ?? null;

    res.render('admin/data/form', {
      title: `Edit ${table.label}`,
      table,
      fields,
      pkField,
      record,
      errors: null,
      galleryTable,
      appSlug: app.slug,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /data/:tableName/:id/delete ───────────────────────────────────────

dataRouter.post('/:tableName/:id/delete', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields  = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb = getAppDb(app);
    await appDb(tableName).where({ [pkField.field_name]: id }).delete();

    req.session.flash = { type: 'success', message: 'Record deleted.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /data/:tableName/:id — update record ──────────────────────────────

dataRouter.post('/:tableName/:id', memoryUpload, async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields  = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb = getAppDb(app);

    // Handle file uploads: delete old file if replaced
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

    req.session.flash = { type: 'success', message: 'Record updated.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});

