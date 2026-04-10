export type IndexType = 'normal' | 'unique' | 'fulltext';

export interface AppIndex {
  id: number;
  table_id: number;
  index_name: string;
  index_type: IndexType;
  column_list_json: string;
}

export interface CreateIndexInput {
  table_id: number;
  index_name: string;
  index_type?: IndexType;
  column_list_json: string;
}

export interface UpdateIndexInput {
  index_name?: string;
  index_type?: IndexType;
  column_list_json?: string;
}
