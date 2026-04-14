// ── Shared CSS class reference (used by both AI Builder and AI Design) ─────────

export const CSS_CLASS_REFERENCE = `## CSS Class Reference — use ONLY these classes, no others

SEARCH BAR:
  .wdp-sf — flex wrapper for the search bar (light background, rounded top)
  Plain <input type="text" name="q"> and <button type="submit"> inside .wdp-sf get auto-styled.

HEADER BAR:
  .wdp-hdr — dark primary-colored bar (flex, space-between)
  .wdp-hdr-title — bold left-side title text
  .wdp-hdr-meta — small muted right-side text (e.g. record count)

GROUP DIVIDER:
  .wdp-grp — group divider row
  .wdp-grp-label — uppercase accent-colored group name
  .wdp-grp-bar — flex spacer line

CARD ROW LAYOUT:
  .wdp-row — card row (flex, bordered, hover effect, cursor:pointer)
  .wdp-row-body — flex-grow content area
  .wdp-row-title — bold primary title (first line)
  .wdp-row-sub — accent-color subtitle (second line)
  .wdp-row-meta — small muted info (third line: dates, locations, counts)
  .wdp-arr — right-side chevron; put &#8250; inside it

TABLE LAYOUT (for spreadsheet-style views):
  .wdp-table — full-width <table> with dark header and hover rows
  CRITICAL: header template must OPEN the table, footer must CLOSE it:
    header ends with: ...<table class="wdp-table"><thead><tr><th>...</th></tr></thead><tbody>
    row is:           <tr data-wdp-action="detail" data-wdp-id="\${_pk}"><td>\${col}</td></tr>
    footer starts:    </tbody></table>...

FOOTER:
  .wdp-footer — grey bottom bar, centered (place \${_pagination} here)

DETAIL VIEW:
  .wdp-detail — card container (light bg, rounded, padded)
  .wdp-back — back button (no background, accent color; use data-wdp-action="back")
  .wdp-detail-title — large bold record title (<h2>)
  .wdp-detail-sub — subtitle / secondary identifier line
  .wdp-badge — small accent-colored badge (uppercase pill text)
  .wdp-detail-body — body section (top border, padding-top)
  .wdp-field — wraps one label+value pair
  .wdp-field-label — small uppercase column label
  .wdp-field-value — field value text

FORMS (edit_form and create_form):
  .wdp-form-group — wraps one label+input pair (margin-bottom 14px)
  .wdp-label — small uppercase label above the input
  .wdp-input — styled text/number/date/email input (full width)
  .wdp-select — styled <select> dropdown (full width)
  .wdp-textarea — styled <textarea> (full width, resizable)
  .wdp-btn — primary submit button (dark background, white text)
  .wdp-btn-secondary — secondary button (light background, bordered)
  .wdp-btn-link — text-only link button (no background; for Back / Cancel)`;

// ── System prompt ─────────────────────────────────────────────────────────────

export const BLUEPRINT_SYSTEM_PROMPT = `You are a database schema designer for Webdata Pro, a metadata-driven web application builder. Your job is to produce a complete app blueprint as a single JSON object. Output ONLY the raw JSON object — no prose, no markdown fences.

## JSON RULES
1. Use ONLY double-quoted strings. Never backticks, never single quotes.
2. No trailing commas.
3. Field/table/view/group names must be snake_case (lowercase letters, digits, underscores).

## Tables & Fields
"id" is auto-created — NEVER include it in the fields array.
NEVER include "created_at" or "updated_at" — reserved system columns.
NEVER create tables for users, members, or accounts — those are handled by the groups/login system.

Field properties:
- field_name: snake_case identifier
- label: human-readable display name
- data_type: string | text | integer | decimal | float | boolean | date | datetime
- ui_widget: text | textarea | number | select | checkbox | date | datetime | email | url
  Leave null to auto-assign. Guide: string→text, text→textarea, integer/decimal/float→number, boolean→checkbox
- is_required: true | false
- options: string[] — only for select widgets
- default_value: optional string

## Views
For each main table generate TWO views:
1. A public browse view (is_public: true) — for visitors. No login required.
2. A staff manage view (is_public: false) — for logged-in staff with CRUD access.

Each view has:
- view_name: snake_case (e.g. "pets_browse" and "pets_manage")
- label: display name (e.g. "Browse Pets" and "Manage Pets")
- base_table: the table_name this view queries
- is_public: true/false
- pagination_enabled: true/false
- page_size: 10
- primary_sort_field: a field_name from the table (or _meta__created_at / _meta__updated_at)
- primary_sort_direction: "asc" | "desc"
- style_hint: optional layout keyword — "table" for spreadsheet style, "cards" for card list style

## Groups
- group_name: snake_case
- description: human label
- self_register_enabled: true/false
- tfa_required: true/false
- table_permissions: keyed by actual table_name
  e.g. { "listings": { "can_add": true, "can_edit": true, "can_delete": true, "manage_all": true } }
- view_permissions: keyed by actual view_name
  e.g. { "listings_browse": { "can_view": true, "limit_to_own_records": false } }

## Sample Data
Include a "sample_data" key with realistic records for each table.
- The MAIN browseable table (base_table of the primary view) MUST have at least 15 records so pagination is visible with page_size 10.
- Reference/lookup tables (small tables used for FK relationships) need only 5–8 records.
- Each record is a plain object with field values only — do NOT include "id", "created_at", or "updated_at".
- Use realistic, specific values: real-sounding names/titles, plausible numbers, ISO dates (YYYY-MM-DD), true/false for boolean.
- Vary the values — don't repeat the same category or price for every record.

## Output format
Return ONLY a JSON object with this structure:

{
  "tables": [
    {
      "table_name": "items",
      "label": "Items",
      "fields": [
        { "field_name": "title", "label": "Title", "data_type": "string", "ui_widget": "text", "is_required": true },
        { "field_name": "price", "label": "Price", "data_type": "decimal", "ui_widget": "number", "is_required": false }
      ]
    }
  ],
  "views": [
    {
      "view_name": "items_browse",
      "label": "Browse Items",
      "base_table": "items",
      "is_public": true,
      "pagination_enabled": true,
      "page_size": 10,
      "primary_sort_field": "_meta__created_at",
      "primary_sort_direction": "desc",
      "style_hint": "table"
    },
    {
      "view_name": "items_manage",
      "label": "Manage Items",
      "base_table": "items",
      "is_public": false,
      "pagination_enabled": true,
      "page_size": 10,
      "primary_sort_field": "_meta__created_at",
      "primary_sort_direction": "desc",
      "style_hint": "table"
    }
  ],
  "groups": [
    {
      "group_name": "managers",
      "description": "Managers",
      "self_register_enabled": false,
      "tfa_required": false,
      "table_permissions": {
        "items": { "can_add": true, "can_edit": true, "can_delete": true, "manage_all": true }
      },
      "view_permissions": {
        "items_browse": { "can_view": true, "limit_to_own_records": false },
        "items_manage": { "can_view": true, "limit_to_own_records": false }
      }
    }
  ],
  "sample_data": {
    "items": [
      { "title": "Example Item One", "price": 49.99 },
      { "title": "Example Item Two", "price": 129.00 }
    ]
  }
}`;

// ── User prompt builder ───────────────────────────────────────────────────────

export interface WizardAnswers {
  description: string;
  knownFields: boolean;
  fieldList: string;
  isPublic: boolean;
  layoutStyle: string;
  hasAdminGroup: boolean;
  hasMemberGroup: boolean;
}

export function buildUserPrompt(a: WizardAnswers): string {
  const lines: string[] = [];

  lines.push('Build a Webdata Pro blueprint for the following app:');
  lines.push(`Description: ${a.description}`);
  lines.push('');

  if (a.knownFields && a.fieldList.trim()) {
    lines.push(`Fields specified by user: ${a.fieldList.trim()}`);
    lines.push('Create fields that match this list, choosing appropriate data types and widgets.');
  } else {
    lines.push('Generate a practical field list for this kind of database. Include 6–10 fields that would be most useful.');
  }

  lines.push('');
  lines.push(`Public: ${a.isPublic ? 'Yes — is_public: true on the main view.' : 'No — is_public: false on all views.'}`);

  // style_hint for the view — drives server-side template layout
  const styleHint = a.layoutStyle.toLowerCase().includes('table') || a.layoutStyle.toLowerCase().includes('spreadsheet')
    ? 'table'
    : 'cards';
  lines.push(`View style_hint: "${styleHint}" — set this on every view object.`);

  lines.push('');
  if (a.hasAdminGroup) {
    lines.push('Include a group "managers": self_register_enabled false, full table permissions (can_add/can_edit/can_delete/manage_all true), can_view on all views.');
  }
  if (a.hasMemberGroup) {
    lines.push('Include a group "members": self_register_enabled true, can_add true, can_edit true, can_delete false, manage_all false, limit_to_own_records true on all view permissions.');
  }

  lines.push('');
  lines.push('Sample data: include at least 15 realistic, varied records for the main browseable table (use page_size 10 on the view), and 5–8 records for any small reference/lookup tables.');
  lines.push('Use specific real-sounding values. Do NOT include id, created_at, or updated_at.');
  lines.push('');
  lines.push('Return ONLY the JSON object. No prose, no markdown fences.');

  return lines.join('\n');
}
