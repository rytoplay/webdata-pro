/**
 * templateGen.ts — Builds correct, server-side starter templates from field metadata.
 * Used by both the generate-templates route AND applyBlueprint so views always
 * have working HTML without relying on the AI to escape JSON strings correctly.
 */

import type { ViewTemplates } from './views';

export interface TemplateField {
  field_name: string;
  label?:     string;
  data_type:  string;
  table_name: string;
  /** If this is a FK field, the related table name (e.g. "artists") */
  fk_table?:       string;
  /** The label field to display from the related table (e.g. "name") */
  fk_label_field?: string;
}

export interface TemplateTable {
  table_name: string;
  label?:     string;
}

const DEFAULT_COLORS = '--wdp-primary:#1e3a5f;--wdp-on-primary:#fff;--wdp-accent:#2e86de;--wdp-bg:#f0f4f8;--wdp-surface:#fff;--wdp-text:#1a2a3a;--wdp-border:#c8d8e8';

const COLOR_MAP: Record<string, string> = {
  orange: '--wdp-primary:#c44b00;--wdp-on-primary:#fff;--wdp-accent:#e87722;--wdp-bg:#fff8f0;--wdp-surface:#fff;--wdp-text:#1a0e00;--wdp-border:#f0c090',
  dark:   '--wdp-primary:#1a1a2e;--wdp-on-primary:#e0e0e0;--wdp-accent:#e94560;--wdp-bg:#16213e;--wdp-surface:#0f3460;--wdp-text:#e0e0e0;--wdp-border:#1a4a7a',
  green:  '--wdp-primary:#1a5c2a;--wdp-on-primary:#fff;--wdp-accent:#2d9e4a;--wdp-bg:#f0fff4;--wdp-surface:#fff;--wdp-text:#1a3a1a;--wdp-border:#b7e4c7',
  red:    '--wdp-primary:#8b1a1a;--wdp-on-primary:#fff;--wdp-accent:#c0392b;--wdp-bg:#fff5f5;--wdp-surface:#fff;--wdp-text:#1a0000;--wdp-border:#f5b7b1',
  purple: '--wdp-primary:#4a1a6b;--wdp-on-primary:#fff;--wdp-accent:#8e44ad;--wdp-bg:#f9f0ff;--wdp-surface:#fff;--wdp-text:#1a001a;--wdp-border:#d7b8f0',
};

function pickColors(styleHint: string): string {
  const h = styleHint.toLowerCase();
  for (const [key, vars] of Object.entries(COLOR_MAP)) {
    if (h.includes(key)) return vars;
  }
  return DEFAULT_COLORS;
}

function inputTypeFor(dataType: string): string {
  if (['integer', 'decimal', 'float', 'bigInteger'].includes(dataType)) return 'number';
  if (dataType === 'date')     return 'date';
  if (dataType === 'datetime') return 'datetime-local';
  if (dataType === 'boolean')  return 'checkbox';
  return 'text';
}

const CURRENCY_TYPES = new Set(['decimal', 'float', 'bigInteger']);

/** The display token for a field — uses FK label if this is a FK field */
function tok(f: TemplateField): string {
  if (f.fk_table && f.fk_label_field) {
    return `\${${f.fk_table}.${f.fk_label_field}}`;
  }
  return CURRENCY_TYPES.has(f.data_type)
    ? `$currency[${f.table_name}.${f.field_name},2]`
    : `\${${f.table_name}.${f.field_name}}`;
}

/** The sort/column ref for a field — points to FK label field for FK fields */
function sortRef(f: TemplateField): string {
  return (f.fk_table && f.fk_label_field)
    ? `${f.fk_table}.${f.fk_label_field}`
    : `${f.table_name}.${f.field_name}`;
}

/**
 * Build all 8 view template slots from field metadata.
 * @param table     Base table info
 * @param fields    All reachable fields (base + joined), with table_name set
 * @param styleHint Optional style keyword ("dark", "orange", "green", "table", etc.)
 */
export function buildStarterTemplates(
  table:     TemplateTable,
  fields:    TemplateField[],
  styleHint: string = '',
  isPublic:  boolean = false,
): ViewTemplates {
  const colorVars = pickColors(styleHint);
  const styleTag  = `<style>:root{${colorVars}}</style>`;
  const tableName = table.label || table.table_name;
  const hint      = styleHint.toLowerCase();
  const useTable  = hint.includes('table') || hint.includes('spreadsheet') || hint.includes('grid');

  const titleField = fields[0];
  const subField   = fields[1];
  const metaField  = fields[2];

  // Title/sub tokens use FK label when available
  const titleTok = titleField ? tok(titleField) : tableName;
  const subTok   = subField   ? tok(subField)   : '';

  // Detail: one .wdp-field per field
  const detailFields = fields.map(f =>
    `<div class="wdp-field"><div class="wdp-field-label">${f.label || f.field_name}</div><div class="wdp-field-value">${tok(f)}</div></div>`
  ).join('');

  // Edit form: only base-table fields (FK fields show the raw ID for editing)
  const formFields = fields.map(f => {
    const valTok = `\${${f.table_name}.${f.field_name}}`;
    if (f.data_type === 'text') {
      return `<div class="wdp-form-group"><label class="wdp-label">${f.label || f.field_name}</label><textarea class="wdp-textarea" name="${f.field_name}">${valTok}</textarea></div>`;
    }
    const itype = inputTypeFor(f.data_type);
    const stepAttr = (itype === 'number' && ['decimal', 'float'].includes(f.data_type)) ? ' step="any"' : '';
    return `<div class="wdp-form-group"><label class="wdp-label">${f.label || f.field_name}</label><input class="wdp-input" type="${itype}"${stepAttr} name="${f.field_name}" value="${valTok}"></div>`;
  }).join('');

  // Create form: only base-table fields
  const createFormFields = fields.map(f => {
    if (f.data_type === 'text') {
      return `<div class="wdp-form-group"><label class="wdp-label">${f.label || f.field_name}</label><textarea class="wdp-textarea" name="${f.field_name}"></textarea></div>`;
    }
    const itype = inputTypeFor(f.data_type);
    const stepAttr = (itype === 'number' && ['decimal', 'float'].includes(f.data_type)) ? ' step="any"' : '';
    return `<div class="wdp-form-group"><label class="wdp-label">${f.label || f.field_name}</label><input class="wdp-input" type="${itype}"${stepAttr} name="${f.field_name}" value=""></div>`;
  }).join('');

  let search_form: string;
  let header: string;
  let row: string;
  let footer: string;

  const addBtn = isPublic ? '' : `<button class="wdp-btn" data-wdp-action="create" style="float:right;margin-top:4px">+ New</button>`;

  // Build $search[] tokens for the fields shown in the row (same slice as the row template uses)
  const rowFieldSlice = useTable ? fields.slice(0, 5) : fields.slice(0, 3);
  const advSearchFields = rowFieldSlice.filter(Boolean);
  const searchTokenLines = advSearchFields.map(f => {
    const ref = (f.fk_table && f.fk_label_field)
      ? `${f.fk_table}.${f.fk_label_field}`
      : `${f.table_name}.${f.field_name}`;
    return `      $search[${ref}]`;
  }).join('\n');

  // Inline toggle handlers — closest('[data-wdp-form]') finds the form without relying on class name
  const onShowAdv    = `event.preventDefault();var s=this.closest('[data-wdp-form]');s.querySelector('.wdp-sf-simple').style.display='none';s.querySelector('.wdp-sf-adv').style.display=''`;
  const onShowSimple = `var s=this.closest('[data-wdp-form]');s.querySelector('.wdp-sf-adv').style.display='none';s.querySelector('.wdp-sf-simple').style.display=''`;

  const advPanel = advSearchFields.length > 0 ? `
  <div class="wdp-sf-adv" style="display:none">
    <div class="wdp-adv-fields">
${searchTokenLines}
    </div>
    <div class="wdp-adv-btns">
      <button type="submit" class="wdp-btn">Search</button>
      <button type="button" class="wdp-adv-link" onclick="${onShowSimple}">&#8593; Simple</button>
      <a data-wdp-action="clear" class="wdp-btn-link">Clear</a>
    </div>
  </div>` : '';

  const advLink = advSearchFields.length > 0
    ? ` <a href="#" class="wdp-adv-link" onclick="${onShowAdv}">Advanced</a>`
    : '';

  if (useTable) {
    const tableHeaders = fields.slice(0, 5).map(f =>
      `<th>$sort[${sortRef(f)},${f.label || f.field_name}]</th>`
    ).join('');
    const tableCells = fields.slice(0, 5).map(f => `<td>${tok(f)}</td>`).join('');

    search_form = `${styleTag}<div class="wdp"><form data-wdp-form="search">
  <div class="wdp-sf wdp-sf-simple">
    <input type="text" name="q" value="\${_q}" placeholder="Search\u2026" class="wdp-input">
    <button type="submit" class="wdp-btn">Search</button> $perpage[10,25,50,100]${advLink}
  </div>${advPanel}
</form>`;
    header      = `<div class="wdp-hdr"><span class="wdp-hdr-title">${tableName}</span><span class="wdp-hdr-meta">\${_total} results</span>${addBtn}</div><table class="wdp-table"><thead><tr>${tableHeaders}</tr></thead><tbody>`;
    row         = `<tr data-wdp-action="detail" data-wdp-id="\${_pk}">${tableCells}</tr>`;
    footer      = `</tbody></table><div class="wdp-footer">\${_pagination}</div></div>`;
  } else {
    const metaTok = metaField ? ` &bull; ${tok(metaField)}` : '';
    search_form = `${styleTag}<div class="wdp"><form data-wdp-form="search">
  <div class="wdp-sf wdp-sf-simple">
    <input type="text" name="q" value="\${_q}" placeholder="Search\u2026" class="wdp-input">
    <button type="submit" class="wdp-btn">Search</button>${advLink}
  </div>${advPanel}
</form>`;
    header      = `<div class="wdp-hdr"><span class="wdp-hdr-title">${tableName}</span><span class="wdp-hdr-meta">\${_total} results</span>${addBtn}</div>`;
    row         = `<div class="wdp-row" data-wdp-action="detail" data-wdp-id="\${_pk}"><div class="wdp-row-body"><div class="wdp-row-title">${titleTok}</div><div class="wdp-row-sub">${subTok}</div><div class="wdp-row-meta">${metaTok}</div></div><span class="wdp-arr">&#8250;</span></div>`;
    footer      = `<div class="wdp-footer">\${_pagination}</div></div>`;
  }

  const editDeleteBtns = isPublic ? '' : `<button class="wdp-btn-secondary" data-wdp-action="edit" data-wdp-id="\${_pk}" style="margin-right:8px">Edit</button><button class="wdp-btn-secondary" data-wdp-action="delete" data-wdp-id="\${_pk}">Delete</button>`;
  const detailActions  = isPublic ? '' : `<div style="float:right">${editDeleteBtns}</div>`;
  const detail      = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Back</button>${detailActions}<h2 class="wdp-detail-title">${titleTok}</h2><div class="wdp-detail-sub">${subTok}</div><div class="wdp-detail-body">${detailFields}</div></div></div>`;
  const edit_form   = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Cancel</button><h2 class="wdp-detail-title">Edit ${tableName}</h2><form data-wdp-form="edit" data-wdp-id="\${_pk}" style="margin-top:16px">${formFields}<button type="submit" class="wdp-btn">Save Changes</button></form></div></div>`;
  const create_form = `${styleTag}<div class="wdp"><div class="wdp-detail"><button class="wdp-back" data-wdp-action="back">&#8249; Cancel</button><h2 class="wdp-detail-title">New ${tableName}</h2><form data-wdp-form="create" style="margin-top:16px">${createFormFields}<button type="submit" class="wdp-btn">Create ${tableName}</button></form></div></div>`;
  const group_header = `<div class="wdp-grp"><span class="wdp-grp-label">\${_group_value}</span><div class="wdp-grp-bar"></div></div>`;

  return { search_form, header, group_header, row, group_footer: '', footer, detail, edit_form, create_form };
}
