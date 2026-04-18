import { Router } from 'express';
import { z } from 'zod';
import type { App } from '../../domain/types';
import * as tablesService from '../../services/tables';
import { getAppDb } from '../../db/adapters/appDb';

export const tablesRouter = Router();

const TableBodySchema = z.object({
  table_name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'Must be lowercase letters, numbers, underscores'),
  label: z.string().min(1),
  description: z.string().optional(),
  is_public_addable: z.coerce.boolean().optional()
});

const EXCLUDED_TABLES = /^(knex_migrations|knex_migrations_lock|_wdpro_)/;

tablesRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await tablesService.listTables(app.id);

    // Detect physical tables in the app DB that aren't registered in app_tables
    let unregisteredTables: string[] = [];
    try {
      const appDb = getAppDb(app);
      const knownNames = new Set(tables.map((t: any) => t.table_name));

      if (app.database_mode === 'mysql') {
        const result = await appDb.raw('SHOW TABLES') as any[];
        const rows = Array.isArray(result[0]) ? result[0] : result;
        unregisteredTables = rows
          .map((r: any) => Object.values(r)[0] as string)
          .filter(name => !knownNames.has(name) && !EXCLUDED_TABLES.test(name));
      } else {
        const rows = await appDb.raw(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ) as any[];
        unregisteredTables = rows
          .map((r: any) => r.name as string)
          .filter(name => !knownNames.has(name) && !EXCLUDED_TABLES.test(name));
      }
    } catch { /* non-fatal — just skip the banner */ }

    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/tables/list', { title: 'Tables', tables, unregisteredTables, flash });
  } catch (err) {
    next(err);
  }
});

tablesRouter.post('/import', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const raw = req.body.table_name;
    const names: string[] = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);

    for (const name of names) {
      await tablesService.importExistingTable(app.id, name);
    }

    req.session.flash = {
      type: 'success',
      message: `${names.length} table${names.length !== 1 ? 's' : ''} imported.`
    };
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});

tablesRouter.get('/new', (_req, res) => {
  res.render('admin/tables/form', { title: 'New Table', table: null, errors: null });
});

tablesRouter.post('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const parsed = TableBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/tables/form', {
        title: 'New Table',
        table: req.body,
        errors: parsed.error.flatten().fieldErrors
      });
    }
    await tablesService.createTable({ app_id: app.id, ...parsed.data });
    req.session.flash = { type: 'success', message: 'Table created.' };
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});

tablesRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const table = await tablesService.getTableWithFields(Number(req.params.id));
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    res.render('admin/tables/form', { title: `Edit: ${table.label}`, table, errors: null });
  } catch (err) {
    next(err);
  }
});

tablesRouter.post('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = TableBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      const table = await tablesService.getTableWithFields(id);
      return res.render('admin/tables/form', {
        title: 'Edit Table',
        table: { ...table, ...req.body },
        errors: parsed.error.flatten().fieldErrors
      });
    }
    await tablesService.updateTable(id, parsed.data);
    req.session.flash = { type: 'success', message: 'Table updated.' };
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});

tablesRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const table = await tablesService.getTable(Number(req.params.id));
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    await tablesService.deleteTable(table.id);
    req.session.flash = { type: 'success', message: `Table "${table.label}" deleted.` };
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});
