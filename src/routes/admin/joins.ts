import { Router } from 'express';
import { z } from 'zod';
import type { App } from '../../domain/types';
import * as joinsService from '../../services/joins';
import * as tablesService from '../../services/tables';
import { db as controlDb } from '../../db/knex';
import { buildJoinQuery, parseColumnRefs } from '../../services/queryBuilder';

export const joinsRouter = Router();

const JoinSchema = z.object({
  left_table_id: z.coerce.number().int().positive(),
  left_field_name: z.string().min(1),
  right_table_id: z.coerce.number().int().positive(),
  right_field_name: z.string().min(1),
  join_type_default: z.enum(['inner', 'left', 'right']).optional(),
  relationship_label: z.string().optional().nullable()
});

// ── GET /joins ─────────────────────────────────────────────────────────────

joinsRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const [joins, tables] = await Promise.all([
      joinsService.listJoins(app.id),
      tablesService.listTables(app.id)
    ]);
    const tableMap = new Map(tables.map((t) => [t.id, t]));

    // Fetch all fields for every table in this app
    const allFields = tables.length > 0
      ? await controlDb('app_fields')
          .whereIn('table_id', tables.map(t => t.id))
          .orderBy('sort_order')
          .select('id', 'table_id', 'field_name', 'label', 'data_type', 'is_primary_key')
      : [];

    const tableFieldsMap: Record<number, typeof allFields> = {};
    for (const f of allFields) {
      (tableFieldsMap[f.table_id] ??= []).push(f);
    }

    // Load saved diagram positions
    const savedDiagram = app.diagram_json
      ? (JSON.parse(app.diagram_json) as Record<string, { x: number; y: number }>)
      : {};

    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/joins/list', {
      title: 'Joins',
      joins,
      tables,
      tableMap,
      tableFieldsMap,
      savedDiagram,
      flash
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /joins/new ─────────────────────────────────────────────────────────

joinsRouter.get('/new', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tables = await tablesService.listTables(app.id);
    res.render('admin/joins/form', { title: 'New Join', tables, join: null, errors: null });
  } catch (err) {
    next(err);
  }
});

// ── GET /joins/fields/:tableId — API: return field names for a table ────────

joinsRouter.get('/fields/:tableId', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const tableId = Number(req.params.tableId);

    const table = await controlDb('app_tables').where({ id: tableId, app_id: app.id }).first();
    if (!table) return res.status(404).json({ error: 'Table not found' });

    const fields = await controlDb('app_fields')
      .where({ table_id: tableId })
      .orderBy('sort_order')
      .select('field_name', 'label', 'data_type', 'is_primary_key');

    res.json(fields);
  } catch (err) {
    next(err);
  }
});

// ── POST /joins/diagram-positions — save dragged table positions ────────────

joinsRouter.post('/diagram-positions', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { positions } = req.body as { positions: Record<string, { x: number; y: number }> };
    await controlDb('apps').where({ id: app.id }).update({ diagram_json: JSON.stringify(positions) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /joins/preview — API: generate SQL for column references ────────────

joinsRouter.post('/preview', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const { from_table, columns } = req.body as { from_table: string; columns: string };

    if (!from_table || !columns?.trim()) {
      return res.json({ error: 'from_table and columns are required' });
    }

    const refs = parseColumnRefs(columns);
    if (refs.length === 0) {
      return res.json({ error: 'No valid table.field references found. Use format: table.field' });
    }

    const result = await buildJoinQuery(app.id, from_table, refs);
    res.json({ sql: result.sql, joins: result.joins });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ error: msg });
  }
});

// ── POST /joins ────────────────────────────────────────────────────────────

joinsRouter.post('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const isJson = req.headers.accept?.includes('application/json');
    const parsed = JoinSchema.safeParse(req.body);

    if (!parsed.success) {
      if (isJson) return res.json({ error: Object.values(parsed.error.flatten().fieldErrors).flat().join('; ') });
      const tables = await tablesService.listTables(app.id);
      return res.render('admin/joins/form', { title: 'New Join', tables, join: req.body, errors: parsed.error.flatten().fieldErrors });
    }

    await joinsService.createJoin({ app_id: app.id, ...parsed.data });

    if (isJson) return res.json({ ok: true });
    req.session.flash = { type: 'success', message: 'Join created.' };
    res.redirect('/admin/joins');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (req.headers.accept?.includes('application/json')) return res.json({ error: msg });
    next(err);
  }
});

// ── POST /joins/:id/delete ─────────────────────────────────────────────────

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
