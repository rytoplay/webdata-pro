import type { Request, Response, NextFunction } from 'express';
import type { App } from '../domain/types';

/**
 * Per-app CORS middleware for the public API.
 * Reads allowed_origins_json from the current app and sets headers accordingly.
 * Must run after the app is loaded into res.locals.apiApp.
 */
export function appCors(req: Request, res: Response, next: NextFunction) {
  const app = res.locals.apiApp as App | undefined;
  const origin = req.headers.origin;

  if (!origin) return next();

  const allowed: string[] = app?.allowed_origins_json
    ? (JSON.parse(app.allowed_origins_json) as string[])
    : [];

  // Wildcard '*' in the list = allow any origin (dev mode)
  const isAllowed = allowed.includes('*') || allowed.includes(origin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);

  next();
}
