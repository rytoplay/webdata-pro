import { db } from '../db/knex';
import type { Group, CreateGroupInput, UpdateGroupInput, GroupTablePermission, UpsertGroupTablePermissionInput } from '../domain/types';

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
      can_add: false,
      can_edit: false,
      can_delete: false,
      can_view: false,
      can_edit_all_records: false,
      can_edit_own_records_only: false,
      can_view_all_records: false,
      can_view_own_records_only: false,
      ...input
    });
  }
}
