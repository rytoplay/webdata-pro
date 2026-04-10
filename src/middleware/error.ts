import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  console.error(`[${req.method}] ${req.path}`, err);
  if (req.headers.accept?.includes('application/json')) {
    res.status(500).json({ error: err.message });
  } else {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
}
