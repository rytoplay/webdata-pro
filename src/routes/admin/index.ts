import { Router } from 'express';
import { config } from '../../config';
import { requireAdmin } from '../../middleware/adminAuth';
import { loadCurrentApp, requireApp } from '../../middleware/currentApp';
import { listApps } from '../../services/apps';
import { appsRouter } from './apps';
import { tablesRouter } from './tables';
import { fieldsRouter } from './fields';
import { joinsRouter } from './joins';
import { dataRouter } from './data';
import { viewsRouter } from './views';
import { settingsRouter } from './settings';
import { groupsRouter } from './groups';

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
    req.session.admin = { isAdmin: true };
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
adminRouter.get('/members',   requireApp, (_req, res) => res.render('admin/stub', { title: 'Members' }));
adminRouter.get('/auth',      requireApp, (_req, res) => res.render('admin/stub', { title: 'Auth / SSO' }));
