import * as tablesService from './tables';
import * as fieldsService from './fields';
import * as viewsService from './views';
import * as groupsService from './groups';
import type { App } from '../domain/types';
import type { FieldDataType, UIWidget } from '../domain/types';

// ── Blueprint JSON schema ────────────────────────────────────────────────────

export interface BlueprintField {
  field_name: string;
  label?: string;
  data_type: FieldDataType;
  ui_widget?: UIWidget;
  is_required?: boolean;
  options?: string[];         // for select widget
  default_value?: string;
}

export interface BlueprintTable {
  table_name: string;
  label: string;
  fields: BlueprintField[];
}

export interface BlueprintView {
  view_name: string;
  label: string;
  base_table: string;
  is_public?: boolean;
  pagination_enabled?: boolean;
  page_size?: number;
  primary_sort_field?: string;
  primary_sort_direction?: 'asc' | 'desc';
  secondary_sort_field?: string;
  secondary_sort_direction?: 'asc' | 'desc';
  grouping_field?: string;
  templates?: Partial<Record<string, string>>;
}

export interface BlueprintGroupTablePerm {
  can_add?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  manage_all?: boolean;
}

export interface BlueprintGroupViewPerm {
  can_view?: boolean;
  limit_to_own_records?: boolean;
}

export interface BlueprintGroup {
  group_name: string;
  description?: string;
  self_register_enabled?: boolean;
  tfa_required?: boolean;
  table_permissions?: Record<string, BlueprintGroupTablePerm>;
  view_permissions?: Record<string, BlueprintGroupViewPerm>;
}

export interface Blueprint {
  tables: BlueprintTable[];
  views?: BlueprintView[];
  groups?: BlueprintGroup[];
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_DATA_TYPES = new Set<string>([
  'string', 'text', 'integer', 'bigInteger', 'decimal', 'float',
  'boolean', 'date', 'datetime', 'time', 'json', 'uuid', 'image', 'upload'
]);

const VALID_WIDGETS = new Set<string>([
  'text', 'textarea', 'number', 'select', 'checkbox', 'date', 'datetime',
  'email', 'url', 'password', 'hidden', 'image', 'upload'
]);

export interface BlueprintError {
  path: string;
  message: string;
}

export function validateBlueprint(bp: unknown): BlueprintError[] {
  const errors: BlueprintError[] = [];
  if (typeof bp !== 'object' || bp === null) {
    return [{ path: 'root', message: 'Blueprint must be a JSON object' }];
  }
  const obj = bp as Record<string, unknown>;
  if (!Array.isArray(obj.tables) || obj.tables.length === 0) {
    errors.push({ path: 'tables', message: 'Blueprint must include at least one table' });
    return errors;
  }
  for (let i = 0; i < obj.tables.length; i++) {
    const t = obj.tables[i] as Record<string, unknown>;
    if (!t.table_name || typeof t.table_name !== 'string') {
      errors.push({ path: `tables[${i}].table_name`, message: 'Missing or invalid table_name' });
    } else if (!/^[a-z][a-z0-9_]*$/.test(t.table_name)) {
      errors.push({ path: `tables[${i}].table_name`, message: `"${t.table_name}" must be lowercase snake_case` });
    }
    if (!Array.isArray(t.fields)) {
      errors.push({ path: `tables[${i}].fields`, message: 'fields must be an array' });
    } else {
      for (let j = 0; j < t.fields.length; j++) {
        const f = t.fields[j] as Record<string, unknown>;
        if (!f.field_name || typeof f.field_name !== 'string') {
          errors.push({ path: `tables[${i}].fields[${j}].field_name`, message: 'Missing field_name' });
        }
        if (f.data_type && !VALID_DATA_TYPES.has(f.data_type as string)) {
          errors.push({ path: `tables[${i}].fields[${j}].data_type`, message: `Unknown data_type "${f.data_type}"` });
        }
        if (f.ui_widget && !VALID_WIDGETS.has(f.ui_widget as string)) {
          errors.push({ path: `tables[${i}].fields[${j}].ui_widget`, message: `Unknown ui_widget "${f.ui_widget}"` });
        }
      }
    }
  }
  return errors;
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface BlueprintApplyResult {
  tablesCreated: string[];
  fieldsCreated: number;
  viewsCreated: string[];
  groupsCreated: string[];
  errors: string[];
}

// ── Apply ────────────────────────────────────────────────────────────────────

export async function applyBlueprint(app: App, bp: Blueprint): Promise<BlueprintApplyResult> {
  const result: BlueprintApplyResult = {
    tablesCreated: [], fieldsCreated: 0, viewsCreated: [], groupsCreated: [], errors: []
  };

  // Track name → id mappings for cross-references
  const tableIdByName = new Map<string, number>();
  const viewIdByName  = new Map<string, number>();

  // ── Tables + Fields ───────────────────────────────────────────────────────
  for (const bt of bp.tables) {
    try {
      const table = await tablesService.createTable({
        app_id:     app.id,
        table_name: bt.table_name,
        label:      bt.label,
      });
      tableIdByName.set(bt.table_name, table.id);
      result.tablesCreated.push(bt.label || bt.table_name);

      for (const bf of (bt.fields ?? [])) {
        try {
          const dataType = (VALID_DATA_TYPES.has(bf.data_type) ? bf.data_type : 'string') as FieldDataType;
          const widget   = (bf.ui_widget && VALID_WIDGETS.has(bf.ui_widget) ? bf.ui_widget : undefined) as UIWidget | undefined;

          let uiOptionsJson: string | null = null;
          if (bf.options && bf.options.length > 0) {
            uiOptionsJson = JSON.stringify({ options: bf.options });
          }

          await fieldsService.createField({
            table_id:      table.id,
            field_name:    bf.field_name,
            label:         bf.label ?? bf.field_name,
            data_type:     dataType,
            is_required:   bf.is_required ?? false,
            ui_widget:     widget,
            default_value: bf.default_value ?? null,
            ui_options_json: uiOptionsJson,
          });
          result.fieldsCreated++;
        } catch (err) {
          result.errors.push(`Field "${bt.table_name}.${bf.field_name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      result.errors.push(`Table "${bt.table_name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Views ─────────────────────────────────────────────────────────────────
  for (const bv of (bp.views ?? [])) {
    try {
      const tableId = tableIdByName.get(bv.base_table);
      if (!tableId) {
        result.errors.push(`View "${bv.view_name}": base_table "${bv.base_table}" not found`);
        continue;
      }

      const view = await viewsService.createView({
        app_id:                  app.id,
        view_name:               bv.view_name,
        label:                   bv.label,
        base_table_id:           tableId,
        is_public:               bv.is_public ?? false,
        pagination_enabled:      bv.pagination_enabled ?? true,
        page_size:               bv.page_size ?? 20,
        primary_sort_field:      bv.primary_sort_field ?? null,
        primary_sort_direction:  bv.primary_sort_direction ?? null,
        secondary_sort_field:    bv.secondary_sort_field ?? null,
        secondary_sort_direction: bv.secondary_sort_direction ?? null,
        grouping_field:          bv.grouping_field ?? null,
      });

      viewIdByName.set(bv.view_name, view.id);
      result.viewsCreated.push(bv.label || bv.view_name);

      if (bv.templates && Object.keys(bv.templates).length > 0) {
        await viewsService.saveViewTemplates(app.id, view.id, bv.templates as Partial<import('./views').ViewTemplates>);
      }
    } catch (err) {
      result.errors.push(`View "${bv.view_name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Groups + Permissions ──────────────────────────────────────────────────
  for (const bg of (bp.groups ?? [])) {
    try {
      const group = await groupsService.createGroup({
        app_id:                app.id,
        group_name:            bg.group_name,
        description:           bg.description ?? null,
        self_register_enabled: bg.self_register_enabled ?? false,
        tfa_required:          bg.tfa_required ?? false,
      });
      result.groupsCreated.push(bg.group_name);

      // Table permissions
      for (const [tName, tp] of Object.entries(bg.table_permissions ?? {})) {
        const tableId = tableIdByName.get(tName);
        if (!tableId) continue;
        await groupsService.upsertTablePermission({
          group_id:   group.id,
          table_id:   tableId,
          can_add:    tp.can_add    ?? false,
          can_edit:   tp.can_edit   ?? false,
          can_delete: tp.can_delete ?? false,
          manage_all: tp.manage_all ?? false,
        });
      }

      // View permissions
      for (const [vName, vp] of Object.entries(bg.view_permissions ?? {})) {
        const viewId = viewIdByName.get(vName);
        if (!viewId) continue;
        await groupsService.saveViewPermGrid(group.id, [{
          view_id:              viewId,
          can_view:             vp.can_view             ?? true,
          limit_to_own_records: vp.limit_to_own_records ?? false,
        }]);
      }
    } catch (err) {
      result.errors.push(`Group "${bg.group_name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
