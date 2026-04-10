import { Router } from 'express';
import type { App, AppField } from '../../domain/types';
import { db as controlDb } from '../../db/knex';
import { getAppDb } from '../../db/adapters/appDb';

export const dataRouter = Router();

// ── GET /data — redirect to first table ────────────────────────────────────

dataRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await controlDb('app_tables').where({ app_id: app.id }).orderBy('label');
    if (tables.length === 0) {
      return res.render('admin/data/no-tables', { title: 'Data Browser' });
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

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    const allTables = await controlDb('app_tables').where({ app_id: app.id }).orderBy('label');
    const pkField = fields.find(f => f.is_primary_key) ?? null;

    const appDb = getAppDb(app);
    const tableExists = await appDb.schema.hasTable(tableName);

    let records: Record<string, unknown>[] = [];
    if (tableExists) {
      records = await appDb(tableName).limit(200).select('*');
    }

    const visibleFields = fields.filter(f => f.ui_widget !== 'hidden');

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('admin/data/list', {
      title: `Data: ${table.label}`,
      table,
      fields,
      visibleFields,
      pkField,
      allTables,
      records,
      tableExists,
      flash
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/new — new record form ─────────────────────────────

dataRouter.get('/:tableName/new', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName } = req.params;

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    res.render('admin/data/form', {
      title: `New record — ${table.label}`,
      table,
      fields,
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

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    const appDb = getAppDb(app);
    const record = buildRecord(fields, req.body, { skipAutoIncrementPk: true });
    await appDb(tableName).insert(record);

    req.session.flash = { type: 'success', message: 'Record created.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /data/:tableName/:id/edit — edit record form ───────────────────────

dataRouter.get('/:tableName/:id/edit', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) {
      return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key defined' });
    }

    const appDb = getAppDb(app);
    const record = await appDb(tableName).where({ [pkField.field_name]: id }).first();
    if (!record) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Record not found' });
    }

    res.render('admin/data/form', {
      title: `Edit record — ${table.label}`,
      table,
      fields,
      record,
      errors: null
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /data/:tableName/:id/delete — delete record ──────────────────────

dataRouter.post('/:tableName/:id/delete', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { tableName, id } = req.params;

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) {
      return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key defined' });
    }

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

    const table = await controlDb('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .first();
    if (!table) {
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    }

    const fields: AppField[] = await controlDb('app_fields')
      .where({ table_id: table.id })
      .orderBy('sort_order');

    const pkField = fields.find(f => f.is_primary_key);
    if (!pkField) {
      return res.status(400).render('admin/error', { title: 'Error', message: 'Table has no primary key defined' });
    }

    const appDb = getAppDb(app);
    const updates = buildRecord(fields, req.body, { skipPk: true });
    await appDb(tableName).where({ [pkField.field_name]: id }).update(updates);

    req.session.flash = { type: 'success', message: 'Record updated.' };
    res.redirect(`/admin/data/${tableName}`);
  } catch (err) {
    next(err);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

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
    if (field.data_type === 'boolean') {
      record[field.field_name] = raw === 'on' || raw === '1' || raw === 'true' ? 1 : 0;
    } else if (raw === '' || raw === undefined || raw === null) {
      record[field.field_name] = null;
    } else {
      record[field.field_name] = raw;
    }
  }
  return record;
}
