import { db } from '../db/knex';
import type { GroupTablePermission } from '../domain/types';

export interface EffectiveTablePermissions {
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_view: boolean;
  can_edit_all_records: boolean;
  can_edit_own_records_only: boolean;
  can_view_all_records: boolean;
  can_view_own_records_only: boolean;
}

// Merge permissions across multiple groups — any 'true' wins
export async function resolveTablePermissions(
  groupIds: number[],
  tableId: number
): Promise<EffectiveTablePermissions> {
  if (groupIds.length === 0) {
    return emptyPermissions();
  }

  const rows: GroupTablePermission[] = await db('group_table_permissions')
    .whereIn('group_id', groupIds)
    .where({ table_id: tableId });

  return rows.reduce<EffectiveTablePermissions>((acc, row) => {
    return {
      can_add: acc.can_add || row.can_add,
      can_edit: acc.can_edit || row.can_edit,
      can_delete: acc.can_delete || row.can_delete,
      can_view: acc.can_view || row.can_view,
      can_edit_all_records: acc.can_edit_all_records || row.can_edit_all_records,
      can_edit_own_records_only: acc.can_edit_own_records_only || row.can_edit_own_records_only,
      can_view_all_records: acc.can_view_all_records || row.can_view_all_records,
      can_view_own_records_only: acc.can_view_own_records_only || row.can_view_own_records_only
    };
  }, emptyPermissions());
}

function emptyPermissions(): EffectiveTablePermissions {
  return {
    can_add: false,
    can_edit: false,
    can_delete: false,
    can_view: false,
    can_edit_all_records: false,
    can_edit_own_records_only: false,
    can_view_all_records: false,
    can_view_own_records_only: false
  };
}
