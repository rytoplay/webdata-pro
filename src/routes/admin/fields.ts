import { Router } from 'express';
import { z } from 'zod';
import * as fieldsService from '../../services/fields';
import * as tablesService from '../../services/tables';

export const fieldsRouter = Router();

const DATA_TYPES = ['string', 'text', 'integer', 'bigInteger', 'decimal', 'float', 'boolean', 'date', 'datetime', 'time', 'json', 'uuid'] as const;
const UI_WIDGETS = ['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'datetime', 'email', 'url', 'password', 'hidden'] as const;

const FieldSchema = z.object({
  table_id: z.coerce.number().int().positive(),
  field_name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  data_type: z.enum(DATA_TYPES),
  is_required: z.coerce.boolean().optional(),
  is_primary_key: z.coerce.boolean().optional(),
  is_auto_increment: z.coerce.boolean().optional(),
  default_value: z.string().optional().nullable(),
  is_searchable_default: z.coerce.boolean().optional(),
  is_visible_default: z.coerce.boolean().optional(),
  ui_widget: z.enum(UI_WIDGETS).optional(),
  sort_order: z.coerce.number().int().optional()
});

fieldsRouter.get('/', async (req, res, next) => {
  try {
    const tableId = Number(req.query.table_id);
    if (!tableId) return res.redirect('/admin/tables');
    const [table, fields] = await Promise.all([
      tablesService.getTable(tableId),
      fieldsService.listFields(tableId)
    ]);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/fields/list', { title: `Fields: ${table.label}`, table, fields, flash });
  } catch (err) {
    next(err);
  }
});

fieldsRouter.get('/new', async (req, res, next) => {
  try {
    const tableId = Number(req.query.table_id);
    if (!tableId) return res.redirect('/admin/tables');
    const table = await tablesService.getTable(tableId);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    res.render('admin/fields/form', {
      title: 'New Field',
      table,
      field: null,
      errors: null,
      dataTypes: DATA_TYPES,
      uiWidgets: UI_WIDGETS
    });
  } catch (err) {
    next(err);
  }
});

fieldsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = FieldSchema.safeParse(req.body);
    const tableId = Number(req.body.table_id);
    if (!parsed.success) {
      const table = await tablesService.getTable(tableId);
      return res.render('admin/fields/form', {
        title: 'New Field',
        table,
        field: req.body,
        errors: parsed.error.flatten().fieldErrors,
        dataTypes: DATA_TYPES,
        uiWidgets: UI_WIDGETS
      });
    }
    await fieldsService.createField(parsed.data);
    req.session.flash = { type: 'success', message: 'Field created.' };
    res.redirect(`/admin/fields?table_id=${parsed.data.table_id}`);
  } catch (err) {
    next(err);
  }
});

fieldsRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const field = await fieldsService.getField(Number(req.params.id));
    if (!field) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Field not found' });
    await fieldsService.deleteField(field.id);
    req.session.flash = { type: 'success', message: `Field "${field.label}" deleted.` };
    res.redirect(`/admin/fields?table_id=${field.table_id}`);
  } catch (err) {
    next(err);
  }
});
