import { Router } from 'express';
import { z } from 'zod';
import * as appsService from '../../services/apps';
import { initializeSqliteDatabase } from '../../db/adapters/sqlite';
import type { DatabaseMode, SqliteConfig } from '../../domain/types';

export const appsRouter = Router();

// ── App selection (deselect must be defined before /:id) ──────────────────

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
  db_password: z.string().optional()
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
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
    password: data.db_password         || ''
  });
}

appsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = NewAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/apps/form', {
        title: 'New App',
        values: req.body,
        errors: parsed.error.flatten().fieldErrors
      });
    }

    const { data } = parsed;
    const slug = slugify(data.name);

    if (!slug) {
      return res.render('admin/apps/form', {
        title: 'New App',
        values: req.body,
        errors: { name: ['Could not generate a valid slug from this name'] }
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
