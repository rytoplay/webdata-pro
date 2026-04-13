import { Router } from 'express';
import { z } from 'zod';
import * as fieldsService from '../../services/fields';
import * as tablesService from '../../services/tables';
import type { FieldDataType, UIWidget } from '../../domain/types';

export const fieldsRouter = Router();

const DATA_TYPES = ['string', 'text', 'integer', 'bigInteger', 'decimal', 'float', 'boolean', 'date', 'datetime', 'time', 'json', 'uuid', 'image', 'upload'] as const;
const UI_WIDGETS = ['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'datetime', 'email', 'url', 'password', 'hidden', 'image', 'upload'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function fieldNameToLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Map the simple widget selector (text/select/textarea/checkbox) to a UIWidget,
 *  taking the field's data type into account for numeric fields. */
function resolveWidget(widget: string, dataType: string): UIWidget {
  if (widget === 'checkbox') return 'checkbox';
  if (widget === 'select')   return 'select';
  if (widget === 'textarea') return 'textarea';
  // "text" widget — use number input for numeric types
  if (['integer', 'bigInteger', 'decimal', 'float'].includes(dataType)) return 'number';
  if (dataType === 'date')     return 'date';
  if (dataType === 'datetime') return 'datetime';
  if (dataType === 'time')     return 'time';
  if (dataType === 'image')    return 'image';
  if (dataType === 'upload')   return 'upload';
  return 'text';
}

interface BatchRow {
  field_name?: string;
  label?: string;
  data_type?: string;
  widget?: string;
  is_required?: boolean | string;
  max_length?: string;
  options?: string;
  textarea_rows?: string;
  textarea_cols?: string;
}

// ── List fields ────────────────────────────────────────────────────────────

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

// ── New fields (batch entry form) ──────────────────────────────────────────

fieldsRouter.get('/new', async (req, res, next) => {
  try {
    const tableId = Number(req.query.table_id);
    if (!tableId) return res.redirect('/admin/tables');
    const [table, existingFields] = await Promise.all([
      tablesService.getTable(tableId),
      fieldsService.listFields(tableId)
    ]);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });
    res.render('admin/fields/form', {
      title: `Add Fields — ${table.label}`,
      table,
      existingFields,
      errors: null,
      dataTypes: DATA_TYPES
    });
  } catch (err) {
    next(err);
  }
});

// ── Batch create ───────────────────────────────────────────────────────────

fieldsRouter.post('/batch', async (req, res, next) => {
  try {
    const tableId = Number(req.body.table_id);
    const table = await tablesService.getTable(tableId);
    if (!table) return res.status(404).render('admin/error', { title: 'Not Found', message: 'Table not found' });

    let rows: BatchRow[] = [];
    try {
      rows = JSON.parse(req.body.rows_json || '[]');
    } catch {
      rows = [];
    }

    const fieldErrors: string[] = [];
    let created = 0;

    for (const row of rows) {
      const name = (row.field_name ?? '').trim();
      if (!name) continue;

      const dataType = (row.data_type ?? 'string') as FieldDataType;
      const widget   = row.widget ?? 'text';

      // Build ui_options_json
      let uiOptionsJson: string | null = null;
      if (widget === 'text' || widget === 'number') {
        const maxLen = Number(row.max_length);
        if (maxLen > 0) uiOptionsJson = JSON.stringify({ max_length: maxLen });
      } else if (widget === 'select') {
        const opts = (row.options ?? '').split('\n').map(s => s.trim()).filter(Boolean);
        if (opts.length > 0) uiOptionsJson = JSON.stringify({ options: opts });
      } else if (widget === 'textarea') {
        uiOptionsJson = JSON.stringify({
          rows: Number(row.textarea_rows) || 4,
          cols: Number(row.textarea_cols) || 60
        });
      }

      try {
        await fieldsService.createField({
          table_id: tableId,
          field_name: name,
          label: row.label?.trim() || fieldNameToLabel(name),
          data_type: dataType,
          is_required: Boolean(row.is_required),
          ui_widget: resolveWidget(widget, dataType),
          ui_options_json: uiOptionsJson
        });
        created++;
      } catch (err) {
        fieldErrors.push(`"${name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (fieldErrors.length === 0) {
      req.session.flash = {
        type: 'success',
        message: `${created} field${created !== 1 ? 's' : ''} added to ${table.label}.`
      };
      res.redirect(`/admin/fields?table_id=${tableId}`);
    } else {
      // Re-render with errors; preserve what was submitted
      const flash = fieldErrors.length > 0
        ? { type: 'danger' as const, message: `${created} field(s) added. Errors: ${fieldErrors.join('; ')}` }
        : null;
      req.session.flash = flash ?? undefined;
      res.redirect(`/admin/fields?table_id=${tableId}`);
    }
  } catch (err) {
    next(err);
  }
});

// ── Single-field create (legacy, kept for compatibility) ───────────────────

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

fieldsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = FieldSchema.safeParse(req.body);
    const tableId = Number(req.body.table_id);
    if (!parsed.success) {
      const table = await tablesService.getTable(tableId);
      return res.render('admin/fields/form', {
        title: 'Add Fields',
        table,
        errors: parsed.error.flatten().fieldErrors,
        dataTypes: DATA_TYPES
      });
    }
    await fieldsService.createField(parsed.data);
    req.session.flash = { type: 'success', message: 'Field created.' };
    res.redirect(`/admin/fields?table_id=${parsed.data.table_id}`);
  } catch (err) {
    next(err);
  }
});

// ── Reorder fields ────────────────────────────────────────────────────────

fieldsRouter.post('/reorder', async (req, res, next) => {
  try {
    const order: { id: number; sort_order: number }[] = req.body.order || [];
    await fieldsService.reorderFields(order);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Delete field ───────────────────────────────────────────────────────────

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
