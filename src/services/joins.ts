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
