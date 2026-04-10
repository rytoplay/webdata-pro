import { db as controlDb } from '../db/knex';

export interface ColumnRef {
  table: string;
  field: string;
  alias?: string;
}

export interface JoinStep {
  table: string;
  condition: string;
  type: string;
}

export interface QueryResult {
  fromTable: string;
  columns: string[];
  joins: JoinStep[];
  sql: string;
}

interface ResolvedJoin {
  left_table_name: string;
  left_field_name: string;
  right_table_name: string;
  right_field_name: string;
  join_type_default: string;
}

interface TraversalEdge {
  fromTable: string;
  toTable: string;
  condition: string;
  type: string;
}

export async function buildJoinQuery(
  appId: number,
  fromTableName: string,
  columnRefs: ColumnRef[]
): Promise<QueryResult> {

  // Load all joins for this app, resolving table names from IDs
  const rows = await controlDb('app_joins')
    .join('app_tables as lt', 'app_joins.left_table_id', 'lt.id')
    .join('app_tables as rt', 'app_joins.right_table_id', 'rt.id')
    .where('app_joins.app_id', appId)
    .select(
      'app_joins.join_type_default',
      'lt.table_name as left_table_name',
      'app_joins.left_field_name',
      'rt.table_name as right_table_name',
      'app_joins.right_field_name'
    ) as ResolvedJoin[];

  // Build a bidirectional adjacency list of traversal edges
  const adj = new Map<string, TraversalEdge[]>();
  const addEdge = (e: TraversalEdge) => {
    if (!adj.has(e.fromTable)) adj.set(e.fromTable, []);
    adj.get(e.fromTable)!.push(e);
  };

  for (const j of rows) {
    const type = `${j.join_type_default.toUpperCase()} JOIN`;
    addEdge({
      fromTable: j.left_table_name,
      toTable: j.right_table_name,
      condition: `"${j.left_table_name}"."${j.left_field_name}" = "${j.right_table_name}"."${j.right_field_name}"`,
      type
    });
    addEdge({
      fromTable: j.right_table_name,
      toTable: j.left_table_name,
      condition: `"${j.right_table_name}"."${j.right_field_name}" = "${j.left_table_name}"."${j.left_field_name}"`,
      type
    });
  }

  // Find all unique tables referenced that are not the from-table
  const targetTables = [...new Set(
    columnRefs.map(c => c.table).filter(t => t !== fromTableName)
  )];

  // BFS from fromTableName to each target, collecting JOIN steps
  const neededJoins: JoinStep[] = [];
  const joined = new Set<string>([fromTableName]);

  for (const target of targetTables) {
    if (joined.has(target)) continue;

    const visited = new Set<string>([fromTableName]);
    const queue: { table: string; path: TraversalEdge[] }[] = [
      { table: fromTableName, path: [] }
    ];
    let found: TraversalEdge[] | null = null;

    bfs: while (queue.length > 0) {
      const { table, path } = queue.shift()!;
      for (const edge of adj.get(table) ?? []) {
        if (visited.has(edge.toTable)) continue;
        visited.add(edge.toTable);
        const newPath = [...path, edge];
        if (edge.toTable === target) {
          found = newPath;
          break bfs;
        }
        queue.push({ table: edge.toTable, path: newPath });
      }
    }

    if (!found) {
      throw new Error(
        `No join path found from "${fromTableName}" to "${target}". ` +
        `Define the relationship under Joins first.`
      );
    }

    for (const step of found) {
      if (!joined.has(step.toTable)) {
        neededJoins.push({ table: step.toTable, condition: step.condition, type: step.type });
        joined.add(step.toTable);
      }
    }
  }

  // Build SELECT column list
  const cols = columnRefs.map(c => {
    const ref = `"${c.table}"."${c.field}"`;
    return c.alias ? `${ref} AS "${c.alias}"` : ref;
  });

  // Assemble SQL
  const parts: string[] = [
    `SELECT`,
    `  ${cols.join(',\n  ')}`,
    `FROM "${fromTableName}"`
  ];
  for (const j of neededJoins) {
    parts.push(`${j.type} "${j.table}" ON ${j.condition}`);
  }

  return {
    fromTable: fromTableName,
    columns: cols,
    joins: neededJoins,
    sql: parts.join('\n')
  };
}

/**
 * Parse "table.field" references out of a free-form string.
 * Used to extract column refs from template expressions like
 * "${books.title} by ${authors.last_name}"
 */
export function parseColumnRefs(input: string): ColumnRef[] {
  const seen = new Set<string>();
  const refs: ColumnRef[] = [];
  const re = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ table: m[1].toLowerCase(), field: m[2].toLowerCase() });
    }
  }
  return refs;
}
