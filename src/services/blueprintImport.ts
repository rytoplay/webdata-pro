import * as tablesService from './tables';
import { createGalleryTable } from './tables';
import * as fieldsService from './fields';
import * as viewsService from './views';
import * as groupsService from './groups';
import { touchRecordMeta } from './recordMeta';
import { getAppDb } from '../db/adapters/appDb';
import { db } from '../db/knex';
import { buildStarterTemplates } from './templateGen';
import type { TemplateField } from './templateGen';
import type { App } from '../domain/types';
import type { FieldDataType, UIWidget } from '../domain/types';

// ── Default home template applied to blueprint-generated groups ──────────────
// Uses runtime variables (browseViews, manageViews, tables) so it works for any
// combination of views and tables without hardcoding specific names.
const DEFAULT_BLUEPRINT_HOME_TEMPLATE = `<div style="max-width:640px;margin:0 auto;padding:2rem 1rem;">
  <h2 style="margin:0 0 1.5rem;">Welcome{% if member.first_name %}, {{ member.first_name }}{% endif %}!</h2>

  {% if browseViews.length %}
  <h3 style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 0.5rem;">Searches &amp; Reports</h3>
  <ul style="list-style:none;padding:0;margin:0 0 1.5rem;">
    {% for v in browseViews %}
    <li style="margin-bottom:0.4rem;"><a href="{{ v.url }}" style="color:var(--accent);">{{ v.label }}</a></li>
    {% endfor %}
  </ul>
  {% endif %}

  {% if manageViews.length %}
  <h3 style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 0.5rem;">Manage Data</h3>
  <ul style="list-style:none;padding:0;margin:0 0 1.5rem;">
    {% for v in manageViews %}
    <li style="margin-bottom:0.4rem;"><a href="{{ v.url }}" style="color:var(--accent);">{{ v.label }}</a></li>
    {% endfor %}
  </ul>
  {% endif %}

  {% if tables.length %}
  <h3 style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 0.5rem;">Tables</h3>
  <ul style="list-style:none;padding:0;margin:0;">
    {% for t in tables %}
    <li style="margin-bottom:0.5rem;">
      <a href="{{ t.tableUrl }}" style="color:var(--accent);">{{ t.label }}</a>
      {% if t.newUrl %}&ensp;<a href="{{ t.newUrl }}" style="font-size:0.82rem;color:#64748b;">+ Add</a>{% endif %}
    </li>
    {% endfor %}
  </ul>
  {% endif %}
</div>`;

// ── Blueprint JSON schema ────────────────────────────────────────────────────

export interface BlueprintField {
  field_name: string;
  label?: string;
  data_type: FieldDataType;
  ui_widget?: UIWidget;
  is_required?: boolean;
  options?: string[];         // for select widget
  default_value?: string;
  allow_gallery?: boolean;    // when true + data_type=image: create a linked photos table
}

export interface BlueprintTable {
  table_name: string;
  label: string;
  fields: BlueprintField[];
  sample_data?: Record<string, unknown>[];  // model sometimes puts sample data here
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
  style_hint?: string;  // optional style keyword passed to template generator
}

export interface BlueprintGroupTablePerm {
  can_add?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  manage_all?: boolean;
  single_record?: boolean;
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
  sample_data?: Record<string, Record<string, unknown>[]>;
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
        // Unknown data_types are silently mapped to 'string' at apply time — not a hard error.
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
  rowsInserted: number;
  errors: string[];
}

// ── Apply ────────────────────────────────────────────────────────────────────

export async function applyBlueprint(app: App, bp: Blueprint): Promise<BlueprintApplyResult> {
  const result: BlueprintApplyResult = {
    tablesCreated: [], fieldsCreated: 0, viewsCreated: [], groupsCreated: [], rowsInserted: 0, errors: []
  };

  // Track name → id mappings for cross-references
  const tableIdByName = new Map<string, number>();
  const viewIdByName  = new Map<string, number>();

  // ── Tables + Fields ───────────────────────────────────────────────────────
  for (const bt of bp.tables) {
    try {
      // Idempotent: reuse existing table if it already exists
      let table = await tablesService.getTableByName(app.id, bt.table_name);
      if (table) {
        tableIdByName.set(bt.table_name, table.id);
      } else {
        table = await tablesService.createTable({
          app_id:     app.id,
          table_name: bt.table_name,
          label:      bt.label,
        });
        tableIdByName.set(bt.table_name, table.id);
        result.tablesCreated.push(bt.label || bt.table_name);
      }

      // Get existing field names so we don't double-create
      const existingFields = await fieldsService.listFields(table.id);
      const existingNames  = new Set(existingFields.map(f => f.field_name));

      for (const bf of (bt.fields ?? [])) {
        // Skip reserved field names
        if (['id', 'created_at', 'updated_at'].includes(bf.field_name)) continue;

        // Gallery field: create a linked photos table instead of a regular column
        if (bf.data_type === 'image' && bf.allow_gallery) {
          const galleryTableName = `${bt.table_name}_photos`;
          if (!existingNames.has(galleryTableName + '_gallery_marker')) {
            try {
              await createGalleryTable(app.id, bt.table_name);
              result.fieldsCreated++;
              result.tablesCreated.push(galleryTableName);
            } catch (err) {
              result.errors.push(`Gallery "${bt.table_name}_photos": ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          continue;
        }

        // Skip regular fields that already exist
        if (existingNames.has(bf.field_name)) continue;

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

  // ── FK auto-detection + join creation ────────────────────────────────────
  // Scan every table's fields for *_id fields that match another table in this
  // app. Create app_joins entries and return a map for use in template generation.
  // Convention: "artist_id" → look for table "artists" (or "artist").
  type FkInfo = { relatedTable: string; labelField: string };
  const fkByTableField = new Map<string, FkInfo>(); // "items.artist_id" → { relatedTable, labelField }

  const allAppTables = await tablesService.listTables(app.id);
  const tableByName  = new Map(allAppTables.map(t => [t.table_name, t]));

  for (const baseTable of allAppTables) {
    const fields = await fieldsService.listFields(baseTable.id);
    for (const field of fields) {
      if (!field.field_name.endsWith('_id')) continue;
      const base = field.field_name.slice(0, -3); // strip "_id"

      // Try table name = base + 's', base + 'es', or exact base
      const relatedTable =
        tableByName.get(base + 's') ??
        tableByName.get(base + 'es') ??
        tableByName.get(base);
      if (!relatedTable || relatedTable.id === baseTable.id) continue;

      // Find first non-PK string/text field as the label field
      const relatedFields = await fieldsService.listFields(relatedTable.id);
      const labelField = relatedFields.find(
        f => !f.is_primary_key && ['string', 'text'].includes(f.data_type)
      );
      if (!labelField) continue;

      const key = `${baseTable.table_name}.${field.field_name}`;
      fkByTableField.set(key, { relatedTable: relatedTable.table_name, labelField: labelField.field_name });

      // Create app_joins entry if it doesn't already exist
      const pkField = relatedFields.find(f => f.is_primary_key);
      if (!pkField) continue;

      const existingJoin = await db('app_joins')
        .where({
          app_id:          app.id,
          left_table_id:   baseTable.id,
          left_field_name: field.field_name,
          right_table_id:  relatedTable.id,
        })
        .first();

      if (!existingJoin) {
        await db('app_joins').insert({
          app_id:             app.id,
          left_table_id:      baseTable.id,
          left_field_name:    field.field_name,
          right_table_id:     relatedTable.id,
          right_field_name:   pkField.field_name,
          join_type_default:  'left',
          relationship_label: `${baseTable.table_name}.${field.field_name} → ${relatedTable.table_name}`,
        });
      }
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

      // Idempotent: skip if view already exists
      const existingView = await viewsService.getViewByName(app.id, bv.view_name);
      if (existingView) {
        viewIdByName.set(bv.view_name, existingView.id);
        continue;
      }

      // Validate sort fields: must be a real field name or a known metadata sort key
      const META_SORTS = new Set(['_meta__created_at', '_meta__updated_at', '_meta__created_by']);
      const tableFields = await fieldsService.listFields(tableId);
      const validFieldNames = new Set([...tableFields.map(f => f.field_name), ...META_SORTS]);

      const sanitiseSort = (f: string | null | undefined) =>
        f && validFieldNames.has(f) ? f : null;

      const view = await viewsService.createView({
        app_id:                  app.id,
        view_name:               bv.view_name,
        label:                   bv.label,
        base_table_id:           tableId,
        is_public:               bv.is_public ?? false,
        pagination_enabled:      bv.pagination_enabled ?? true,
        page_size:               bv.page_size ?? 20,
        primary_sort_field:      sanitiseSort(bv.primary_sort_field),
        primary_sort_direction:  bv.primary_sort_direction ?? null,
        secondary_sort_field:    sanitiseSort(bv.secondary_sort_field),
        secondary_sort_direction: bv.secondary_sort_direction ?? null,
        grouping_field:          bv.grouping_field ?? null,
      });

      viewIdByName.set(bv.view_name, view.id);
      result.viewsCreated.push(bv.label || bv.view_name);

      // Auto-generate templates from field metadata — never rely on AI for HTML.
      // FK fields (e.g. artist_id) are enriched with the related table's label field
      // so templates show "The Beatles" instead of "1".
      {
        const RESERVED_TEMPLATE = new Set(['id', 'created_at', 'updated_at']);
        const templateFields: TemplateField[] = tableFields
          .filter(f => !RESERVED_TEMPLATE.has(f.field_name))
          .map(f => {
            const fkKey = `${bv.base_table}.${f.field_name}`;
            const fk    = fkByTableField.get(fkKey);
            return {
              field_name:      f.field_name,
              label:           f.label,
              data_type:       f.data_type,
              table_name:      bv.base_table,
              fk_table:        fk?.relatedTable,
              fk_label_field:  fk?.labelField,
            };
          });
        const starters = buildStarterTemplates(
          { table_name: bv.base_table, label: bv.label },
          templateFields,
          bv.style_hint ?? '',
          bv.is_public ?? false,
        );
        await viewsService.saveViewTemplates(app.id, view.id, starters);
      }
    } catch (err) {
      result.errors.push(`View "${bv.view_name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Groups + Permissions ──────────────────────────────────────────────────
  const existingGroups = await groupsService.listGroups(app.id);
  const existingGroupNames = new Set(existingGroups.map(g => g.group_name));

  for (const bg of (bp.groups ?? [])) {
    try {
      // Idempotent: skip if group already exists
      if (existingGroupNames.has(bg.group_name)) continue;

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
          group_id:      group.id,
          table_id:      tableId,
          can_add:       tp.can_add       ?? false,
          can_edit:      tp.can_edit      ?? false,
          can_delete:    tp.can_delete    ?? false,
          manage_all:    tp.manage_all    ?? false,
          single_record: tp.single_record ?? false,
        });
      }

      // View permissions
      for (const [vName, vp] of Object.entries(bg.view_permissions ?? {})) {
        const viewId = viewIdByName.get(vName);
        if (!viewId) continue;
        await groupsService.saveViewPermGrid(group.id, [{
          view_id:              viewId,
          can_view:             vp.can_view ?? true,
          limit_to_own_records: vp.limit_to_own_records ?? false,
        }]);
      }

      // Generate a default home template so the member portal looks good
      // out of the box regardless of how many views/tables the group has.
      await groupsService.updateGroup(group.id, { home_template: DEFAULT_BLUEPRINT_HOME_TEMPLATE });
    } catch (err) {
      result.errors.push(`Group "${bg.group_name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Sample Data ───────────────────────────────────────────────────────────
  // Merge sample data from two places: top-level bp.sample_data AND inline
  // table.sample_data (the model sometimes puts it inside the table object).
  const mergedSampleData: Record<string, Record<string, unknown>[]> = { ...(bp.sample_data ?? {}) };
  for (const bt of bp.tables) {
    if (Array.isArray(bt.sample_data) && bt.sample_data.length > 0) {
      if (!mergedSampleData[bt.table_name]) {
        mergedSampleData[bt.table_name] = bt.sample_data as Record<string, unknown>[];
      }
    }
  }

  if (Object.keys(mergedSampleData).length > 0) {
    const appDb = getAppDb(app);
    const SKIP_TYPES = new Set(['image', 'upload']);
    const RESERVED   = new Set(['id', 'created_at', 'updated_at']);

    // Spread insertion timestamps evenly over the past 30 days so the data
    // looks like it accumulated naturally rather than all appearing at once.
    const nowMs       = Date.now();
    const thirtyDays  = 30 * 24 * 60 * 60 * 1000;

    for (const [tableName, rows] of Object.entries(mergedSampleData)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const tableId = tableIdByName.get(tableName);
      if (!tableId) continue;

      const tableFields = await fieldsService.listFields(tableId);
      const fieldMap    = new Map(tableFields.map(f => [f.field_name, f]));

      for (let i = 0; i < rows.length; i++) {
        const row    = rows[i] as Record<string, unknown>;
        const record: Record<string, unknown> = {};

        for (const [key, val] of Object.entries(row)) {
          if (RESERVED.has(key)) continue;
          const field = fieldMap.get(key);
          if (!field || SKIP_TYPES.has(field.data_type)) continue;
          if (field.data_type === 'boolean') {
            record[key] = val ? 1 : 0;
          } else if (val === null || val === undefined || val === '') {
            record[key] = null;
          } else {
            record[key] = val;
          }
        }

        if (Object.keys(record).length === 0) continue;

        try {
          const ids = await appDb(tableName).insert(record);
          const insertedId = Array.isArray(ids) ? ids[0] : ids;

          // Older records get timestamps further in the past
          const fraction  = rows.length > 1 ? i / (rows.length - 1) : 0;
          const ts        = new Date(nowMs - thirtyDays * (1 - fraction))
            .toISOString().replace('T', ' ').substring(0, 19);

          await touchRecordMeta(app, tableName, insertedId, null, 'Sample Data', ts);
          result.rowsInserted++;
        } catch (err) {
          result.errors.push(`Sample "${tableName}[${i}]": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  return result;
}
