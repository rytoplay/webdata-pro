import { Router } from 'express';
import { z } from 'zod';
import type { App } from '../../domain/types';
import * as tablesService from '../../services/tables';

export const tablesRouter = Router();

const TableBodySchema = z.object({
  table_name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'Must be lowercase letters, numbers, underscores'),
  label: z.string().min(1),
  description: z.string().optional(),
  is_public_addable: z.coerce.boolean().optional()
});

tablesRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await tablesService.listTables(app.id);
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/tables/list', { title: 'Tables', tables, flash });
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
