import { db } from '../db/knex';
import type { AppJoin, CreateJoinInput, UpdateJoinInput } from '../domain/types';

export async function listJoins(appId: number): Promise<AppJoin[]> {
  return db('app_joins').where({ app_id: appId });
}

export async function getJoin(id: number): Promise<AppJoin | undefined> {
  return db('app_joins').where({ id }).first();
}

export async function createJoin(input: CreateJoinInput): Promise<AppJoin> {
  if (input.left_table_id === input.right_table_id) {
    throw new Error('Self-joins are not supported');
  }

  // Prevent duplicate join paths
  const existing = await db('app_joins')
    .where({
      app_id: input.app_id,
      left_table_id: input.left_table_id,
      left_field_name: input.left_field_name,
      right_table_id: input.right_table_id,
      right_field_name: input.right_field_name
    })
    .first();
  if (existing) {
    throw new Error('A join with these tables and fields already exists');
  }

  const [id] = await db('app_joins').insert({
    app_id: input.app_id,
    left_table_id: input.left_table_id,
    left_field_name: input.left_field_name,
    right_table_id: input.right_table_id,
    right_field_name: input.right_field_name,
    join_type_default: input.join_type_default ?? 'left',
    relationship_label: input.relationship_label ?? null
  });
  return db('app_joins').where({ id }).first() as Promise<AppJoin>;
}

export async function updateJoin(id: number, input: UpdateJoinInput): Promise<AppJoin | undefined> {
  await db('app_joins').where({ id }).update(input);
  return getJoin(id);
}

export async function deleteJoin(id: number): Promise<void> {
  await db('app_joins').where({ id }).delete();
}

// Returns adjacency map: tableId -> [connected tableIds]
export async function buildJoinGraph(appId: number): Promise<Map<number, number[]>> {
  const joins = await listJoins(appId);
  const graph = new Map<number, number[]>();

  for (const join of joins) {
    if (!graph.has(join.left_table_id)) graph.set(join.left_table_id, []);
    if (!graph.has(join.right_table_id)) graph.set(join.right_table_id, []);
    graph.get(join.left_table_id)!.push(join.right_table_id);
    graph.get(join.right_table_id)!.push(join.left_table_id);
  }

  return graph;
}

// After inserting a parent record, cascade inserts into any joined tables whose fields
// were submitted in the form using the "joinedTableName__fieldName" naming convention.
// The FK field pointing back to the parent is automatically set to newId.
export async function cascadeInsertJoinedRecords(
  appDb: any,
  appId: number,
  baseTableId: number,
  newId: number,
  body: Record<string, unknown>,
): Promise<void> {
  // Find all joins involving the base table
  const joins = await db('app_joins')
    .where({ app_id: appId })
    .where(function (this: any) {
      this.where({ left_table_id: baseTableId }).orWhere({ right_table_id: baseTableId });
    });

  if (!joins.length) return;

  // Resolve joined table names
  const joinedTableIds = joins.map((j: AppJoin) =>
    j.left_table_id === baseTableId ? j.right_table_id : j.left_table_id,
  );
  const joinedTables = await db('app_tables').whereIn('id', joinedTableIds).where({ app_id: appId });
  const tableNameToId = new Map<string, number>(joinedTables.map((t: any) => [t.table_name, t.id]));

  // Parse body for "tableName__fieldName" keys belonging to joined tables
  const joinedTableData: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(body)) {
    if (key.startsWith('_wdpcb_') || !key.includes('__')) continue;
    const sep = key.indexOf('__');
    const tablePart = key.slice(0, sep);
    const fieldPart = key.slice(sep + 2);
    if (!tableNameToId.has(tablePart)) continue;
    if (!joinedTableData[tablePart]) joinedTableData[tablePart] = {};
    joinedTableData[tablePart][fieldPart] = val;
  }

  if (!Object.keys(joinedTableData).length) return;

  for (const [joinedTableName, fieldData] of Object.entries(joinedTableData)) {
    const joinedTableId = tableNameToId.get(joinedTableName)!;

    const join = joins.find((j: AppJoin) =>
      (j.left_table_id === joinedTableId && j.right_table_id === baseTableId) ||
      (j.right_table_id === joinedTableId && j.left_table_id === baseTableId),
    );
    if (!join) continue;

    // Determine which field in the joined table is the FK pointing to the base table
    const fkField = join.left_table_id === joinedTableId
      ? join.left_field_name
      : join.right_field_name;

    const insertData: Record<string, unknown> = { ...fieldData };
    insertData[fkField] = newId;

    // Drop empty non-FK fields — don't write blank strings into the DB
    for (const k of Object.keys(insertData)) {
      if (k !== fkField && (insertData[k] === '' || insertData[k] === undefined || insertData[k] === null)) {
        delete insertData[k];
      }
    }

    // Only insert if there's at least one field beyond the FK itself
    if (Object.keys(insertData).length > 1) {
      await appDb(joinedTableName).insert(insertData);
    }
  }
}

// Check if a path exists between two tables using the join graph (prevents Cartesian joins)
export async function hasJoinPath(appId: number, fromTableId: number, toTableId: number): Promise<boolean> {
  if (fromTableId === toTableId) return true;
  const graph = await buildJoinGraph(appId);

  const visited = new Set<number>();
  const queue = [fromTableId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toTableId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of graph.get(current) ?? []) {
      queue.push(neighbor);
    }
  }

  return false;
}
