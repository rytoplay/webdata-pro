/**
 * Permission-checked file serving route.
 *
 * GET /files/:appSlug/:tableName/:fieldName/:filename
 *   ?thumb=1  → serve the 100px thumbnail instead of the original
 *
 * Access rules (first match wins):
 *   1. Admin session  → allow
 *   2. Any public view for this app uses this table → allow
 *   3. Logged-in member whose group has can_view on a view of this table → allow
 *   4. 403
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../db/knex';
import { UPLOADS_DIR } from '../services/uploads';
import type { App } from '../domain/types';

export const filesRouter = Router();

filesRouter.get('/:appSlug/:tableName/:fieldName/:filename', async (req, res) => {
  const { appSlug, tableName, fieldName, filename } = req.params;
  const wantThumb = req.query['thumb'] === '1';

  // ── 1. Validate path components (no traversal) ───────────────────────────
  const safeSegment = /^[a-zA-Z0-9_\-]+$/;
  const safeFile    = /^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/;
  if (
    !safeSegment.test(appSlug) ||
    !safeSegment.test(tableName) ||
    !safeSegment.test(fieldName) ||
    !safeFile.test(filename)
  ) {
    return res.status(400).send('Invalid file path');
  }

  // ── 2. Resolve actual file path ──────────────────────────────────────────
  let serveFilename = filename;
  if (wantThumb) {
    // insert _thumb before final extension: uuid.jpg → uuid_thumb.jpg
    serveFilename = filename.replace(/(\.[^.]+)$/, '_thumb$1');
  }

  const filePath = path.join(UPLOADS_DIR, appSlug, tableName, fieldName, serveFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  // ── 3. Load app ───────────────────────────────────────────────────────────
  const app = await db('apps').where({ slug: appSlug }).first() as App | undefined;
  if (!app) return res.status(404).send('App not found');

  // ── 4. Admin bypass ───────────────────────────────────────────────────────
  if ((req.session as any)?.admin?.isAdmin === true) {
    return serveFile(res, filePath);
  }

  // ── 5. Find the table record ──────────────────────────────────────────────
  const table = await db('app_tables')
    .where({ app_id: app.id, table_name: tableName })
    .first();

  if (table) {
    // ── 6. Any public view of this table → allow ─────────────────────────
    const publicView = await db('views')
      .where({ app_id: app.id, base_table_id: table.id, is_public: true })
      .first();
    if (publicView) return serveFile(res, filePath);

    // ── 7. Member session with can_view on any view of this table → allow ──
    const memberSession = (req.session as any)?.member;
    if (
      memberSession?.appId === app.id &&
      Array.isArray(memberSession.groupIds) &&
      memberSession.groupIds.length > 0
    ) {
      const memberView = await db('views')
        .join('view_group_permissions', 'view_group_permissions.view_id', 'views.id')
        .where('views.app_id', app.id)
        .where('views.base_table_id', table.id)
        .whereIn('view_group_permissions.group_id', memberSession.groupIds)
        .where('view_group_permissions.can_view', true)
        .first();
      if (memberView) return serveFile(res, filePath);
    }
  }

  return res.status(403).send('Access denied');
});

function serveFile(res: import('express').Response, filePath: string): void {
  res.sendFile(filePath);
}
