import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session.admin?.isAdmin) {
    res.locals.loginAt = req.session.admin.loginAt ?? 0;
    next();
    return;
  }
  req.session.flash = { type: 'warning', message: 'Please log in to access the admin panel.' };
  res.redirect('/admin/login');
}
