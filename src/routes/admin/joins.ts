import { Router } from 'express';
import { z } from 'zod';
import type { App } from '../../domain/types';
import * as joinsService from '../../services/joins';
import * as tablesService from '../../services/tables';

export const joinsRouter = Router();

const JoinSchema = z.object({
  left_table_id: z.coerce.number().int().positive(),
  left_field_name: z.string().min(1),
  right_table_id: z.coerce.number().int().positive(),
  right_field_name: z.string().min(1),
  join_type_default: z.enum(['inner', 'left', 'right']).optional(),
  relationship_label: z.string().optional().nullable()
});

joinsRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const [joins, tables] = await Promise.all([
      joinsService.listJoins(app.id),
      tablesService.listTables(app.id)
    ]);
    const tableMap = new Map(tables.map((t) => [t.id, t]));
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/joins/list', { title: 'Joins', joins, tableMap, flash });
  } catch (err) {
    next(err);
  }
});

joinsRouter.get('/new', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await tablesService.listTables(app.id);
    res.render('admin/joins/form', { title: 'New Join', tables, join: null, errors: null });
  } catch (err) {
    next(err);
  }
});

joinsRouter.post('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const parsed = JoinSchema.safeParse(req.body);
    if (!parsed.success) {
      const tables = await tablesService.listTables(app.id);
      return res.render('admin/joins/form', {
        title: 'New Join',
        tables,
        join: req.body,
        errors: parsed.error.flatten().fieldErrors
      });
    }
    await joinsService.createJoin({ app_id: app.id, ...parsed.data });
    req.session.flash = { type: 'success', message: 'Join created.' };
    res.redirect('/admin/joins');
  } catch (err) {
    next(err);
  }
});

joinsRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const join = await joinsService.getJoin(Number(req.params.id));
    if (!join) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Join not found' });
    await joinsService.deleteJoin(join.id);
    req.session.flash = { type: 'success', message: 'Join deleted.' };
    res.redirect('/admin/joins');
  } catch (err) {
    next(err);
  }
});
