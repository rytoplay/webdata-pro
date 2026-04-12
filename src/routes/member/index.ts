import { Router } from 'express';
import nunjucks from 'nunjucks';
import { db } from '../../db/knex';
import * as membersService from '../../services/members';
import type { App } from '../../domain/types';

function renderHomeTemplate(template: string, app: App, member: object, views: object[]): string {
  try {
    return nunjucks.renderString(template, { app, member, views });
  } catch (err: any) {
    return `<p style="color:red"><strong>Template error:</strong> ${err.message}</p>`;
  }
}

export const memberRouter = Router({ mergeParams: true });

// ── Load app by slug ─────────────────────────────────────────────────────────

memberRouter.use(async (req, res, next) => {
  const { appSlug } = req.params as { appSlug: string };
  const app = await db('apps').where({ slug: appSlug }).first() as App | undefined;
  if (!app) return res.status(404).send('App not found');
  res.locals.memberApp = app;
  next();
});

// ── GET /app/:appSlug/ ───────────────────────────────────────────────────────

memberRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login`);
    }

    // Check if any of the member's groups has a default home view → redirect straight there
    if (member.groupIds.length > 0) {
      const groupWithHome = await db('groups')
        .whereIn('id', member.groupIds)
        .whereNotNull('default_home_view_id')
        .first();
      if (groupWithHome) {
        const homeView = await db('views').where({ id: groupWithHome.default_home_view_id }).first();
        if (homeView) return res.redirect(`/app/${app.slug}/view/${homeView.view_name}`);
      }
    }

    // Find views the member can access via their groups
    let views: any[] = [];
    if (member.groupIds.length > 0) {
      const rows = await db('views')
        .join('view_group_permissions', 'view_group_permissions.view_id', 'views.id')
        .whereIn('view_group_permissions.group_id', member.groupIds)
        .where('view_group_permissions.can_view', true)
        .where('views.app_id', app.id)
        .distinct('views.id', 'views.label', 'views.view_name')
        .orderBy('views.label');
      views = rows.map((v: any) => ({ ...v, url: `/app/${app.slug}/view/${v.view_name}` }));
    }

    // Use custom home template if set, otherwise generic list
    const freshApp = await db('apps').where({ id: app.id }).first();
    if (freshApp.home_template) {
      const memberData = await membersService.getMember(member.memberId);
      const html = renderHomeTemplate(freshApp.home_template, freshApp, memberData || member, views);
      return res.render('member/home', { title: app.name, app: freshApp, renderedHtml: html });
    }

    res.render('member/home', { title: app.name, app: freshApp, renderedHtml: null, views });
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/view/:viewName ─────────────────────────────────────────

memberRouter.get('/view/:viewName', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const view = await db('views').where({ app_id: app.id, view_name: req.params.viewName }).first();
    if (!view) return res.status(404).send('View not found');

    res.render('member/view', { title: `${view.label} — ${app.name}`, app, view });
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/login ──────────────────────────────────────────────────

memberRouter.get('/login', (req, res) => {
  const app = res.locals.memberApp as App;
  if (req.session.member?.appId === app.id) {
    return res.redirect(req.query.returnTo as string || '/');
  }
  const flash = req.session.flash; delete req.session.flash;
  res.render('member/login', {
    title: `Sign in — ${app.name}`,
    app,
    returnTo: req.query.returnTo || '',
    flash,
  });
});

// ── POST /app/:appSlug/login ─────────────────────────────────────────────────

memberRouter.post('/login', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const { email, password, returnTo } = req.body as { email: string; password: string; returnTo: string };

    const member = await membersService.getMemberByEmail(app.id, email);

    const invalid = () => res.render('member/login', {
      title: `Sign in — ${app.name}`,
      app,
      returnTo: returnTo || '',
      flash: { type: 'danger', message: 'Invalid email or password.' },
    });

    if (!member || !member.is_active) return invalid();

    const ok = await membersService.verifyPassword(member, password);
    if (!ok) return invalid();

    const groupIds = await membersService.getMemberGroups(member.id);
    req.session.member = { memberId: member.id, appId: app.id, groupIds };

    const dest = (returnTo && returnTo.startsWith('/')) ? returnTo : `/app/${app.slug}/`;
    res.redirect(dest);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/logout ─────────────────────────────────────────────────

memberRouter.get('/logout', (req, res) => {
  const app = res.locals.memberApp as App;
  delete req.session.member;
  res.redirect(`/app/${app.slug}/login`);
});
