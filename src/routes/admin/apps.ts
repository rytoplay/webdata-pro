import { Router } from 'express';
import { z } from 'zod';
import * as appsService from '../../services/apps';
import { initializeSqliteDatabase } from '../../db/adapters/sqlite';
import { releaseAppDb, ensureMysqlDatabase } from '../../db/adapters/appDb';
import type { DatabaseMode, SqliteConfig } from '../../domain/types';

export const appsRouter = Router();

// ── App selection (deselect must be defined before /:id) ──────────────────

appsRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Clear session if this was the active app
    if (req.session.currentAppId === id) delete req.session.currentAppId;
    releaseAppDb(id);
    await appsService.deleteApp(id);
    req.session.flash = { type: 'success', message: 'App deleted.' };
    res.redirect('/admin');
  } catch (err) { next(err); }
});

// ── Update DB connection config ───────────────────────────────────────────

const DbConfigSchema = z.object({
  db_host:     z.string().optional(),
  db_port:     z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  db_name:     z.string().optional(),
  db_username: z.string().optional(),
  db_password: z.string().optional(),
});

appsRouter.post('/:id/db-config', async (req, res, next) => {
  try {
    const app = await appsService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('admin/error', { title: 'Not Found', message: 'App not found' });
    if (app.database_mode === 'sqlite') {
      req.session.flash = { type: 'warning', message: 'SQLite apps do not have a remote DB config.' };
      return res.redirect('/admin/app-settings');
    }
    const parsed = DbConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      req.session.flash = { type: 'danger', message: 'Invalid database config.' };
      return res.redirect('/admin/app-settings');
    }
    const { data } = parsed;
    const existing = JSON.parse(app.database_config_json || '{}');
    const updated = {
      ...existing,
      host:     data.db_host?.trim()     || existing.host     || 'localhost',
      port:     data.db_port             ?? existing.port,
      database: data.db_name?.trim()     || existing.database || '',
      username: data.db_username?.trim() || existing.username || '',
      password: data.db_password !== undefined ? data.db_password : existing.password,
    };
    await appsService.updateApp(app.id, { database_config_json: JSON.stringify(updated) });
    releaseAppDb(app.id);  // flush cached connection so next request uses new credentials
    req.session.flash = { type: 'success', message: 'Database connection updated.' };
    res.redirect('/admin/app-settings');
  } catch (err) { next(err); }
});

appsRouter.post('/deselect', (req, res) => {
  delete req.session.currentAppId;
  res.redirect('/admin');
});

appsRouter.post('/:id/select', async (req, res, next) => {
  try {
    const app = await appsService.getApp(Number(req.params.id));
    if (!app) return res.redirect('/admin');
    req.session.currentAppId = app.id;
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});

// ── New / create app ──────────────────────────────────────────────────────

appsRouter.get('/new', (_req, res) => {
  res.render('admin/apps/form', { title: 'New App', values: null, errors: null });
});

const NewAppSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(100, 'Must be 100 characters or fewer').optional(),
  database_mode: z.enum(['sqlite', 'mysql', 'postgres']),
  sqlite_path: z.string().optional(),
  db_host: z.string().optional(),
  db_port: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  db_name: z.string().optional(),
  db_username: z.string().optional(),
  db_password: z.string().optional(),
  _db_password_relay: z.string().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

function resolvedPassword(data: z.infer<typeof NewAppSchema>): string {
  // db_password is the live typed value; _db_password_relay carries it through
  // server-side re-renders where browsers won't repopulate password inputs
  return data.db_password || data._db_password_relay || '';
}

function buildConfig(data: z.infer<typeof NewAppSchema>): string {
  if (data.database_mode === 'sqlite') {
    return JSON.stringify({ path: data.sqlite_path?.trim() || './data.sqlite' });
  }
  return JSON.stringify({
    host:     data.db_host?.trim()     || 'localhost',
    port:     data.db_port             ?? (data.database_mode === 'mysql' ? 3306 : 5432),
    database: data.db_name?.trim()     || '',
    username: data.db_username?.trim() || '',
    password: resolvedPassword(data)
  });
}

appsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = NewAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/apps/form', {
        title: 'New App',
        values: req.body,
        errors: parsed.error.flatten().fieldErrors,
        existingDbWarning: null,
      });
    }

    const { data } = parsed;

    // For remote databases, ensure the DB exists — prompt if it has existing tables
    if (data.database_mode !== 'sqlite' && data.db_name?.trim()) {
      const confirmExisting = req.body.confirm_existing === 'true';
      if (!confirmExisting) {
        try {
          const check = await ensureMysqlDatabase({
            host:     data.db_host,
            port:     data.db_port,
            database: data.db_name,
            username: data.db_username,
            password: resolvedPassword(data),
          });
          if (check.existingTables.length > 0) {
            return res.render('admin/apps/form', {
              title: 'New App',
              values: req.body,
              errors: null,
              existingDbWarning: {
                dbName:    data.db_name,
                tableCount: check.existingTables.length,
              },
            });
          }
          // Database was created or is empty — fall through to createApp
        } catch (dbErr: any) {
          return res.render('admin/apps/form', {
            title: 'New App',
            values: req.body,
            errors: { db_name: [`Could not connect to database: ${dbErr.message}`] },
            existingDbWarning: null,
          });
        }
      }
    }

    const slug = slugify(data.name);

    if (!slug) {
      return res.render('admin/apps/form', {
        title: 'New App',
        values: req.body,
        errors: { name: ['Could not generate a valid slug from this name'] },
        existingDbWarning: null,
      });
    }

    const app = await appsService.createApp({
      name: data.name,
      slug,
      description: data.description || null,
      database_mode: data.database_mode as DatabaseMode,
      database_config_json: buildConfig(data)
    });

    if (data.database_mode === 'sqlite') {
      const cfg = JSON.parse(app.database_config_json!) as SqliteConfig;
      initializeSqliteDatabase(cfg.path);
    }

    req.session.currentAppId = app.id;
    req.session.flash = { type: 'success', message: `App "${app.name}" created. Now let's build your tables.` };
    res.redirect('/admin/tables');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return res.render('admin/apps/form', {
        title: 'New App',
        values: req.body,
        errors: { name: ['An app with a similar name already exists'] }
      });
    }
    next(err);
  }
});
