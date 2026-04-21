import { db } from '../db/knex';
import type { Group, CreateGroupInput, UpdateGroupInput, GroupTablePermission, UpsertGroupTablePermissionInput } from '../domain/types';

// ── Row types for permission grids ───────────────────────────────────────────

export interface TablePermRow {
  table_id: number;
  table_name: string;
  label: string;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  manage_all: boolean;
  single_record: boolean;
}

export interface ViewPermRow {
  view_id: number;
  view_name: string;
  label: string;
  can_view: boolean;
  limit_to_own_records: boolean;
}

export async function listGroups(appId: number): Promise<Group[]> {
  return db('groups').where({ app_id: appId }).orderBy('group_name');
}

export async function getGroup(id: number): Promise<Group | undefined> {
  return db('groups').where({ id }).first();
}

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const [id] = await db('groups').insert({
    app_id: input.app_id,
    group_name: input.group_name,
    description: input.description ?? null,
    self_register_enabled: input.self_register_enabled ?? false,
    default_home_view_id: input.default_home_view_id ?? null,
    tfa_required: input.tfa_required ?? false
  });
  return db('groups').where({ id }).first() as Promise<Group>;
}

export async function updateGroup(id: number, input: UpdateGroupInput): Promise<Group | undefined> {
  await db('groups').where({ id }).update(input);
  return getGroup(id);
}

export async function deleteGroup(id: number): Promise<void> {
  await db('groups').where({ id }).delete();
}

export async function getTablePermissions(groupId: number): Promise<GroupTablePermission[]> {
  return db('group_table_permissions').where({ group_id: groupId });
}

export async function upsertTablePermission(input: UpsertGroupTablePermissionInput): Promise<void> {
  const existing = await db('group_table_permissions')
    .where({ group_id: input.group_id, table_id: input.table_id })
    .first();

  if (existing) {
    await db('group_table_permissions')
      .where({ group_id: input.group_id, table_id: input.table_id })
      .update(input);
  } else {
    await db('group_table_permissions').insert({
      can_add: false, can_edit: false, can_delete: false, manage_all: false,
      ...input
    });
  }
}

// ── Permission grid helpers ──────────────────────────────────────────────────

/** All tables for an app merged with this group's current permissions */
export async function getTablePermGrid(appId: number, groupId: number): Promise<TablePermRow[]> {
  const tables = await db('app_tables').where({ app_id: appId }).orderBy('table_name');
  const perms  = await db('group_table_permissions').where({ group_id: groupId });
  const pm     = new Map(perms.map((p: { table_id: number }) => [p.table_id, p]));
  return tables.map((t: { id: number; table_name: string; label: string }) => {
    const p = (pm.get(t.id) ?? {}) as Partial<GroupTablePermission>;
    return {
      table_id: t.id, table_name: t.table_name, label: t.label || t.table_name,
      can_add:       p.can_add       ?? false,
      can_edit:      p.can_edit      ?? false,
      can_delete:    p.can_delete    ?? false,
      manage_all:    p.manage_all    ?? false,
      single_record: p.single_record ?? false,
    };
  });
}

/** Save an entire table-permission grid for a group (replaces all rows) */
export async function saveTablePermGrid(
  groupId: number,
  rows: { table_id: number; can_add: boolean; can_edit: boolean; can_delete: boolean; manage_all: boolean; single_record: boolean }[]
): Promise<void> {
  for (const row of rows) {
    await upsertTablePermission({
      group_id:      groupId,
      table_id:      row.table_id,
      can_add:       row.can_add,
      can_edit:      row.can_edit,
      can_delete:    row.can_delete,
      manage_all:    row.manage_all,
      single_record: row.single_record,
    });
  }
}

/** All views for an app merged with this group's current view permissions */
export async function getViewPermGrid(appId: number, groupId: number): Promise<ViewPermRow[]> {
  const views = await db('views').where({ app_id: appId }).orderBy('label');
  const perms = await db('view_group_permissions').where({ group_id: groupId });
  const pm    = new Map(perms.map((p: { view_id: number }) => [p.view_id, p]));
  return views.map((v: { id: number; view_name: string; label: string }) => {
    const p = (pm.get(v.id) ?? {}) as { can_view?: boolean; limit_to_own_records?: boolean };
    return {
      view_id: v.id, view_name: v.view_name, label: v.label || v.view_name,
      can_view:             p.can_view             ?? false,
      limit_to_own_records: p.limit_to_own_records ?? false,
    };
  });
}

/** Save the view-permission grid for a group */
export async function saveViewPermGrid(
  groupId: number,
  rows: { view_id: number; can_view: boolean; limit_to_own_records: boolean }[]
): Promise<void> {
  for (const row of rows) {
    const existing = await db('view_group_permissions')
      .where({ group_id: groupId, view_id: row.view_id }).first();
    const data = {
      group_id: groupId,
      view_id:  row.view_id,
      can_view:             !!row.can_view,
      limit_to_own_records: !!row.limit_to_own_records,
    };
    if (existing) await db('view_group_permissions').where({ id: existing.id }).update(data);
    else           await db('view_group_permissions').insert(data);
  }
}
