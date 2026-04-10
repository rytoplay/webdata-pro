export type JoinType = 'inner' | 'left' | 'right';

export interface AppJoin {
  id: number;
  app_id: number;
  left_table_id: number;
  left_field_name: string;
  right_table_id: number;
  right_field_name: string;
  join_type_default: JoinType;
  relationship_label: string | null;
}

export interface CreateJoinInput {
  app_id: number;
  left_table_id: number;
  left_field_name: string;
  right_table_id: number;
  right_field_name: string;
  join_type_default?: JoinType;
  relationship_label?: string | null;
}

export interface UpdateJoinInput {
  left_field_name?: string;
  right_field_name?: string;
  join_type_default?: JoinType;
  relationship_label?: string | null;
}
