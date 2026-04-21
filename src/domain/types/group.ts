export interface Group {
  id: number;
  app_id: number;
  group_name: string;
  description: string | null;
  self_register_enabled: boolean;
  default_home_view_id: number | null;
  tfa_required: boolean;
  home_template: string | null;
  home_header_html: string | null;
  home_footer_html: string | null;
  post_logout_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGroupInput {
  app_id: number;
  group_name: string;
  description?: string | null;
  self_register_enabled?: boolean;
  default_home_view_id?: number | null;
  tfa_required?: boolean;
}

export interface UpdateGroupInput {
  group_name?: string;
  description?: string | null;
  self_register_enabled?: boolean;
  default_home_view_id?: number | null;
  tfa_required?: boolean;
  home_template?: string | null;
  home_header_html?: string | null;
  home_footer_html?: string | null;
  post_logout_url?: string | null;
}

export interface GroupTablePermission {
  id: number;
  group_id: number;
  table_id: number;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  manage_all: boolean;
  single_record: boolean;
  // legacy columns kept in DB for migration safety
  can_view?: boolean;
  can_edit_all_records?: boolean;
  can_edit_own_records_only?: boolean;
  can_view_all_records?: boolean;
  can_view_own_records_only?: boolean;
}

export interface UpsertGroupTablePermissionInput {
  group_id: number;
  table_id: number;
  can_add?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  manage_all?: boolean;
  single_record?: boolean;
}
