import { Router } from 'express';
import { z } from 'zod';
import nunjucks from 'nunjucks';
import { db } from '../../db/knex';
import type { App } from '../../domain/types';
import * as groupsService from '../../services/groups';

export const groupsRouter = Router();

const DEFAULT_HOME_TEMPLATE = `<div style="max-width:640px; margin:0 auto; padding:2rem 1rem; font-family:sans-serif;">
  <h2>Welcome{% if member.first_name %}, {{ member.first_name }}{% endif %}!</h2>
  <p>You are signed in to <strong>{{ app.name }}</strong>.</p>

  {% if views.length %}
  <h5 style="margin-top:2rem;">Your views</h5>
  <ul>
    {% for v in views %}
    <li><a href="{{ v.url }}">{{ v.label }}</a></li>
    {% endfor %}
  </ul>
  {% endif %}
</div>`;

const GroupSchema = z.object({
  group_name:            z.string().min(1),
  description:           z.string().optional().nullable(),
  self_register_enabled: z.preprocess(v => v === 'on' || v === true, z.boolean()),
  default_home_view_id:  z.preprocess(v => v === '' || v == null ? null : Number(v), z.number().nullable()).optional(),
  tfa_required:          z.preprocess(v => v === 'on' || v === true, z.boolean()),
  home_template:         z.string().optional().nullable(),
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
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.render('admin/groups/form', { title: `Edit — ${group.group_name}`, group, views, tablePerm, viewPerm, errors: null, flash, baseUrl, defaultTemplate: DEFAULT_HOME_TEMPLATE });
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

    const body = req.body as Record<string, string>;

    // Table permissions
    const allTables = await db('app_tables').where({ app_id: app.id });
    const tableRows = allTables.map((t: { id: number }) => ({
      table_id:   t.id,
      can_add:    !!(body[`tp_${t.id}_can_add`]),
      can_edit:   !!(body[`tp_${t.id}_can_edit`]),
      can_delete: !!(body[`tp_${t.id}_can_delete`]),
      manage_all: !!(body[`tp_${t.id}_manage_all`]),
    }));
    await groupsService.saveTablePermGrid(group.id, tableRows);

    // View permissions
    const allViews = await db('views').where({ app_id: app.id });
    const viewRows = allViews.map((v: { id: number }) => ({
      view_id:              v.id,
      can_view:             !!(body[`vp_${v.id}_can_view`]),
      limit_to_own_records: !!(body[`vp_${v.id}_limit_to_own_records`]),
    }));
    await groupsService.saveViewPermGrid(group.id, viewRows);

    req.session.flash = { type: 'success', message: 'Permissions saved.' };
    res.redirect(`/admin/groups/${group.id}/edit`);
  } catch (err) { next(err); }
});

// ── GET /admin/groups/:id/preview-home ───────────────────────────────────────

groupsRouter.get('/:id/preview-home', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const group = await groupsService.getGroup(Number(req.params.id));
    if (!group || group.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Group not found' });

    const template = group.home_template || DEFAULT_HOME_TEMPLATE;
    const views = await db('views').where({ app_id: app.id }).orderBy('label')
      .then((rows: any[]) => rows.map((v: any) => ({
        label: v.label, view_name: v.view_name,
        url: `/app/${app.slug}/view/${v.view_name}`,
      })));
    const dummyMember = { first_name: 'Preview', last_name: 'User', email: 'preview@example.com' };

    let renderedHtml: string;
    try {
      renderedHtml = nunjucks.renderString(template, { app, member: dummyMember, views });
    } catch (err: any) {
      renderedHtml = `<p class="text-danger"><strong>Template error:</strong> ${err.message}</p>`;
    }

    res.render('admin/home/preview', {
      title: `Preview — ${group.group_name} Home`,
      app, views, member: dummyMember, renderedHtml,
      backUrl: `/admin/groups/${group.id}/edit`,
    });
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
