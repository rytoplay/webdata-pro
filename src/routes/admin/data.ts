import { Router } from 'express';
import type { App, AppField } from '../../domain/types';
import { db as controlDb } from '../../db/knex';
import { getAppDb } from '../../db/adapters/appDb';

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

// ── GET /data — redirect to first table ────────────────────────────────────

dataRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await controlDb('app_tables').where({ app_id: app.id }).orderBy('label');
    if (tables.length === 0) {
      return res.render('admin/data/list', { title: 'Data Browser', table: null, records: [], fields: [], pkField: null, tableExists: false, flash: null });
    }
    res.redirect(`/admin/data/${tables[0].table_name}`);
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

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

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
      flash
    });
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

// ── POST /data/:tableName — create record ──────────────────────────────────

dataRouter.post('/:tableName', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields = await loadFields(table.id);
    const appDb  = getAppDb(app);
    await appDb(tableName).insert(buildRecord(fields, req.body, { skipAutoIncrementPk: true }));

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

    res.render('admin/data/form', {
      title: `Edit ${table.label}`,
      table,
      fields,
      pkField,
      record,
      errors: null
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

dataRouter.post('/:tableName/:id', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await loadTable(app, tableName);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    const fields  = await loadFields(table.id);
    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key' });

    const appDb = getAppDb(app);
    await appDb(tableName)
      .where({ [pkField.field_name]: id })
      .update(buildRecord(fields, req.body, { skipPk: true }));

    req.session.flash = { type: 'success', message: 'Record updated.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});
