export type QueryMode = 'automatic' | 'advanced_sql';
export type SortDirection = 'asc' | 'desc';

export interface View {
  id: number;
  app_id: number;
  view_name: string;
  label: string;
  base_table_id: number;
  is_public: boolean;
  pagination_enabled: boolean;
  page_size: number;
  query_mode: QueryMode;
  custom_sql: string | null;
  primary_sort_field: string | null;
  primary_sort_direction: SortDirection | null;
  secondary_sort_field: string | null;
  secondary_sort_direction: SortDirection | null;
  grouping_field: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateViewInput {
  app_id: number;
  view_name: string;
  label: string;
  base_table_id: number;
  is_public?: boolean;
  pagination_enabled?: boolean;
  page_size?: number;
  query_mode?: QueryMode;
  custom_sql?: string | null;
  primary_sort_field?: string | null;
  primary_sort_direction?: SortDirection | null;
  secondary_sort_field?: string | null;
  secondary_sort_direction?: SortDirection | null;
  grouping_field?: string | null;
}

export interface ViewGroupPermission {
  id: number;
  view_id: number;
  group_id: number;
  can_view: boolean;
  can_search_all_records: boolean;
  can_search_own_records_only: boolean;
}

export interface ViewSearchField {
  id: number;
  view_id: number;
  group_id: number | null;
  field_token: string;
  search_type: string;
  label: string;
}
