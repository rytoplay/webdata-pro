import { db } from '../db/knex';
import type { GroupTablePermission } from '../domain/types';

export interface EffectiveTablePermissions {
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  manage_all: boolean;
}

// Merge permissions across multiple groups — any 'true' wins
export async function resolveTablePermissions(
  groupIds: number[],
  tableId: number
): Promise<EffectiveTablePermissions> {
  if (groupIds.length === 0) return emptyPermissions();

  const rows: GroupTablePermission[] = await db('group_table_permissions')
    .whereIn('group_id', groupIds)
    .where({ table_id: tableId });

  return rows.reduce<EffectiveTablePermissions>((acc, row) => ({
    can_add:    acc.can_add    || !!row.can_add,
    can_edit:   acc.can_edit   || !!row.can_edit,
    can_delete: acc.can_delete || !!row.can_delete,
    manage_all: acc.manage_all || !!row.manage_all,
  }), emptyPermissions());
}

function emptyPermissions(): EffectiveTablePermissions {
  return { can_add: false, can_edit: false, can_delete: false, manage_all: false };
}
