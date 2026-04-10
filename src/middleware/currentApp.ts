import { Request, Response, NextFunction } from 'express';
import { getApp } from '../services/apps';

export async function loadCurrentApp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const appId = req.session.currentAppId;
  if (appId) {
    try {
      const app = await getApp(appId);
      if (app) {
        res.locals.currentApp = app;
      } else {
        delete req.session.currentAppId;
      }
    } catch {
      delete req.session.currentAppId;
    }
  }
  next();
}

export function requireApp(req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.currentApp) {
    req.session.flash = { type: 'warning', message: 'Please select an app to continue.' };
    res.redirect('/admin');
    return;
  }
  next();
}
