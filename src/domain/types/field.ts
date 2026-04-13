export type FieldDataType =
  | 'string'
  | 'text'
  | 'integer'
  | 'bigInteger'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'uuid'
  | 'image'
  | 'upload';

export type UIWidget =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'email'
  | 'url'
  | 'password'
  | 'hidden'
  | 'time'
  | 'image'
  | 'upload';

export interface AppField {
  id: number;
  table_id: number;
  field_name: string;
  label: string;
  data_type: FieldDataType;
  is_required: boolean;
  is_primary_key: boolean;
  is_auto_increment: boolean;
  default_value: string | null;
  is_searchable_default: boolean;
  is_visible_default: boolean;
  ui_widget: UIWidget;
  ui_options_json: string | null;
  sort_order: number;
}

export interface CreateFieldInput {
  table_id: number;
  field_name: string;
  label: string;
  data_type: FieldDataType;
  is_required?: boolean;
  is_primary_key?: boolean;
  is_auto_increment?: boolean;
  default_value?: string | null;
  is_searchable_default?: boolean;
  is_visible_default?: boolean;
  ui_widget?: UIWidget;
  ui_options_json?: string | null;
  sort_order?: number;
}

export interface UpdateFieldInput {
  field_name?: string;
  label?: string;
  data_type?: FieldDataType;
  is_required?: boolean;
  default_value?: string | null;
  is_searchable_default?: boolean;
  is_visible_default?: boolean;
  ui_widget?: UIWidget;
  ui_options_json?: string | null;
  sort_order?: number;
}
