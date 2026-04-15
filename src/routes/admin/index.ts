import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { config } from '../../config';
import { requireAdmin } from '../../middleware/adminAuth';
import { loadCurrentApp, requireApp } from '../../middleware/currentApp';
import { listApps, updateApp } from '../../services/apps';
import { getAppDb } from '../../db/adapters/appDb';
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

// ── SQL Console ───────────────────────────────────────────────────────────────

function appendSqlLog(appSlug: string, query: string, outcome: string) {
  const line = `[${new Date().toISOString()}] [${appSlug}] ${outcome} | ${query.replace(/\s+/g, ' ').trim()}\n`;
  try { fs.appendFileSync('sql-console.log', line); } catch { /* non-fatal */ }
}

/** Normalise knex.raw() results across SQLite and MySQL into { rows, affected }. */
function normaliseResult(result: unknown, mode: string): {
  rows: Record<string, unknown>[] | null;
  columns: string[];
  affected: number | null;
} {
  if (mode === 'mysql') {
    if (Array.isArray(result)) {
      const [first] = result as unknown[];
      if (Array.isArray(first)) {
        const rows = first as Record<string, unknown>[];
        return { rows, columns: rows.length ? Object.keys(rows[0]) : [], affected: null };
      }
      const affected = (first as any)?.affectedRows ?? 0;
      return { rows: null, columns: [], affected };
    }
  }
  // SQLite (better-sqlite3): SELECT → array, DML/DDL → { changes, lastInsertRowid }
  if (Array.isArray(result)) {
    const rows = result as Record<string, unknown>[];
    return { rows, columns: rows.length ? Object.keys(rows[0]) : [], affected: null };
  }
  const affected = (result as any)?.changes ?? 0;
  return { rows: null, columns: [], affected };
}

adminRouter.get('/sql', requireApp, (req, res) => {
  if (!req.session.sqlCsrfToken) {
    req.session.sqlCsrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.render('admin/sql', { title: 'SQL Console', csrfToken: req.session.sqlCsrfToken });
});

adminRouter.post('/sql', requireApp, async (req, res, next) => {
  try {
    const { _csrf, query } = req.body as { _csrf?: string; query?: string };

    if (!_csrf || !req.session.sqlCsrfToken || _csrf !== req.session.sqlCsrfToken) {
      return res.status(403).render('admin/error', {
        title: 'Forbidden', message: 'Invalid CSRF token — please reload the page and try again.',
      });
    }
    // Rotate token so each submission gets a fresh one
    req.session.sqlCsrfToken = crypto.randomBytes(24).toString('hex');

    const sql = (query ?? '').trim();
    if (!sql) {
      return res.render('admin/sql', {
        title: 'SQL Console',
        csrfToken: req.session.sqlCsrfToken,
        query: sql,
        error: 'Enter a query first.',
      });
    }

    const app = res.locals.currentApp;
    const appDb = getAppDb(app);

    let renderVars: Record<string, unknown>;
    try {
      const raw = await appDb.raw(sql);
      const { rows, columns, affected } = normaliseResult(raw, app.database_mode);
      appendSqlLog(app.slug, sql, affected !== null ? `OK changes=${affected}` : `OK rows=${rows?.length ?? 0}`);
      renderVars = {
        title: 'SQL Console',
        csrfToken: req.session.sqlCsrfToken,
        query: sql,
        rows,
        columns,
        affected,
        rowCount: rows?.length ?? 0,
      };
    } catch (queryErr: unknown) {
      const errorMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
      appendSqlLog(app.slug, sql, `ERROR ${errorMsg}`);
      renderVars = {
        title: 'SQL Console',
        csrfToken: req.session.sqlCsrfToken,
        query: sql,
        error: errorMsg,
      };
    }

    res.render('admin/sql', renderVars);
  } catch (err) { next(err); }
});
