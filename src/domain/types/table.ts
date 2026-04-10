export interface AppTable {
  id: number;
  app_id: number;
  table_name: string;
  label: string;
  description: string | null;
  is_public_addable: boolean;
  is_member_editable: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTableInput {
  app_id: number;
  table_name: string;
  label: string;
  description?: string | null;
  is_public_addable?: boolean;
  is_member_editable?: boolean;
}

export interface UpdateTableInput {
  table_name?: string;
  label?: string;
  description?: string | null;
  is_public_addable?: boolean;
  is_member_editable?: boolean;
}
