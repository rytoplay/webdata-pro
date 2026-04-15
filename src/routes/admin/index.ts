import { Router } from 'express';
import { config } from '../../config';
import { requireAdmin } from '../../middleware/adminAuth';
import { loadCurrentApp, requireApp } from '../../middleware/currentApp';
import { listApps, updateApp } from '../../services/apps';
import { appsRouter } from './apps';
import { tablesRouter } from './tables';
import { fieldsRouter } from './fields';
import { joinsRouter } from './joins';
import { dataRouter } from './data';
import { viewsRouter } from './views';
import { settingsRouter } from './settings';
import { groupsRouter } from './groups';
import { membersRouter } from './members';
import { homeRouter } from './home';
import { blueprintRouter } from './blueprint';

export const adminRouter = Router();

// ── Public: login / logout ────────────────────────────────────────────────

adminRouter.get('/login', (req, res) => {
  if (req.session.admin?.isAdmin) return res.redirect('/admin');
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/login', { title: 'Sign in', flash });
});

adminRouter.post('/login', (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (username === config.admin.username && password === config.admin.password) {
    req.session.admin = { isAdmin: true, loginAt: Date.now() };
    res.redirect('/admin');
  } else {
    req.session.flash = { type: 'danger', message: 'Invalid credentials.' };
    res.redirect('/admin/login');
  }
});

adminRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── All routes below require admin + load current app ─────────────────────

adminRouter.use(requireAdmin, loadCurrentApp);

// ── App routes (select, deselect, new, create) ───────────────────────────

adminRouter.use('/apps', appsRouter);

// ── Dashboard ─────────────────────────────────────────────────────────────

adminRouter.get('/', async (req, res, next) => {
  try {
    const apps = await listApps();
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/index', { title: 'Dashboard', apps, flash });
  } catch (err) {
    next(err);
  }
});

// ── App-scoped sub-routers (require a selected app) ───────────────────────

adminRouter.use('/tables',    requireApp, tablesRouter);
adminRouter.use('/fields',    requireApp, fieldsRouter);
adminRouter.use('/joins',     requireApp, joinsRouter);
adminRouter.use('/data',      requireApp, dataRouter);
adminRouter.use('/views',     requireApp, viewsRouter);
adminRouter.use('/settings', settingsRouter);
adminRouter.get('/templates', requireApp, (_req, res) => res.render('admin/stub', { title: 'Templates' }));
adminRouter.use('/groups',    requireApp, groupsRouter);
adminRouter.use('/members',    requireApp, membersRouter);
adminRouter.use('/home',       requireApp, homeRouter);
adminRouter.use('/blueprint',  requireApp, blueprintRouter);
adminRouter.get('/auth',      requireApp, (_req, res) => res.render('admin/stub', { title: 'Auth / SSO' }));
adminRouter.get('/styleguide', (_req, res) => res.render('admin/styleguide', { title: 'CSS Style Guide' }));

// ── App Settings ──────────────────────────────────────────────────────────────

adminRouter.get('/app-settings', requireApp, (req, res) => {
  const app = res.locals.currentApp;
  const origins: string[] = app.allowed_origins_json
    ? (JSON.parse(app.allowed_origins_json) as string[])
    : [];
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/app-settings', {
    title: 'App Settings',
    originsText: origins.join('\n'),
    flash,
  });
});

adminRouter.post('/app-settings', requireApp, async (req, res, next) => {
  try {
    const app = res.locals.currentApp;
    const body = req.body as { allowed_origins?: string };
    const lines = (body.allowed_origins ?? '')
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    await updateApp(app.id, {
      allowed_origins_json: lines.length ? JSON.stringify(lines) : null,
    });
    req.session.flash = { type: 'success', message: 'App settings saved.' };
    res.redirect('/admin/app-settings');
  } catch (err) { next(err); }
});
