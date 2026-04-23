import express, { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
import nunjucks from 'nunjucks';
import path from 'path';
import { config } from './config';
import { adminRouter } from './routes/admin';
import { apiViewsRouter } from './routes/api/views';
import { memberRouter } from './routes/member';
import { filesRouter } from './routes/files';

const SqliteSessionStore = SQLiteStore(session);

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const sessionDir = process.env.DATA_DIR ?? './';
  app.use(
    session({
      store: new SqliteSessionStore({ db: 'sessions.sqlite', dir: sessionDir }),
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: config.session.maxAge, httpOnly: true }
    })
  );

  nunjucks.configure(path.join(__dirname, 'views'), {
    autoescape: true,
    express: app,
    watch: config.env === 'development'
  });
  app.set('view engine', 'njk');

  app.use('/static', express.static(path.join(__dirname, '../public')));
  app.use('/files', filesRouter);

  // CORS is handled per-app by the appCors middleware in src/routes/api/views.ts.
  // Allowed origins are configured per-app via Admin → App Settings.

  app.use('/admin', adminRouter);
  app.use('/api/v/:appSlug', apiViewsRouter);
  app.use('/app/:appSlug', memberRouter);

  app.get('/', (_req, res) => res.redirect('/admin'));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack);
    res.status(500).render('admin/error', { title: 'Error', message: err.message });
  });

  return app;
}
