import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { getAppDb } from '../../db/adapters/appDb';
import type { App } from '../../domain/types';
import * as membersService from '../../services/members';

export const membersRouter = Router();

const MemberSchema = z.object({
  email:      z.string().email(),
  username:   z.string().optional().nullable().transform(v => v || null),
  first_name: z.string().optional().nullable().transform(v => v || null),
  last_name:  z.string().optional().nullable().transform(v => v || null),
  phone:      z.string().optional().nullable().transform(v => v || null),
  is_active:  z.preprocess(v => v === 'on' || v === true || v === '1', z.boolean()).optional().default(true),
});

const NewMemberSchema = MemberSchema.extend({
  password:         z.string().min(8, 'Password must be at least 8 characters'),
  password_confirm: z.string(),
}).refine(d => d.password === d.password_confirm, {
  message: 'Passwords do not match',
  path: ['password_confirm'],
});

const PasswordSchema = z.object({
  password:         z.string().min(8, 'Password must be at least 8 characters'),
  password_confirm: z.string(),
}).refine(d => d.password === d.password_confirm, {
  message: 'Passwords do not match',
  path: ['password_confirm'],
});

// ── GET /admin/members ───────────────────────────────────────────────────────

membersRouter.get('/', async (req, res, next) => {
  try {
    const app     = res.locals.currentApp as App;
    const members = await membersService.listMembers(app.id);
    // Attach group names to each member
    const groups  = await db('groups').where({ app_id: app.id }).orderBy('group_name');
    const assigns = await db('member_group_assignments')
      .join('groups', 'groups.id', 'member_group_assignments.group_id')
      .where('groups.app_id', app.id)
      .select('member_group_assignments.member_id', 'groups.group_name');

    const groupsByMember: Record<number, string[]> = {};
    for (const a of assigns) {
      if (!groupsByMember[a.member_id]) groupsByMember[a.member_id] = [];
      groupsByMember[a.member_id].push(a.group_name);
    }

    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/members/list', { title: 'Members', members, groups, groupsByMember, flash });
  } catch (err) { next(err); }
});

// ── GET /admin/members/new ───────────────────────────────────────────────────

membersRouter.get('/new', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const groups = await db('groups').where({ app_id: app.id }).orderBy('group_name');
    res.render('admin/members/form', { title: 'New Member', member: null, groups, memberGroups: [], errors: null });
  } catch (err) { next(err); }
});

// ── POST /admin/members ──────────────────────────────────────────────────────

membersRouter.post('/', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const groups = await db('groups').where({ app_id: app.id }).orderBy('group_name');
    const parsed = NewMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/members/form', {
        title: 'New Member', member: req.body, groups, memberGroups: [],
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // Check for duplicate email
    const existing = await membersService.getMemberByEmail(app.id, parsed.data.email);
    if (existing) {
      return res.render('admin/members/form', {
        title: 'New Member', member: req.body, groups, memberGroups: [],
        errors: { email: ['A member with this email already exists'] },
      });
    }

    const { password_confirm: _, ...memberData } = parsed.data;
    const member = await membersService.createMember({ app_id: app.id, ...memberData });

    // Assign groups
    const selectedGroups: string[] = [].concat((req.body.group_ids as any) || []);
    for (const gid of selectedGroups) {
      await membersService.assignMemberToGroup(member.id, Number(gid));
    }

    req.session.flash = { type: 'success', message: 'Member created.' };
    res.redirect(`/admin/members/${member.id}/edit`);
  } catch (err) { next(err); }
});

// ── GET /admin/members/:id/edit ──────────────────────────────────────────────

membersRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const member = await membersService.getMember(Number(req.params.id));
    if (!member || member.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Member not found' });
    const [groups, memberGroupIds] = await Promise.all([
      db('groups').where({ app_id: app.id }).orderBy('group_name'),
      membersService.getMemberGroups(member.id),
    ]);
    const flash = req.session.flash; delete req.session.flash;
    res.render('admin/members/form', { title: `Edit — ${member.email}`, member, groups, memberGroups: memberGroupIds, errors: null, flash });
  } catch (err) { next(err); }
});

// ── POST /admin/members/:id/edit ─────────────────────────────────────────────

membersRouter.post('/:id/edit', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const member = await membersService.getMember(Number(req.params.id));
    if (!member || member.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Member not found' });

    const parsed = MemberSchema.safeParse(req.body);
    if (!parsed.success) {
      const [groups, memberGroupIds] = await Promise.all([
        db('groups').where({ app_id: app.id }).orderBy('group_name'),
        membersService.getMemberGroups(member.id),
      ]);
      return res.render('admin/members/form', {
        title: `Edit — ${member.email}`, member: { ...member, ...req.body },
        groups, memberGroups: memberGroupIds, errors: parsed.error.flatten().fieldErrors, flash: null,
      });
    }

    await membersService.updateMember(member.id, parsed.data);

    // Sync group assignments
    const selectedGroups: number[] = [].concat((req.body.group_ids as any) || []).map(Number);
    const currentGroups = await membersService.getMemberGroups(member.id);
    for (const gid of currentGroups) {
      if (!selectedGroups.includes(gid)) await membersService.removeMemberFromGroup(member.id, gid);
    }
    for (const gid of selectedGroups) {
      await membersService.assignMemberToGroup(member.id, gid);
    }

    req.session.flash = { type: 'success', message: 'Member saved.' };
    res.redirect(`/admin/members/${member.id}/edit`);
  } catch (err) { next(err); }
});

// ── POST /admin/members/:id/password ─────────────────────────────────────────

membersRouter.post('/:id/password', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const member = await membersService.getMember(Number(req.params.id));
    if (!member || member.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Member not found' });

    const parsed = PasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const [groups, memberGroupIds] = await Promise.all([
        db('groups').where({ app_id: app.id }).orderBy('group_name'),
        membersService.getMemberGroups(member.id),
      ]);
      return res.render('admin/members/form', {
        title: `Edit — ${member.email}`, member, groups, memberGroups: memberGroupIds,
        errors: parsed.error.flatten().fieldErrors, flash: null,
      });
    }

    await membersService.setPassword(member.id, parsed.data.password);
    req.session.flash = { type: 'success', message: 'Password updated.' };
    res.redirect(`/admin/members/${member.id}/edit`);
  } catch (err) { next(err); }
});

// ── GET /admin/members/:id/record-counts ─────────────────────────────────────
// Returns JSON: { tables: [{ table_name, label, count }] }

membersRouter.get('/:id/record-counts', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const member = await membersService.getMember(Number(req.params.id));
    if (!member || member.app_id !== app.id)
      return res.status(404).json({ error: 'Not found' });

    const appDb = getAppDb(app);
    const metaExists = await appDb.schema.hasTable('_wdpro_metadata');
    if (!metaExists) return res.json({ tables: [] });

    const rows = await appDb('_wdpro_metadata')
      .where({ created_by_id: member.id })
      .groupBy('table_name')
      .select('table_name')
      .count('* as count');

    if (!rows.length) return res.json({ tables: [] });

    // Attach human-readable labels from app_tables
    const tableNames = rows.map((r: any) => r.table_name);
    const appTables  = await db('app_tables')
      .where({ app_id: app.id })
      .whereIn('table_name', tableNames)
      .select('table_name', 'label');
    const labelMap = new Map(appTables.map((t: any) => [t.table_name, t.label]));

    const tables = rows.map((r: any) => ({
      table_name: r.table_name,
      label:      labelMap.get(r.table_name) || r.table_name,
      count:      Number(r.count),
    }));

    res.json({ tables });
  } catch (err) { next(err); }
});

// ── POST /admin/members/:id/delete ───────────────────────────────────────────

membersRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const app    = res.locals.currentApp as App;
    const member = await membersService.getMember(Number(req.params.id));
    if (!member || member.app_id !== app.id)
      return res.status(404).render('admin/error', { title: 'Not Found', message: 'Member not found' });

    const deleteRecords = req.body.delete_records === 'yes';
    const appDb = getAppDb(app);
    const metaExists = await appDb.schema.hasTable('_wdpro_metadata');

    if (metaExists) {
      if (deleteRecords) {
        // Delete the actual records from each app table, then remove metadata
        const metaRows = await appDb('_wdpro_metadata').where({ created_by_id: member.id });
        const byTable = new Map<string, string[]>();
        for (const row of metaRows) {
          if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
          byTable.get(row.table_name)!.push(row.record_id);
        }
        for (const [tableName, recordIds] of byTable) {
          const tableRecord = await db('app_tables').where({ app_id: app.id, table_name: tableName }).first();
          if (!tableRecord) continue;
          const pkField = await db('app_fields').where({ table_id: tableRecord.id, is_primary_key: true }).first();
          if (!pkField) continue;
          await appDb(tableName).whereIn(pkField.field_name, recordIds).delete();
        }
        await appDb('_wdpro_metadata').where({ created_by_id: member.id }).delete();
      } else {
        // Transfer ownership: clear created_by_id so records become unowned
        await appDb('_wdpro_metadata')
          .where({ created_by_id: member.id })
          .update({ created_by_id: null, created_by_name: 'Admin' });
      }
    }

    await membersService.deleteMember(member.id);
    req.session.flash = { type: 'success', message: `Member ${member.email} deleted.` };
    res.redirect('/admin/members');
  } catch (err) { next(err); }
});
