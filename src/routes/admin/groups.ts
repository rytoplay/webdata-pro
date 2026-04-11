import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import type { App } from '../../domain/types';
import * as groupsService from '../../services/groups';

export const groupsRouter = Router();

const GroupSchema = z.object({
  group_name:            z.string().min(1),
  description:           z.string().optional().nullable(),
  self_register_enabled: z.preprocess(v => v === 'on' || v === true, z.boolean()).optional(),
  default_home_view_id:  z.preprocess(v => v === '' || v == null ? null : Number(v), z.number().nullable()).optional(),
  tfa_required:          z.preprocess(v => v === 'on' || v === true, z.boolean()).optional(),
});

// ── GET /admin/groups ────────────────────────────────────────────────────────

groupsRouter.get('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const groups = await groupsService.listGroups(app.id);
    const flash  = req.session.flash; delete req.session.flash;
    res.render('admin/groups/list', { title: 'Groups', groups, flash });
  } catch (err) { next(err); }
});

// ── GET /admin/groups/new ────────────────────────────────────────────────────

groupsRouter.get('/new', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const views = await db('views').where({ app_id: app.id }).orderBy('label');
    res.render('admin/groups/form', { title: 'New Group', group: null, views, tablePerm: [], viewPerm: [], errors: null });
  } catch (err) { next(err); }
});

// ── POST /admin/groups ───────────────────────────────────────────────────────

groupsRouter.post('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const parsed = GroupSchema.safeParse(req.body);
    if (!parsed.success) {
      const views = await db('views').where({ app_id: app.id }).orderBy('label');
      return res.render('admin/groups/form', { title: 'New Group', group: req.body, views, tablePerm: [], viewPerm: [], errors: parsed.error.flatten().fieldErrors });
    }
    const group = await groupsService.createGroup({ app_id: app.id, ...parsed.data });
    req.session.flash = { type: 'success', message: 'Group created.' };
    res.redirect(`/admin/groups/${group.id}/edit`);
  } catch (err) { next(err); }
});

// ── GET /admin/groups/:id/edit ───────────────────────────────────────────────

groupsRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const group = await groupsService.getGroup(Number(req.params.id));
    if (!group || group.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Group not found' });
    const [views, tablePerm, viewPerm] = await Promise.all([
      db('views').where({ app_id: app.id }).orderBy('label'),
      groupsService.getTablePermGrid(app.id, group.id),
      groupsService.getViewPermGrid(app.id, group.id),
    ]);
    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/groups/form', { title: `Edit — ${group.group_name}`, group, views, tablePerm, viewPerm, errors: null, flash });
  } catch (err) { next(err); }
});

// ── POST /admin/groups/:id/edit ──────────────────────────────────────────────

groupsRouter.post('/:id/edit', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const group = await groupsService.getGroup(Number(req.params.id));
    if (!group || group.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Group not found' });

    const parsed = GroupSchema.safeParse(req.body);
    if (!parsed.success) {
      const [views, tablePerm, viewPerm] = await Promise.all([
        db('views').where({ app_id: app.id }).orderBy('label'),
        groupsService.getTablePermGrid(app.id, group.id),
        groupsService.getViewPermGrid(app.id, group.id),
      ]);
      return res.render('admin/groups/form', { title: `Edit — ${group.group_name}`, group: req.body, views, tablePerm, viewPerm, errors: parsed.error.flatten().fieldErrors, flash: null });
    }
    await groupsService.updateGroup(group.id, parsed.data);
    req.session.flash = { type: 'success', message: 'Group settings saved.' };
    res.redirect(`/admin/groups/${group.id}/edit`);
  } catch (err) { next(err); }
});

// ── POST /admin/groups/:id/permissions ───────────────────────────────────────

groupsRouter.post('/:id/permissions', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const group = await groupsService.getGroup(Number(req.params.id));
    if (!group || group.app_id !== app.id)
      return res.status(404).json({ error: 'Not found' });

    const body = req.body as Record<string, string[]>;

    // Table permissions — checkboxes come in as table_perm[<tableId>][<flag>]
    const allTables = await db('app_tables').where({ app_id: app.id });
    const tableRows = allTables.map((t: { id: number }) => {
      const flags = ['can_view','can_add','can_edit','can_delete',
                     'can_view_all_records','can_view_own_records_only',
                     'can_edit_all_records','can_edit_own_records_only'];
      const row: { table_id: number; [key: string]: boolean | number } = { table_id: t.id };
      for (const f of flags) row[f] = !!(body[`tp_${t.id}_${f}`]);
      return row;
    });
    await groupsService.saveTablePermGrid(group.id, tableRows);

    // View permissions
    const allViews = await db('views').where({ app_id: app.id });
    const viewRows = allViews.map((v: { id: number }) => ({
      view_id:                     v.id,
      can_view:                    !!(body[`vp_${v.id}_can_view`]),
      can_search_all_records:      !!(body[`vp_${v.id}_can_search_all_records`]),
      can_search_own_records_only: !!(body[`vp_${v.id}_can_search_own_records_only`]),
    }));
    await groupsService.saveViewPermGrid(group.id, viewRows);

    req.session.flash = { type: 'success', message: 'Permissions saved.' };
    res.redirect(`/admin/groups/${group.id}/edit`);
  } catch (err) { next(err); }
});

// ── POST /admin/groups/:id/delete ────────────────────────────────────────────

groupsRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const group = await groupsService.getGroup(Number(req.params.id));
    if (!group || group.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Group not found' });
    await groupsService.deleteGroup(group.id);
    req.session.flash = { type: 'success', message: 'Group deleted.' };
    res.redirect('/admin/groups');
  } catch (err) { next(err); }
});
