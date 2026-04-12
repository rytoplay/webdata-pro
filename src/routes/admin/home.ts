import { Router } from 'express';
import nunjucks from 'nunjucks';
import { db } from '../../db/knex';
import type { App } from '../../domain/types';

function renderHomeTemplate(template: string, app: App, member: object, views: object[]): string {
  try {
    return nunjucks.renderString(template, { app, member, views });
  } catch (err: any) {
    return `<p class="text-danger"><strong>Template error:</strong> ${err.message}</p>`;
  }
}

export const homeRouter = Router();

const DEFAULT_TEMPLATE = `<div style="max-width:640px; margin:0 auto; padding:2rem 1rem; font-family:sans-serif;">
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

// ── GET /admin/home/preview ───────────────────────────────────────────────────

homeRouter.get('/preview', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const fresh = await db('apps').where({ id: app.id }).first();
    // Render with dummy member context so the admin can see what it looks like
    const views = await db('views').where({ app_id: app.id }).orderBy('label')
      .then((rows: any[]) => rows.map(v => ({
        label: v.label, view_name: v.view_name,
        url: `/app/${app.slug}/view/${v.view_name}`,
      })));
    const dummyMember = { first_name: 'Preview', last_name: 'User', email: 'preview@example.com' };
    const renderedHtml = fresh.home_template
      ? renderHomeTemplate(fresh.home_template, fresh, dummyMember, views)
      : null;
    res.render('admin/home/preview', { title: 'Home Page Preview', app: fresh, views, member: dummyMember, renderedHtml });
  } catch (err) { next(err); }
});

// ── GET /admin/home ───────────────────────────────────────────────────────────

homeRouter.get('/', async (req, res, next) => {
  try {
    const app   = res.locals.currentApp as App;
    const fresh = await db('apps').where({ id: app.id }).first();
    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/home/editor', {
      title:    'Member Home Page',
      app:      fresh,
      defaultTemplate: DEFAULT_TEMPLATE,
      flash,
    });
  } catch (err) { next(err); }
});

// ── POST /admin/home ──────────────────────────────────────────────────────────

homeRouter.post('/', async (req, res, next) => {
  try {
    const app  = res.locals.currentApp as App;
    const { home_template } = req.body as { home_template: string };
    await db('apps').where({ id: app.id }).update({ home_template: home_template || null });
    req.session.flash = { type: 'success', message: 'Home page template saved.' };
    res.redirect('/admin/home');
  } catch (err) { next(err); }
});
