import { db } from '../db/knex';
import { getAppDb, castToText } from '../db/adapters/appDb';
import { buildJoinQuery, parseColumnRefs } from './queryBuilder';
import { getRecordMeta, metaToRowKeys } from './recordMeta';
import type { GroupConcatSpec } from './queryBuilder';
import type { App, View, CreateViewInput, UpdateViewInput, UIWidget } from '../domain/types';

// ── Template types ──────────────────────────────────────────────────────────

export const TEMPLATE_TYPES = [
  'search_form',
  'header',
  'group_header',
  'row',
  'group_footer',
  'footer',
  'detail',
  'edit_form',
  'create_form',
] as const;

export type ViewTemplateType = typeof TEMPLATE_TYPES[number];
export type ViewTemplates = Record<ViewTemplateType, string>;

export const TEMPLATE_LABELS: Record<ViewTemplateType, string> = {
  search_form:  'Search Form',
  header:       'Header',
  group_header: 'Group Header',
  row:          'Row',
  group_footer: 'Group Footer',
  footer:       'Footer',
  detail:       'Detail View',
  edit_form:    'Edit Form',
  create_form:  'Create Form',
};

export const DEFAULT_TEMPLATES: ViewTemplates = {
  search_form: `$portal_header
<form data-wdp-form="search" class="wdp-search">
  <input type="text" name="q" value="\${_q}" placeholder="Search…" class="wdp-input">
  <button type="submit" class="wdp-btn">Search</button>
  \${_q ? '<a data-wdp-action="clear" class="wdp-btn-link">Clear</a>' : ''}
</form>`,
  header: `<div class="wdp-header">
  <span class="wdp-count">\${_total} record\${_total == 1 ? '' : 's'}</span>
</div>`,
  group_header: `<div class="wdp-group-header">\${_group_value}</div>`,
  row: `<div class="wdp-row" data-wdp-action="detail" data-wdp-id="\${_pk}" style="cursor:pointer;padding:0.5rem 0;border-bottom:1px solid #eee;">
  Record #\${_pk}
</div>`,
  group_footer: '',
  footer: `<div class="wdp-footer">\${_pagination}</div>
$portal_footer`,
  detail: `<div class="wdp-detail">
  <button data-wdp-action="back" class="wdp-btn-link">&lsaquo; Back</button>
  <div class="wdp-detail-body" style="margin-top:1rem;">
    Record #\${_pk}
  </div>
</div>`,
  edit_form: `<div class="wdp-detail">
  <button data-wdp-action="back" class="wdp-btn-link">&lsaquo; Back</button>
  <form data-wdp-form="edit" data-wdp-id="\${_pk}" style="margin-top:1rem;">
    <p class="wdp-muted" style="font-size:0.85rem;color:#6b7280;">
      Design your edit form here.<br>
      Example: <code>&lt;input name="title" value="&#36;{title}" class="wdp-input"&gt;</code>
    </p>
    <div style="margin-top:1rem;">
      <button type="submit" class="wdp-btn">Save</button>
      <button type="button" data-wdp-action="back" class="wdp-btn-link" style="margin-left:0.5rem;">Cancel</button>
    </div>
  </form>
</div>`,
  create_form: `<div class="wdp-detail">
  <button data-wdp-action="back" class="wdp-btn-link">&lsaquo; Back</button>
  <form data-wdp-form="create" style="margin-top:1rem;">
    <p class="wdp-muted" style="font-size:0.85rem;color:#6b7280;">
      Add your form fields here. Use the Field Tokens panel on the right to insert inputs.
    </p>
    <div style="margin-top:1rem;">
      <button type="submit" class="wdp-btn">Save</button>
      <button type="button" data-wdp-action="back" class="wdp-btn-link" style="margin-left:0.5rem;">Cancel</button>
    </div>
  </form>
</div>`,
};

// ── View CRUD ───────────────────────────────────────────────────────────────

export async function listViews(appId: number): Promise<View[]> {
  return db('views').where({ app_id: appId }).orderBy('label');
}

export async function getView(id: number): Promise<View | undefined> {
  return db('views').where({ id }).first();
}

export async function getViewByName(appId: number, viewName: string): Promise<View | undefined> {
  return db('views').where({ app_id: appId, view_name: viewName }).first();
}

export async function createView(input: CreateViewInput): Promise<View> {
  const [id] = await db('views').insert(input);
  return getView(id) as Promise<View>;
}

export async function updateView(id: number, input: UpdateViewInput): Promise<View> {
  await db('views').where({ id }).update({ ...input, updated_at: new Date().toISOString() });
  return getView(id) as Promise<View>;
}

export async function deleteView(id: number): Promise<void> {
  await db('templates').where({ related_id: id, template_scope: 'view' }).delete();
  await db('views').where({ id }).delete();
}

// ── Template CRUD ───────────────────────────────────────────────────────────

export async function getViewTemplates(appId: number, viewId: number): Promise<ViewTemplates> {
  const rows = await db('templates')
    .where({ app_id: appId, related_id: viewId, template_scope: 'view' })
    .select('template_type', 'content_html');

  const result: ViewTemplates = { ...DEFAULT_TEMPLATES };
  for (const row of rows) {
    if (TEMPLATE_TYPES.includes(row.template_type as ViewTemplateType)) {
      result[row.template_type as ViewTemplateType] = row.content_html;
    }
  }
  return result;
}

export async function saveViewTemplates(
  appId: number,
  viewId: number,
  templates: Partial<ViewTemplates>
): Promise<void> {
  for (const [type, content] of Object.entries(templates)) {
    const existing = await db('templates')
      .where({ app_id: appId, related_id: viewId, template_scope: 'view', template_type: type })
      .first();

    if (existing) {
      await db('templates').where({ id: existing.id }).update({ content_html: content });
    } else {
      await db('templates').insert({
        app_id: appId,
        template_scope: 'view',
        template_type: type,
        related_id: viewId,
        content_html: content ?? '',
      });
    }
  }
}

// ── Group tag parsing ────────────────────────────────────────────────────────

interface GroupTagInfo {
  fullMatch:  string;       // the entire <group ...>...</group> string
  delimiter:  string;       // delimiter= attribute value
  refs:       import('./queryBuilder').ColumnRef[];  // field tokens inside the tag
  separators: string[];     // text fragments between/around tokens
  alias:      string;       // _group_0, _group_1, …
}

const GROUP_TAG_RE = /<group\s+delimiter="([^"]*)">([\s\S]*?)<\/group>/gi;

/**
 * Parse all <group> tags from a combined template string.
 * Assigns stable positional aliases (_group_0, _group_1, …) in order of first appearance.
 */
function parseGroupTags(combined: string): GroupTagInfo[] {
  const tags: GroupTagInfo[] = [];
  const seen = new Map<string, string>(); // fullMatch → alias

  for (const m of combined.matchAll(new RegExp(GROUP_TAG_RE.source, 'gi'))) {
    if (seen.has(m[0])) continue;
    const alias = `_group_${tags.length}`;
    seen.set(m[0], alias);

    const inner = m[2];
    const tokenRe = /\$\{([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\}/gi;
    const refs: import('./queryBuilder').ColumnRef[] = [];
    const separators: string[] = [];
    let lastEnd = 0;

    for (const tm of inner.matchAll(new RegExp(tokenRe.source, 'gi'))) {
      separators.push(inner.slice(lastEnd, tm.index!));
      refs.push({ table: tm[1].toLowerCase(), field: tm[2].toLowerCase() });
      lastEnd = tm.index! + tm[0].length;
    }
    separators.push(inner.slice(lastEnd));

    tags.push({ fullMatch: m[0], delimiter: m[1], refs, separators, alias });
  }
  return tags;
}

/**
 * Build a GROUP_CONCAT SQL expression for one <group> tag.
 * Separators between tokens are included only when the preceding field is non-empty,
 * so absent values don't leave double-spaces.
 */
function buildGroupConcatExpr(
  refs: import('./queryBuilder').ColumnRef[],
  separators: string[],
  delimiter: string
): string {
  if (refs.length === 0) return "''";

  const esc = (s: string) => s.replace(/'/g, "''");
  const parts: string[] = [];

  // separators[0] = text before first token (prefix — usually empty)
  if (separators[0]) parts.push(`'${esc(separators[0])}'`);

  for (let i = 0; i < refs.length; i++) {
    const col      = `"${refs[i].table}"."${refs[i].field}"`;
    const followSep = separators[i + 1] ?? '';

    if (followSep) {
      // Append the separator string only when this field is non-empty
      parts.push(`COALESCE(NULLIF(${col}, '') || '${esc(followSep)}', '')`);
    } else {
      parts.push(`COALESCE(${col}, '')`);
    }
  }

  const expr     = parts.join(' || ');
  const safeDelim = esc(delimiter);
  return `NULLIF(TRIM(GROUP_CONCAT(TRIM(${expr}), '${safeDelim}')), '')`;
}

/**
 * Replace every <group> tag in a single template string with its ${_group_N} alias.
 * Call this on each template before renderTokens so the alias is resolved normally.
 */
function applyGroupTags(template: string, tags: GroupTagInfo[]): string {
  let out = template;
  for (const tag of tags) {
    // replaceAll-safe: escape special regex chars in fullMatch
    out = out.split(tag.fullMatch).join(`\${${tag.alias}}`);
  }
  return out;
}

// ── SQL generation ──────────────────────────────────────────────────────────

/**
 * Extract column aliases from a custom SQL string.
 * Matches: AS "alias", AS alias, AS `alias`
 * Used to validate which columns are safe to reference in the outer WHERE clause.
 */
function extractSqlAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  const re = /\bAS\s+(?:"([^"]+)"|`([^`]+)`|'([^']+)'|([a-z_][a-z0-9_]*))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const alias = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').toLowerCase();
    if (alias) aliases.add(alias);
  }
  return aliases;
}

/**
 * Parse ${table.field} tokens from view templates, ignoring system ${_*} tokens
 * and tokens that live inside <group> tags (those are handled by GROUP_CONCAT).
 */
export function parseViewTokens(templates: Partial<ViewTemplates>) {
  let combined = Object.values(templates).filter(Boolean).join('\n');
  // Strip group-tag content so those tokens don't end up in the plain SELECT
  combined = combined.replace(new RegExp(GROUP_TAG_RE.source, 'gi'), '');

  // Only extract table.field refs from INSIDE actual token delimiters:
  //   ${table.field}  and  $update[table.field] / $search[table.field]
  // This prevents plain-text mentions of "table.field" in comments or
  // instructional placeholder text from being treated as real column refs.
  const tokenContents: string[] = [];
  let m: RegExpExecArray | null;
  const curlyRe  = /\$\{([^}]+)\}/g;
  const bracketRe = /\$(?:update|search|thumbnail|img|sort|currency|perpage)\[([^\]]+)\]/g;
  while ((m = curlyRe.exec(combined))   !== null) tokenContents.push(m[1]);
  while ((m = bracketRe.exec(combined)) !== null) tokenContents.push(m[1]);

  return parseColumnRefs(tokenContents.join('\n')).filter(r => !r.table.startsWith('_'));
}

const TEMPLATE_DISPLAY_NAMES: Record<string, string> = {
  search_form:  'Search Form',
  header:       'Header',
  group_header: 'Group Header',
  row:          'Row',
  group_footer: 'Group Footer',
  footer:       'Footer',
  detail:       'Detail View',
  edit_form:    'Edit Form',
  create_form:  'Create Form',
};

/** Build a map of table name → { templateName, lineNumber } for error reporting */
function buildTokenSourceMap(templates: Partial<ViewTemplates>): Map<string, { templateName: string; lineNumber: number }> {
  const sourceMap = new Map<string, { templateName: string; lineNumber: number }>();
  const tokenRe = /\$\{([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\}/gi;

  for (const [key, content] of Object.entries(templates)) {
    if (!content) continue;
    const displayName = TEMPLATE_DISPLAY_NAMES[key] ?? key;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let m: RegExpExecArray | null;
      tokenRe.lastIndex = 0;
      while ((m = tokenRe.exec(lines[i])) !== null) {
        const tableName = m[1];
        if (!tableName.startsWith('_') && !sourceMap.has(tableName)) {
          sourceMap.set(tableName, { templateName: displayName, lineNumber: i + 1 });
        }
      }
    }
  }
  return sourceMap;
}

export async function generateViewSql(
  appId: number,
  baseTableName: string,
  templates: Partial<ViewTemplates>
): Promise<string> {
  const combined  = Object.values(templates).filter(Boolean).join('\n');
  const groupTags = parseGroupTags(combined);

  // Regular tokens (outside <group> tags)
  const regularTokens = parseViewTokens(templates);

  // Group-tag tokens are needed for JOIN path finding but not the plain SELECT
  const groupTokens = groupTags.flatMap(g => g.refs);

  // Merge all unique refs for join path resolution
  const seen = new Set<string>();
  const allTokens = [...regularTokens, ...groupTokens].filter(t => {
    const k = `${t.table}.${t.field}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });

  // Filter out any refs that correspond to gallery tables (e.g. $thumbnail[products.photos]
  // where products_photos is a gallery table — the field is not a real column).
  const galleryTableNames = await db('app_tables')
    .where({ app_id: appId, is_gallery: true })
    .pluck('table_name') as string[];
  const galleryTableSet = new Set(galleryTableNames);

  // Filter out any refs whose table is declared as an owner table via $owner[table.field].
  // Those are pre-fetched via _wdpro_metadata linkage in prefetchOwnerFields() — they do NOT
  // need a SQL JOIN and will throw "No join path found" if included.
  const ownerTableSet = new Set<string>();
  const ownerPat = /\$owner\[([^\]]+)\]/g;
  let ownerM: RegExpExecArray | null;
  while ((ownerM = ownerPat.exec(combined)) !== null) {
    const ref = ownerM[1].trim();
    const dot = ref.lastIndexOf('.');
    if (dot !== -1) ownerTableSet.add(ref.slice(0, dot));
  }

  const filteredTokens = allTokens.filter(
    t => !galleryTableSet.has(`${t.table}_${t.field}`) && !ownerTableSet.has(t.table)
  );

  // Always include the base table's PK
  const pkField = await db('app_fields')
    .join('app_tables', 'app_fields.table_id', 'app_tables.id')
    .where({ 'app_tables.app_id': appId, 'app_tables.table_name': baseTableName, 'app_fields.is_primary_key': true })
    .select('app_fields.field_name')
    .first();

  const tokensForQuery = filteredTokens;
  if (pkField) {
    const pkRef = { table: baseTableName, field: pkField.field_name as string };
    if (!tokensForQuery.some(t => t.table === pkRef.table && t.field === pkRef.field))
      tokensForQuery.unshift(pkRef);
  }

  if (tokensForQuery.length === 0) return `SELECT *\nFROM "${baseTableName}"`;

  // Build GROUP_CONCAT specs from <group> tags
  const groupConcatSpecs: GroupConcatSpec[] = groupTags.map(tag => ({
    alias: tag.alias,
    expr:  buildGroupConcatExpr(tag.refs, tag.separators, tag.delimiter),
  }));

  // Build source map for error enrichment
  const sourceMap = buildTokenSourceMap(templates);

  try {
    const result = await buildJoinQuery(
      appId, baseTableName, tokensForQuery,
      groupConcatSpecs.length ? groupConcatSpecs : undefined
    );
    return result.sql;
  } catch (err: any) {
    // Enrich "No join path" errors with the template name and line number
    const match = err.message?.match(/No join path found from "[^"]+" to "([^"]+)"/);
    if (match) {
      const badTable = match[1];
      const source = sourceMap.get(badTable);
      if (source) {
        throw new Error(
          `${err.message}\n(Token \${${badTable}.*} found in "${source.templateName}" template, line ${source.lineNumber})`
        );
      }
    }
    throw err;
  }
}

// ── Token rendering ─────────────────────────────────────────────────────────

// ── $if() helpers ────────────────────────────────────────────────────────────

function resolveField(name: string, data: Record<string, unknown>): unknown {
  if (name in data) return data[name];
  if (name.includes('.')) {
    const alias = name.replace('.', '__');
    if (alias in data) return data[alias];
  }
  return undefined;
}

/** Split `s` by commas at depth-0 (not inside parens or quote pairs). */
function splitIfArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c; cur += c;
    } else if (c === '(' || c === '[') {
      depth++; cur += c;
    } else if (c === ')' || c === ']') {
      depth--; cur += c;
    } else if (c === ',' && depth === 0) {
      parts.push(cur.trim()); cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur.trim());
  return parts;
}

function stripBranchQuotes(s: string): string {
  if (s.length >= 2 &&
      ((s[0] === '"' && s[s.length - 1] === '"') ||
       (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const IF_CMP_RE = /^(.+?)\s*(>=|<=|!=|<>|>|<|==|=)\s*(.+)$/s;

function evalIfCondition(condition: string, data: Record<string, unknown>): boolean {
  const m = condition.trim().match(IF_CMP_RE);
  if (!m) {
    // No operator — simple truthiness check on the field value
    const val = resolveField(condition.trim(), data);
    return val !== undefined && val !== null && val !== '' && val !== '0' && val !== 0;
  }
  const [, leftRaw, op, rightRaw] = m;
  const rawLeft    = resolveField(leftRaw.trim(), data);
  const leftStr    = String(rawLeft ?? '');
  const rightStr   = stripBranchQuotes(rightRaw.trim());
  const leftNum    = parseFloat(leftStr);
  const rightNum   = parseFloat(rightStr);
  const numericCmp = !isNaN(leftNum) && !isNaN(rightNum);
  const lv = numericCmp ? leftNum  : leftStr.toLowerCase();
  const rv = numericCmp ? rightNum : rightStr.toLowerCase();
  switch (op) {
    case '>':          return lv >  rv;
    case '<':          return lv <  rv;
    case '>=':         return lv >= rv;
    case '<=':         return lv <= rv;
    case '=': case '==': return lv == rv;  // eslint-disable-line eqeqeq
    case '!=': case '<>': return lv != rv; // eslint-disable-line eqeqeq
    default:           return false;
  }
}

/**
 * Replace `$if(condition, trueVal[, falseVal])` tags in `template`.
 * Runs before ${...} substitution so branches can themselves contain tokens.
 * Branch values may optionally be wrapped in single or double quotes.
 * Example: $if(books.price > 30, "<b>Free shipping</b>", "No free shipping")
 */
function processIfTags(template: string, data: Record<string, unknown>): string {
  const TAG = '$if(';
  let result = '';
  let i = 0;
  while (i < template.length) {
    const idx = template.indexOf(TAG, i);
    if (idx === -1) { result += template.slice(i); break; }
    result += template.slice(i, idx);
    // Find the matching closing paren
    let depth = 1;
    let j = idx + TAG.length;
    let inStr: string | null = null;
    while (j < template.length && depth > 0) {
      const c = template[j];
      if (inStr) {
        if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c;
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        if (--depth === 0) break;
      }
      j++;
    }
    if (depth !== 0) { result += TAG; i = idx + TAG.length; continue; }
    const inner   = template.slice(idx + TAG.length, j);
    const args    = splitIfArgs(inner);
    const trueVal  = stripBranchQuotes(args[1] ?? '');
    const falseVal = stripBranchQuotes(args[2] ?? '');
    result += evalIfCondition(args[0] ?? '', data) ? trueVal : falseVal;
    i = j + 1;
  }
  return result;
}

/**
 * Convert <<<WDP:REVIEW ...>>> markers left by field delete/rename into
 * visible orange warning boxes in the rendered output.
 */
export function renderReviewMarkers(html: string): string {
  return html.replace(
    /<<<WDP:REVIEW ([^>]+)>>>/g,
    '<div class="wdp-review-marker">&#9888; Review needed: $1</div>',
  );
}

export function renderTokens(template: string, data: Record<string, unknown>): string {
  // $portal_header / $portal_footer → pre-rendered portal nav HTML (empty if not in member context)
  let result = template
    .replace(/\$portal_header/g, () => String(data['_portal_header'] ?? ''))
    .replace(/\$portal_footer/g, () => String(data['_portal_footer'] ?? ''));

  // $owner[table.field] → value from the record owner's profile in another table
  // (pre-fetched via _wdpro_metadata created_by_id linkage into _owner__table__field keys)
  result = result.replace(/\$owner\[([^\]]+)\]/g, (_, ref: string) => {
    ref = ref.trim();
    const dot = ref.lastIndexOf('.');
    if (dot === -1) return '';
    const tbl = ref.slice(0, dot);
    const fld = ref.slice(dot + 1);
    return String(data[`_owner__${tbl}__${fld}`] ?? '');
  });

  // $gallery[tableName] → photo gallery widget (self-initializing)
  result = result.replace(/\$gallery\[([^\]]+)\]/g, (_, tableName: string) => {
    tableName = tableName.trim();
    const appSlug = String(data['_app_slug'] ?? '');
    const recordId = String(data['_pk'] ?? '');
    // Use a stable ID so the inline script can find the div reliably regardless
    // of whether document.currentScript is available (it may be null in dynamic contexts).
    const galleryId = `wdpg-${appSlug}-${tableName}-${recordId}`.replace(/[^a-z0-9-_]/gi, '-');
    const init = `(function(){` +
      `function tryInit(){var el=document.getElementById(${JSON.stringify(galleryId)});` +
      `if(el&&!el.dataset.wdpGalleryInit&&window.WDPGallery)window.WDPGallery.init(el.parentNode);}` +
      `tryInit();setTimeout(tryInit,250);})()`;
    return `<div id="${galleryId}" class="wdp-gallery" data-wdp-gallery="${tableName}" data-app="${appSlug}" data-record="${recordId}"></div>` +
      `<scr` + `ipt>${init}</scr` + `ipt>`;
  });

  // $thumbnail[table.field] → <img src="/files/...?thumb=1" width="100"> (thumbnail)
  // When the field is empty, renders a "No Image" placeholder with a subtle diagonal-stripe pattern.
  result = result.replace(/\$thumbnail\[([^\]]+)\]/g, (_, ref: string) => {
    const alias = ref.replace('.', '__');
    const val   = String(data[alias] ?? data[ref] ?? data[`_owner__${alias}`] ?? '');
    if (!val) return (
      `<div style="width:100px;height:100px;border-radius:4px;display:inline-flex;` +
      `align-items:center;justify-content:center;` +
      `background:#d8d8d8;` +
      `background-image:repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(0,0,0,0.06) 8px,rgba(0,0,0,0.06) 9px);` +
      `vertical-align:middle;">` +
      `<span style="font-family:sans-serif;font-size:10px;color:#bcbcbc;letter-spacing:0.06em;` +
      `user-select:none;pointer-events:none;">No Image</span>` +
      `</div>`
    );
    return `<img src="/files/${val}?thumb=1" width="100" style="border-radius:4px;" alt="">`;
  });

  // $img[table.field] → <img src="/files/..."> (full image)
  result = result.replace(/\$img\[([^\]]+)\]/g, (_, ref: string) => {
    const alias = ref.replace('.', '__');
    const val   = String(data[alias] ?? data[ref] ?? data[`_owner__${alias}`] ?? '');
    if (!val) return '';
    return `<img src="/files/${val}" style="max-width:100%;" alt="">`;
  });

  // $currency[table.field] or $currency[table.field,2] → comma-formatted number
  result = result.replace(/\$currency\[([^\]]+)\]/g, (_, ref: string) => {
    const parts      = ref.split(',').map((s: string) => s.trim());
    const fieldRef   = parts[0];
    const decimals   = parts[1] !== undefined ? parseInt(parts[1], 10) : undefined;
    const alias      = fieldRef.replace('.', '__');
    const raw        = data[alias] ?? data[fieldRef];
    if (raw === null || raw === undefined || raw === '') return '';
    const num = parseFloat(String(raw));
    if (isNaN(num)) return String(raw);
    return decimals !== undefined
      ? num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : num.toLocaleString('en-US');
  });

  // $sort[table.field] or $sort[table.field,Label] → sortable column header button
  result = result.replace(/\$sort\[([^\]]+)\]/g, (_, ref: string) => {
    const parts    = ref.split(',').map((s: string) => s.trim());
    const fieldRef = parts[0];
    const label    = parts[1] ?? fieldRef.split('.').pop() ?? fieldRef;
    const alias    = fieldRef.replace('.', '__');
    const curSort  = String(data['_sort'] ?? '');
    const curDir   = String(data['_dir']  ?? 'asc');
    const isActive = curSort === alias || curSort === fieldRef;
    const arrow    = isActive ? (curDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';
    return `<button data-wdp-action="sort" data-wdp-field="${alias}" class="wdp-sort-btn${isActive ? ' wdp-sort-active' : ''}" style="background:none;border:none;cursor:pointer;padding:0;font-weight:inherit;">${label}${arrow}</button>`;
  });

  // $perpage[10,20,50,100] → per-page selector (options list required)
  result = result.replace(/\$perpage\[([^\]]+)\]/g, (_, ref: string) => {
    const options  = ref.split(',').map((s: string) => parseInt(s.trim(), 10)).filter(n => n > 0);
    const current  = Number(data['_per_page'] ?? data['_page_size'] ?? options[0]);
    const opts     = options.map(n => `<option value="${n}"${n === current ? ' selected' : ''}>${n} per page</option>`).join('');
    return `<select data-wdp-action="per-page" class="wdp-per-page-select">${opts}</select>`;
  });

  const afterIf = processIfTags(result, data);
  return afterIf.replace(/\$\{([^}]+)\}/g, (_, token: string) => {
    if (token in data) return String(data[token] ?? '');
    if (token.includes('.')) {
      const alias = token.replace('.', '__');
      if (alias in data) return String(data[alias] ?? '');
    }
    return '';
  });
}

function buildPageSet(current: number, total: number): (number | '...')[] {
  if (total <= 1) return [];
  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  // Sequential neighbourhood ±5
  for (let i = Math.max(1, current - 5); i <= Math.min(total, current + 5); i++) pages.add(i);
  // Expanding jumps forward and backward
  for (const step of [5, 10, 15, 25, 50, 100, 200, 300, 500]) {
    const fwd = current + step, bwd = current - step;
    if (fwd <= total) pages.add(fwd);
    if (bwd >= 1)     pages.add(bwd);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | '...')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

function buildPaginationHtml(page: number, totalPages: number, perPage?: number, perPageOptions?: number[]): string {
  if (totalPages <= 1 && !perPageOptions?.length) return '';
  const pageNums = buildPageSet(page, totalPages);

  const pageBtns = pageNums.map(p =>
    p === '...'
      ? `<span class="wdp-page-ellipsis">…</span>`
      : p === page
        ? `<button class="wdp-page-btn wdp-page-current" disabled>${p}</button>`
        : `<button data-wdp-action="page" data-wdp-page="${p}" class="wdp-page-btn">${p}</button>`
  ).join(' ');

  let perPageHtml = '';
  if (perPageOptions && perPageOptions.length > 0 && perPage) {
    const opts = perPageOptions.map(n =>
      `<option value="${n}"${n === perPage ? ' selected' : ''}>${n}</option>`
    ).join('');
    perPageHtml = `<select data-wdp-action="per-page" class="wdp-per-page-select">${opts}</select>`;
  }

  return `<div class="wdp-pagination">${pageBtns}${perPageHtml ? ' ' + perPageHtml : ''}</div>`;
}

// ── Gallery thumbnail pre-fetch ─────────────────────────────────────────────

/**
 * For any $thumbnail[table.field] tokens in `templateText` where the referenced
 * field is actually a gallery table (not a direct column), batch-fetch the first
 * photo file_path for each record ID and return a map of:
 *   alias (e.g. "products__photos") → Map<recordId, file_path>
 *
 * Uses a LEFT JOIN anti-pattern to pick the row with the lowest (sort_order, id)
 * per record, which works in both SQLite and MySQL without window functions.
 */
async function prefetchGalleryThumbnails(
  app: { id: number; database_mode?: string },
  appDb: ReturnType<typeof getAppDb>,
  templateText: string,
  recordIds: string[],
  existingKeys: Set<string>,
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  if (!recordIds.length || !templateText) return result;

  const thumbnailRefs = [...templateText.matchAll(/\$thumbnail\[([^\]]+)\]/g)].map(m => m[1].trim());

  for (const ref of thumbnailRefs) {
    const alias = ref.replace('.', '__');
    if (existingKeys.has(alias) || existingKeys.has(ref)) continue; // direct column exists

    const dotIdx = ref.indexOf('.');
    if (dotIdx === -1) continue;
    const refTable = ref.slice(0, dotIdx);
    const refField = ref.slice(dotIdx + 1);
    const galleryTableName = `${refTable}_${refField}`;

    const galleryMeta = await db('app_tables')
      .where({ app_id: app.id, table_name: galleryTableName, is_gallery: true })
      .first();
    if (!galleryMeta) continue;

    try {
      const placeholders = recordIds.map(() => '?').join(',');
      const sql =
        `SELECT p1.record_id, p1.file_path` +
        ` FROM "${galleryTableName}" AS p1` +
        ` LEFT JOIN "${galleryTableName}" AS p2` +
        `   ON p2.record_id = p1.record_id` +
        `   AND (p2.sort_order < p1.sort_order OR (p2.sort_order = p1.sort_order AND p2.id < p1.id))` +
        ` WHERE p1.record_id IN (${placeholders}) AND p2.id IS NULL`;

      const raw = await appDb.raw(sql, recordIds);
      const photoRows: Array<{ record_id: string | number; file_path: string }> =
        app.database_mode === 'mysql'
          ? (raw as [Array<{ record_id: string | number; file_path: string }>, unknown])[0]
          : (raw as Array<{ record_id: string | number; file_path: string }>);

      const photoMap = new Map<string, string>();
      for (const pr of photoRows) {
        photoMap.set(String(pr.record_id), pr.file_path);
      }
      result.set(alias, photoMap);
    } catch {
      /* non-fatal: gallery table may be empty or temporarily unavailable */
    }
  }

  return result;
}

/**
 * Pre-fetches fields from "owner" tables linked via _wdpro_metadata.created_by_id.
 *
 * Join path: source record → _wdpro_metadata (source) → created_by_id
 *            → _wdpro_metadata (owner table) → record_id → owner table row
 *
 * Triggered by $owner[ownerTable.field] tokens in the template.
 * $thumbnail[ownerTable.field] and $img[ownerTable.field] are also fetched
 * for tables already declared as owner tables by a $owner[...] token.
 *
 * Returns Map<sourceRecordId, { _owner__table__field: value, ... }>
 */
async function prefetchOwnerFields(
  app: App,
  appDb: ReturnType<typeof getAppDb>,
  templateText: string,
  baseTableName: string,
  recordIds: string[],
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (!recordIds.length) return result;

  // Collect $owner[table.field] refs — these declare which tables are "owner tables"
  const refsByTable = new Map<string, Set<string>>();
  const ownerPat = /\$owner\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = ownerPat.exec(templateText)) !== null) {
    const ref = m[1].trim();
    const dot = ref.lastIndexOf('.');
    if (dot === -1) continue;
    const tbl = ref.slice(0, dot);
    const fld = ref.slice(dot + 1);
    if (!refsByTable.has(tbl)) refsByTable.set(tbl, new Set());
    refsByTable.get(tbl)!.add(fld);
  }
  if (!refsByTable.size) return result;

  // Also pull in $thumbnail[ownerTable.field] / $img[ownerTable.field] for declared owner tables
  const thumbImgPat = /\$(?:thumbnail|img)\[([^\]]+)\]/g;
  while ((m = thumbImgPat.exec(templateText)) !== null) {
    const ref = m[1].trim().split(',')[0].trim();
    const dot = ref.lastIndexOf('.');
    if (dot === -1) continue;
    const tbl = ref.slice(0, dot);
    const fld = ref.slice(dot + 1);
    if (refsByTable.has(tbl)) refsByTable.get(tbl)!.add(fld);
  }

  for (const [ownerTable, fields] of refsByTable) {
    const ownerTableMeta = await db('app_tables')
      .where({ app_id: app.id, table_name: ownerTable })
      .first();
    if (!ownerTableMeta) continue;

    const ownerPkRow = await db('app_fields')
      .where({ table_id: ownerTableMeta.id, is_primary_key: true })
      .first();
    const ownerPk = ownerPkRow?.field_name ?? 'id';

    const isMysql = app.database_mode === 'mysql';
    const q = isMysql ? '`' : '"'; // identifier quote char
    // For MySQL: compare as unsigned int to avoid collation mismatches between
    // the integer PK and the varchar record_id column in _wdpro_metadata.
    // For SQLite: CAST to TEXT for string comparison (record_id is TEXT).
    const castPk = isMysql
      ? `ot.${q}${ownerPk}${q}`
      : `CAST(ot.${q}${ownerPk}${q} AS TEXT)`;

    const fieldList = [...fields]
      .map(f => `ot.${q}${f}${q} AS ${q}${ownerTable}__${f}${q}`)
      .join(', ');
    const placeholders = recordIds.map(() => '?').join(',');

    try {
      const sql =
        `SELECT pm.record_id AS _src_id, ${fieldList}` +
        ` FROM ${q}_wdpro_metadata${q} AS pm` +
        ` INNER JOIN ${q}_wdpro_metadata${q} AS rm` +
        `   ON rm.created_by_id = pm.created_by_id AND rm.table_name = ?` +
        ` INNER JOIN ${q}${ownerTable}${q} AS ot` +
        `   ON ${castPk} = ${isMysql ? 'CAST(rm.record_id AS UNSIGNED)' : 'rm.record_id'}` +
        ` WHERE pm.table_name = ? AND pm.record_id IN (${placeholders})`;

      const raw = await appDb.raw(sql, [ownerTable, baseTableName, ...recordIds]);
      const rows: Record<string, unknown>[] = app.database_mode === 'mysql'
        ? (raw as [Record<string, unknown>[], unknown])[0]
        : (raw as Record<string, unknown>[]);

      for (const row of rows) {
        const srcId = String(row['_src_id'] ?? '');
        if (!srcId) continue;
        if (!result.has(srcId)) result.set(srcId, {});
        const entry = result.get(srcId)!;
        for (const fld of fields) {
          entry[`_owner__${ownerTable}__${fld}`] = String(row[`${ownerTable}__${fld}`] ?? '');
        }
      }
    } catch {
      // _wdpro_metadata or owner table may not exist yet — silently skip
    }
  }

  return result;
}

// ── View rendering ──────────────────────────────────────────────────────────

export interface RenderParams {
  q?: string;
  page?: number;
  perPage?: number;   // user-requested page size; falls back to view.page_size
  sort?: string;
  dir?: 'asc' | 'desc';
  searchOnly?: boolean;
  fieldFilters?: Record<string, string>;  // "table__field" → value
  ownerId?: number;                        // set to filter results to records owned by this member
  portalHeader?: string;                   // pre-rendered HTML for $portal_header token
  portalFooter?: string;                   // pre-rendered HTML for $portal_footer token
  sqlCapture?: string[];                   // if provided, the final data SQL (with values interpolated) is pushed here
}

export async function renderViewList(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  params: RenderParams
): Promise<string> {
  const appDb    = getAppDb(app);
  const page     = Math.max(1, params.page ?? 1);
  const pageSize = view.pagination_enabled
    ? Math.min(500, Math.max(1, params.perPage ?? view.page_size ?? 25))
    : 10000;
  const offset   = (page - 1) * pageSize;

  // Load pk field for the base table
  const pkField = await db('app_fields')
    .where({ table_id: view.base_table_id, is_primary_key: true })
    .first();
  const pkName = pkField?.field_name ?? 'id';

  // Pre-process <group> tags: replace each tag with its ${_group_N} alias so
  // renderTokens can resolve it from the GROUP_CONCAT column in the SQL result.
  // Custom SQL bypasses group tag SQL generation but tags are still stripped from templates.
  const combinedForGroups = Object.values(templates).filter(Boolean).join('\n');
  const groupTags         = parseGroupTags(combinedForGroups);
  const tpl = groupTags.length
    ? (Object.fromEntries(
        Object.entries(templates).map(([k, v]) => [k, v ? applyGroupTags(v, groupTags) : v])
      ) as ViewTemplates)
    : templates;

  // Search-only mode: return just the search form, skip all DB work
  if (params.searchOnly && !(params.q?.trim())) {
    const sys = { _q: '', _page: 1, _total: 0, _total_pages: 0,
                  _has_prev: '', _has_next: '', _prev_page: 1, _next_page: 1,
                  _sort: '', _dir: 'asc', _pagination: '' };
    const searchFormTpl = await renderWidgetTokens(tpl.search_form, app.id, {}, 'search');
    return renderTokens(searchFormTpl, sys);
  }

  // Build base SQL
  let baseSql: string;
  if (view.query_mode === 'advanced_sql' && view.custom_sql) {
    baseSql = view.custom_sql;
  } else {
    baseSql = await generateViewSql(app.id, baseTableName, templates);
  }

  // Determine sort — for auto SQL the columns are aliased as table__field,
  // so we must prefix the sort/group field names with the base table name.
  // Meta sort fields (_meta__created_at etc.) come from _wdpro_metadata and are never prefixed.
  // Sort buttons generate alias-format sort params (e.g. "items__genre_id") while
  // view.primary_sort_field stores bare field names (e.g. "genre_id"). Normalise to bare name first.
  const META_SORT = new Set(['_meta__created_at', '_meta__updated_at', '_meta__created_by']);
  const isAuto = view.query_mode !== 'advanced_sql';

  // Normalise a raw sort/group field to its SQL alias form.
  // - Meta sorts (_meta__*) are passed through unchanged.
  // - Fields that already contain __ are already full aliases (e.g. "genres__name"
  //   from a sort button on a joined column) — use them as-is.
  // - Bare field names (e.g. "title", "genre_id" from view.primary_sort_field)
  //   need the base-table prefix prepended.
  const toAlias = (raw: string): string => {
    if (META_SORT.has(raw)) return raw;
    if (!isAuto) return raw;
    return raw.includes('__') ? raw : `${baseTableName}__${raw}`;
  };

  const rawSort  = params.sort ?? view.primary_sort_field ?? null;
  const isMetaSort = rawSort ? META_SORT.has(rawSort) : false;
  const sortField = rawSort ? toAlias(rawSort) : null;
  const sortDir   = (params.dir ?? view.primary_sort_direction ?? 'asc').toUpperCase();
  const rawSecondary = view.secondary_sort_field ?? null;
  const secondarySort = rawSecondary ? toAlias(rawSecondary) : null;
  const rawGroup = view.grouping_field ?? null;
  const groupField = rawGroup ? toAlias(rawGroup) : null;

  // Wrap for search + sort + count
  const q            = params.q?.trim() ?? '';
  const fieldFilters = params.fieldFilters ?? {};
  const whereParts:  string[] = [];
  const bindings:    string[] = [];

  // Global keyword search across all text/string columns.
  // Works in both automatic and advanced_sql modes — advanced SQL must use table__field aliases
  // (the documented convention) for the WHERE clause to reference them correctly.
  if (q) {
    const tokens = parseViewTokens(templates);
    const combined = Object.values(templates).filter(Boolean).join('\n');
    const groupTagsList = parseGroupTags(combined);

    // Columns inside <group> tags are folded into a GROUP_CONCAT alias in the outer
    // query — they no longer exist as individual columns. Skip them and search the
    // alias (e.g. "_group_0") instead, which contains the concatenated text.
    const groupedColKeys = new Set(
      groupTagsList.flatMap(g => g.refs.map(r => `${r.table}.${r.field}`))
    );

    const fieldMeta = await db('app_fields')
      .whereIn('table_id', await db('app_tables').where({ app_id: app.id }).pluck('id'))
      .select('field_name', 'data_type', 'is_indexed', 'is_fulltext_indexed');
    const textTypes    = new Set(['text', 'varchar', 'char', 'string', 'json']);
    const fieldTypeMap    = new Map(fieldMeta.map((f: { field_name: string; data_type: string }) => [f.field_name, f.data_type]));
    const fieldIndexMap   = new Map(fieldMeta.map((f: { field_name: string; is_indexed: boolean }) => [f.field_name, !!f.is_indexed]));
    const fieldFtMap      = new Map(fieldMeta.map((f: { field_name: string; is_fulltext_indexed: boolean }) => [f.field_name, !!f.is_fulltext_indexed]));

    // In advanced_sql mode, only search columns that are actually aliased in the custom SQL.
    // Template tokens can reference computed/display-only fields that aren't in the SELECT.
    const customSqlAliases: Set<string> | null =
      view.query_mode === 'advanced_sql' && view.custom_sql
        ? extractSqlAliases(view.custom_sql)
        : null;

    const regularTokens = tokens
      .filter(t => !groupedColKeys.has(`${t.table}.${t.field}`))
      .filter(t => textTypes.has((fieldTypeMap.get(t.field) ?? 'text').toLowerCase()))
      .filter(t => !customSqlAliases || customSqlAliases.has(`${t.table}__${t.field}`));

    // Classify tokens: fulltext (MySQL MATCH...AGAINST), exact (indexed), or LIKE
    const isMysql = app.database_mode === 'mysql';
    const fulltextTokens = isMysql ? regularTokens.filter(t => fieldFtMap.get(t.field)) : [];
    const nonFtTokens    = regularTokens.filter(t => !isMysql || !fieldFtMap.get(t.field));
    const exactCols = nonFtTokens.filter(t =>  fieldIndexMap.get(t.field)).map(t => `"${t.table}__${t.field}"`);
    const likeCols  = nonFtTokens.filter(t => !fieldIndexMap.get(t.field)).map(t => `"${t.table}__${t.field}"`);

    // GROUP_CONCAT aliases are plain text — safe to LIKE search
    const groupAliasCols = groupTagsList.map(g => `"${g.alias}"`);
    const allLikeCols = [...likeCols, ...groupAliasCols];

    const searchParts: string[] = [];
    if (exactCols.length > 0) {
      searchParts.push(...exactCols.map(c => `${c} = ?`));
      bindings.push(...Array(exactCols.length).fill(q));
    }
    if (allLikeCols.length > 0) {
      searchParts.push(...allLikeCols.map(c => `${c} LIKE ?`));
      bindings.push(...Array(allLikeCols.length).fill(`%${q}%`));
    }
    // Fulltext fields: correlated EXISTS so MATCH...AGAINST runs on the original indexed column
    for (const t of fulltextTokens) {
      searchParts.push(
        `EXISTS (SELECT 1 FROM \`${t.table}\` WHERE \`${t.table}\`.\`id\` = _v."${t.table}__id" AND MATCH(\`${t.table}\`.\`${t.field}\`) AGAINST(? IN BOOLEAN MODE))`
      );
      bindings.push(q);
    }
    if (searchParts.length > 0) {
      whereParts.push(`(${searchParts.join(' OR ')})`);
    }
  }

  // Per-field filters from $search[...] inputs ("table__field" → value)
  // Supports operator prefixes: >=, <=, >, <, = (exact), and range syntax "a..b"
  // Bare values use = for indexed fields, LIKE %value% otherwise.
  {
    const filterEntries = Object.entries(fieldFilters).filter(([, v]) => v.trim());
    if (filterEntries.length > 0) {
      // One batch lookup to find which fields are indexed
      const filterMeta = await db('app_fields')
        .whereIn('table_id', await db('app_tables').where({ app_id: app.id }).pluck('id'))
        .select('field_name', 'is_indexed');
      const filterIndexMap = new Map(
        filterMeta.map((f: { field_name: string; is_indexed: boolean }) => [f.field_name, !!f.is_indexed])
      );

      for (const [col, val] of filterEntries) {
        const v = val.trim();
        const qcol = `"${col}"`;
        // col is "table__field"; extract just the field name for the index lookup
        const bareField = col.includes('__') ? col.split('__').slice(1).join('__') : col;
        const isIndexed = filterIndexMap.get(bareField) ?? false;

        if (v.startsWith('>='))      { whereParts.push(`${qcol} >= ?`);  bindings.push(v.slice(2)); }
        else if (v.startsWith('<=')) { whereParts.push(`${qcol} <= ?`);  bindings.push(v.slice(2)); }
        else if (v.startsWith('>'))  { whereParts.push(`${qcol} > ?`);   bindings.push(v.slice(1)); }
        else if (v.startsWith('<'))  { whereParts.push(`${qcol} < ?`);   bindings.push(v.slice(1)); }
        else if (v.startsWith('='))  { whereParts.push(`${qcol} = ?`);   bindings.push(v.slice(1)); }
        else if (v.includes('..'))   {
          const [lo, hi] = v.split('..', 2);
          if (lo.trim()) { whereParts.push(`${qcol} >= ?`); bindings.push(lo.trim()); }
          if (hi.trim()) { whereParts.push(`${qcol} <= ?`); bindings.push(hi.trim()); }
        }
        else if (isIndexed) { whereParts.push(`${qcol} = ?`); bindings.push(v); }
        else { whereParts.push(`${qcol} LIKE ?`); bindings.push(`%${v}%`); }
      }
    }
  }

  // Ownership filter: when ownerId is set, restrict to records owned by that member
  if (params.ownerId) {
    // Always use table__field alias — custom SQL is built from auto-generated SQL which follows this convention
    const pkAlias = `${baseTableName}__${pkName}`;
    whereParts.push(
      `EXISTS (SELECT 1 FROM _wdpro_metadata WHERE ${app.database_mode === 'mysql' ? `CAST(_wdpro_metadata.record_id AS UNSIGNED) = _v."${pkAlias}"` : `_wdpro_metadata.record_id = ${castToText(app, `"_v"."${pkAlias}"`)}`} AND _wdpro_metadata.table_name = ? AND _wdpro_metadata.created_by_id = ?)`
    );
    bindings.push(baseTableName, String(params.ownerId));
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  // If sorting by a metadata field, LEFT JOIN _wdpro_metadata to get those columns
  const isMetaSecondary = rawSecondary ? META_SORT.has(rawSecondary) : false;
  const needsMetaJoin = isMetaSort || isMetaSecondary;
  let outerSql: string;
  if (needsMetaJoin) {
    // Always use table__field alias — custom SQL follows the same convention as auto-generated SQL
    const pkAlias = `${baseTableName}__${pkName}`;
    outerSql = `SELECT _v.*, _m.created_at AS "_meta__created_at", _m.updated_at AS "_meta__updated_at", _m.created_by_name AS "_meta__created_by" ` +
      `FROM (${baseSql}) AS _v ` +
      `LEFT JOIN _wdpro_metadata _m ON ${app.database_mode === 'mysql' ? `CAST(_m.record_id AS UNSIGNED) = _v."${pkAlias}"` : `${castToText(app, `_v."${pkAlias}"`)} = _m.record_id`} AND _m.table_name = '${baseTableName}' ` +
      whereSql;
  } else {
    outerSql = `SELECT * FROM (${baseSql}) AS _v ${whereSql}`;
  }

  let sortSql = '';
  if (sortField) {
    sortSql = ` ORDER BY "${sortField}" ${sortDir}`;
    if (secondarySort) sortSql += `, "${secondarySort}" ASC`;
  }

  // Capture debug SQL before executing (interpolate ? placeholders for readability)
  if (params.sqlCapture) {
    const interpolate = (sql: string, vals: unknown[]) => {
      let i = 0;
      return sql.replace(/\?/g, () => {
        const v = vals[i++];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      });
    };
    const dataBindings = [...bindings, pageSize, offset];
    params.sqlCapture.push(interpolate(`${outerSql}${sortSql} LIMIT ? OFFSET ?`, dataBindings));
  }

  // Total count
  // MySQL raw() returns [rows, fields]; SQLite returns rows directly.
  const isMysql = app.database_mode === 'mysql';
  const countResult = await appDb.raw(
    `SELECT COUNT(*) AS _t FROM (${outerSql}) AS _c`,
    bindings
  );
  const countRows: Record<string, unknown>[] = isMysql
    ? (countResult as [Record<string, unknown>[], unknown])[0]
    : (countResult as Record<string, unknown>[]);
  const total      = Number(countRows[0]?.['_t'] ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Data rows
  const rowsRaw = await appDb.raw(
    `${outerSql}${sortSql} LIMIT ? OFFSET ?`,
    [...bindings, pageSize, offset]
  );
  const rows: Record<string, unknown>[] = isMysql
    ? (rowsRaw as [Record<string, unknown>[], unknown])[0]
    : (rowsRaw as Record<string, unknown>[]);

  // System data
  const sys: Record<string, unknown> = {
    _q:              q,
    _page:           page,
    _total:          total,
    _total_pages:    totalPages,
    _has_prev:       page > 1 ? 'true' : '',
    _has_next:       page < totalPages ? 'true' : '',
    _prev_page:      Math.max(1, page - 1),
    _next_page:      Math.min(totalPages, page + 1),
    _sort:           sortField ?? '',
    _dir:            sortDir.toLowerCase(),
    _per_page:       pageSize,
    _page_size:      view.page_size ?? 25,
    _pagination:     buildPaginationHtml(page, totalPages),
    _portal_header:  params.portalHeader ?? '',
    _portal_footer:  params.portalFooter ?? '',
    _app_slug:       app.slug,
  };

  const parts: string[] = [];

  const searchFormTpl = await renderWidgetTokens(tpl.search_form, app.id, {}, 'search');
  parts.push(await injectAdvancedSearch(renderTokens(searchFormTpl, sys), app.id, view.base_table_id, baseTableName));
  parts.push(renderTokens(tpl.header, sys));

  const hasDetail = !!tpl.detail?.trim();

  // Pre-fetch gallery first-photos and owner fields for the row template.
  const existingKeys = rows.length ? new Set(Object.keys(rows[0])) : new Set<string>();
  const recordIdsForGallery = rows.map(r => String(r[pkName] ?? r[`${baseTableName}__${pkName}`] ?? '')).filter(Boolean);
  const [galleryThumbs, ownerExtrasMap] = await Promise.all([
    prefetchGalleryThumbnails(app, appDb, tpl.row ?? '', recordIdsForGallery, existingKeys),
    prefetchOwnerFields(app, appDb, tpl.row ?? '', baseTableName, recordIdsForGallery),
  ]);

  let lastGroup: unknown = Symbol('none');
  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const pkVal  = String(row[pkName] ?? row[`${baseTableName}__${pkName}`] ?? '');

    const galleryExtras: Record<string, string> = {};
    for (const [alias, photoMap] of galleryThumbs) {
      galleryExtras[alias] = photoMap.get(pkVal) ?? '';
    }
    const ownerExtras = ownerExtrasMap.get(pkVal) ?? {};

    const rowData = { ...sys, ...row, ...galleryExtras, ...ownerExtras, _pk: pkVal, _row_num: offset + i + 1 };

    if (groupField) {
      const gv = row[groupField];
      if (gv !== lastGroup) {
        if (lastGroup !== Symbol('none') && tpl.group_footer)
          parts.push(renderTokens(tpl.group_footer, { ...rowData, _group_value: String(lastGroup) }));
        if (tpl.group_header)
          parts.push(renderTokens(tpl.group_header, { ...rowData, _group_value: String(gv) }));
        lastGroup = gv;
      }
    }

    let rendered = renderTokens(tpl.row, rowData);
    if (!hasDetail) {
      rendered = rendered
        .replace(/\s+data-wdp-action="detail"/gi, '')
        .replace(/cursor\s*:\s*pointer\s*;?/gi, 'cursor:default;');
    }
    parts.push(rendered);
  }

  if (groupField && lastGroup !== Symbol('none') && tpl.group_footer)
    parts.push(renderTokens(tpl.group_footer, { ...sys, _group_value: String(lastGroup) }));

  parts.push(renderTokens(tpl.footer, sys));

  return renderReviewMarkers(parts.join('\n'));
}

export async function renderViewDetail(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  recordId: string,
  portalContext?: { portalHeader?: string; portalFooter?: string }
): Promise<string> {
  const appDb  = getAppDb(app);
  const pkField = await db('app_fields')
    .where({ table_id: view.base_table_id, is_primary_key: true })
    .first();
  const pkName = pkField?.field_name ?? 'id';

  let baseSql: string;
  let pkAlias: string;
  if (view.query_mode === 'advanced_sql' && view.custom_sql) {
    baseSql  = view.custom_sql;
    pkAlias  = `${baseTableName}__${pkName}`;  // custom SQL follows table__field convention
  } else {
    baseSql  = await generateViewSql(app.id, baseTableName, templates);
    pkAlias  = `${baseTableName}__${pkName}`;  // auto SQL always aliases as table__field
  }

  const detailRaw = await appDb.raw(
    `SELECT * FROM (${baseSql}) AS _v WHERE "${pkAlias}" = ? LIMIT 1`,
    [recordId]
  );
  const rows: Record<string, unknown>[] = app.database_mode === 'mysql'
    ? (detailRaw as [Record<string, unknown>[], unknown])[0]
    : (detailRaw as Record<string, unknown>[]);

  if (!rows.length) return '<p class="wdp-error">Record not found.</p>';

  const row     = rows[0];
  const pkVal   = String(row[pkName] ?? row[`${baseTableName}__${pkName}`] ?? recordId);
  const meta    = await getRecordMeta(app, baseTableName, pkVal);

  // Pre-fetch gallery thumbnails and owner fields for the detail template.
  const existingKeysDetail = new Set(Object.keys(row));
  const detailTpl = templates.detail ?? '';
  const [galleryThumbsDetail, ownerFieldsDetail] = await Promise.all([
    prefetchGalleryThumbnails(app, appDb, detailTpl, [pkVal], existingKeysDetail),
    prefetchOwnerFields(app, appDb, detailTpl, baseTableName, [pkVal]),
  ]);
  const galleryExtrasDetail: Record<string, string> = {};
  for (const [alias, photoMap] of galleryThumbsDetail) {
    galleryExtrasDetail[alias] = photoMap.get(pkVal) ?? '';
  }
  const ownerExtrasDetail = ownerFieldsDetail.get(pkVal) ?? {};

  const rowData = {
    _pk: pkVal, _row_num: 1, ...row, ...metaToRowKeys(meta), ...galleryExtrasDetail, ...ownerExtrasDetail,
    _portal_header: portalContext?.portalHeader ?? '',
    _portal_footer: portalContext?.portalFooter ?? '',
    _app_slug: app.slug,
  };

  const detailTags = parseGroupTags(templates.detail);
  const detailTplFinal = detailTags.length ? applyGroupTags(templates.detail, detailTags) : templates.detail;
  const rendered = renderReviewMarkers(renderTokens(detailTplFinal, rowData));
  return renderFormTokens(rendered, app.slug, app.id);
}

export async function renderViewEditForm(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  recordId: string,
  portalContext?: { portalHeader?: string; portalFooter?: string }
): Promise<string> {
  const appDb   = getAppDb(app);
  const pkField = await db('app_fields')
    .where({ table_id: view.base_table_id, is_primary_key: true })
    .first();
  const pkName = pkField?.field_name ?? 'id';

  let baseSql: string;
  let pkAlias: string;
  if (view.query_mode === 'advanced_sql' && view.custom_sql) {
    baseSql = view.custom_sql;
    pkAlias = `${baseTableName}__${pkName}`;
  } else {
    baseSql = await generateViewSql(app.id, baseTableName, templates);
    pkAlias = `${baseTableName}__${pkName}`;
  }

  const editRaw = await appDb.raw(
    `SELECT * FROM (${baseSql}) AS _v WHERE "${pkAlias}" = ? LIMIT 1`,
    [recordId]
  );
  const rows: Record<string, unknown>[] = app.database_mode === 'mysql'
    ? (editRaw as [Record<string, unknown>[], unknown])[0]
    : (editRaw as Record<string, unknown>[]);

  if (!rows.length) return '<p class="wdp-error">Record not found.</p>';

  const row     = rows[0];
  const pkVal   = String(row[pkName] ?? row[`${baseTableName}__${pkName}`] ?? recordId);
  const meta    = await getRecordMeta(app, baseTableName, pkVal);
  const rowData = {
    _pk: pkVal, _row_num: 1, ...row, ...metaToRowKeys(meta),
    _portal_header: portalContext?.portalHeader ?? '',
    _portal_footer: portalContext?.portalFooter ?? '',
    _app_slug: app.slug,
  };

  const editTags  = parseGroupTags(templates.edit_form);
  const editTpl   = editTags.length ? applyGroupTags(templates.edit_form, editTags) : templates.edit_form;
  const processed = await renderWidgetTokens(editTpl, app.id, rowData, 'update');
  return renderReviewMarkers(renderTokens(autoNameEditInputs(processed), rowData));
}

// ── Create form ──────────────────────────────────────────────────────────────

export async function renderViewCreateForm(
  app: App,
  view: View,
  baseTableName: string,
  templates: ViewTemplates,
  portalContext?: { portalHeader?: string; portalFooter?: string }
): Promise<string> {
  // No existing record — render $update[...] widgets with empty values
  const createTpl  = templates.create_form || DEFAULT_TEMPLATES.create_form;
  const processed  = await renderWidgetTokens(createTpl, app.id, {}, 'update');
  const rendered   = renderReviewMarkers(renderTokens(autoNameEditInputs(processed), {
    _pk: '',
    _portal_header: portalContext?.portalHeader ?? '',
    _portal_footer: portalContext?.portalFooter ?? '',
    _app_slug: app.slug,
  }));
  return renderFormTokens(rendered, app.slug, app.id);
}

// ── Edit-form helpers ────────────────────────────────────────────────────────

/**
 * For every <input> in the edit_form template that has a value="${table.field}" token,
 * auto-set its name attribute to "field" (overwriting whatever the admin typed).
 * This runs before renderTokens so the token is still visible.
 */
/**
 * Processes $formopen[tableName,key=value,...] and $form[tableName,key=value,...] tokens.
 * Must be called AFTER renderTokens() so ${...} sub-tokens inside key=value pairs are
 * already resolved (e.g. $formopen[inquiries,pet_id=42] after ${pets.id} → 42).
 *
 * $formopen — emits only the <form> opening tag + hidden fields (admin writes own inputs)
 * $form     — emits the full form: opening tag + auto-generated fields + submit + </form>
 */
export async function renderFormTokens(
  html: string,
  appSlug: string,
  appId: number,
): Promise<string> {
  // $formclose → </form> (keeps the editor from seeing an unbalanced close tag)
  html = html.replace(/\$formclose\b/g, '</form>');

  const tokenRe = /\$(formopen|form)\[([^\]]+)\]/g;
  const matches = [...html.matchAll(tokenRe)];
  if (!matches.length) return html;

  // Collect all unique table names so we can batch-load fields
  const tableNames = [...new Set(matches.map(m => {
    const parts = m[2].split(',');
    return parts[0].trim();
  }))];
  const tables = await db('app_tables')
    .where({ app_id: appId })
    .whereIn('table_name', tableNames);
  const tableMap = new Map<string, { id: number; is_public_addable: boolean }>(
    tables.map((t: { table_name: string; id: number; is_public_addable: boolean }) => [t.table_name, t])
  );

  // Load fields for all found tables at once
  const tableIds = tables.map((t: { id: number }) => t.id);
  const allFields = tableIds.length
    ? await db('app_fields').whereIn('table_id', tableIds).where({ is_primary_key: false }).orderBy('sort_order')
    : [];
  const fieldsByTableId = new Map<number, typeof allFields>();
  for (const f of allFields) {
    if (!fieldsByTableId.has(f.table_id)) fieldsByTableId.set(f.table_id, []);
    fieldsByTableId.get(f.table_id)!.push(f);
  }

  return html.replace(tokenRe, (_match: string, type: string, args: string) => {
    const parts     = args.split(',').map((s: string) => s.trim());
    const tableName = parts[0];
    const hiddenPairs = parts.slice(1); // e.g. ["pet_id=42", "source=detail"]

    const table = tableMap.get(tableName);
    if (!table || !table.is_public_addable) {
      return `<!-- formopen: table "${tableName}" not found or not public-addable -->`;
    }

    const action  = `/api/v/${appSlug}/form/${tableName}`;
    // Determine the redirect URL from a _redirect= hidden pair if provided
    let redirectVal = '';
    const hiddens = hiddenPairs.filter(p => {
      if (p.startsWith('_redirect=')) { redirectVal = p.slice('_redirect='.length); return false; }
      return true;
    });

    const openTag = `<form method="POST" action="${action}">` +
      hiddens.map(p => {
        const eq = p.indexOf('=');
        if (eq === -1) return '';
        const k = p.slice(0, eq).trim();
        const v = p.slice(eq + 1).trim();
        if (!/^[a-zA-Z0-9_]+$/.test(k)) return '';
        return `<input type="hidden" name="${k}" value="${escHtmlAttr(v)}">`;
      }).join('') +
      (redirectVal ? `<input type="hidden" name="_redirect" value="${escHtmlAttr(redirectVal)}">` : '');

    if (type === 'formopen') return openTag;

    // $form — auto-generate inputs for all non-PK, non-image, non-upload fields
    const fields = fieldsByTableId.get(table.id) ?? [];
    const inputsHtml = fields
      .filter((f: { data_type: string }) => f.data_type !== 'image' && f.data_type !== 'upload')
      .map((f: { field_name: string; label: string; ui_widget: string; ui_options_json: string | null; is_required: boolean }) => {
        const name  = f.field_name;
        const label = f.label || name;
        const req   = f.is_required ? ' required' : '';

        if (f.ui_widget === 'textarea') {
          return `<div class="wdp-field"><label>${label}</label><textarea name="${name}"${req}></textarea></div>`;
        }
        if (f.ui_widget === 'checkbox') {
          return `<div class="wdp-field"><label><input type="checkbox" name="${name}" value="on"> ${label}</label></div>`;
        }
        if (f.ui_widget === 'select') {
          const opts = parseSelectOptions(f.ui_options_json);
          const optHtml = ['', ...opts].map(o => `<option value="${escHtmlAttr(o)}">${o || '— select —'}</option>`).join('');
          return `<div class="wdp-field"><label>${label}</label><select name="${name}"${req}>${optHtml}</select></div>`;
        }
        const inputType = f.ui_widget === 'number' ? 'number'
          : f.ui_widget === 'date' ? 'date'
          : f.ui_widget === 'datetime' ? 'datetime-local'
          : f.ui_widget === 'email' ? 'email'
          : 'text';
        return `<div class="wdp-field"><label>${label}</label><input type="${inputType}" name="${name}"${req}></div>`;
      }).join('\n');

    return `${openTag}\n${inputsHtml}\n<div class="wdp-field"><button type="submit">Submit</button></div>\n</form>`;
  });
}

function autoNameEditInputs(template: string): string {
  return template.replace(/<input([^>]*)>/gi, (_match, attrs: string) => {
    const tokenMatch = attrs.match(/value="\$\{[^.]+\.([^}]+)\}"/);
    if (!tokenMatch) return `<input${attrs}>`;
    const field    = tokenMatch[1];
    const newAttrs = /\bname=/.test(attrs)
      ? attrs.replace(/\bname="[^"]*"/, `name="${field}"`)
      : attrs + ` name="${field}"`;
    return `<input${newAttrs}>`;
  });
}

function escHtmlAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseSelectOptions(json: string | null): string[] {
  if (!json) return [];
  try { return (JSON.parse(json) as { options?: string[] }).options ?? []; }
  catch { return []; }
}

function parseTextareaOptions(json: string | null): { rows: number; cols: number } {
  if (!json) return { rows: 4, cols: 60 };
  try {
    const p = JSON.parse(json) as { rows?: number; cols?: number };
    return { rows: p.rows ?? 4, cols: p.cols ?? 60 };
  } catch { return { rows: 4, cols: 60 }; }
}

/**
 * If a rendered search form lacks an advanced-search panel, inject one automatically.
 * This makes the Advanced toggle work for templates generated before the feature existed.
 *
 * Handles three cases:
 *   1. <form data-wdp-form="search"> (double quotes)
 *   2. <form data-wdp-form='search'> (single quotes — AI-generated templates)
 *   3. <div class="wdp-sf"> with no form wrapper (old AI templates) — wraps in a form
 */
async function injectAdvancedSearch(
  html: string,
  appId: number,
  tableId: number,
  tableName: string
): Promise<string> {
  // Eligible widgets for auto-search injection (textarea renders as text input in search mode)
  const eligibleWidgets = ['text', 'textarea', 'select', 'checkbox'];

  // If .wdp-sf-adv is already present (e.g. blueprint-generated template), check for
  // missing fields and append them to the existing .wdp-adv-fields div.
  if (html.includes('wdp-sf-adv')) {
    const fields = await db('app_fields')
      .where({ table_id: tableId })
      .whereIn('ui_widget', eligibleWidgets)
      .orderBy('sort_order')
      .select('field_name');
    if (fields.length === 0) return html;

    const missingFields = fields.filter(
      (f: { field_name: string }) => !html.includes(`name="${tableName}__${f.field_name}"`)
    );
    if (missingFields.length === 0) return html;

    const missingTpl = missingFields
      .map((f: { field_name: string }) => `$search[${tableName}.${f.field_name}]`)
      .join('\n');
    const renderedMissing = await renderWidgetTokens(missingTpl, appId, {}, 'search');

    // Append missing inputs inside the existing .wdp-adv-fields div.
    // We must track div depth to find the correct closing </div> — a non-greedy
    // regex would stop at the first </div> inside a nested .wdp-field element.
    const openMatch = /(<div[^>]*class="wdp-adv-fields"[^>]*>)/.exec(html);
    if (!openMatch) return html;
    const afterOpen = openMatch.index + openMatch[0].length;
    let depth = 1;
    let pos   = afterOpen;
    while (pos < html.length && depth > 0) {
      const nextOpen  = html.indexOf('<div', pos);
      const nextClose = html.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          return html.slice(0, nextClose) + renderedMissing + html.slice(nextClose);
        }
        pos = nextClose + 6;
      }
    }
    return html; // fallback: couldn't find matching close div
  }

  // Custom form: has wdp-adv-fields but NOT wdp-sf-adv — leave it completely alone.
  // (wdp-sf-adv is the marker for blueprint/AI-generated templates that want auto-injection)
  if (html.includes('wdp-adv-fields') && !html.includes('wdp-sf-adv')) return html;

  const hasProperForm = html.includes('data-wdp-form="search"') || html.includes("data-wdp-form='search'");
  const hasSfDiv      = /class=["']wdp-sf["']/.test(html);

  if (!hasProperForm && !hasSfDiv) return html; // no search form to enhance

  const fields = await db('app_fields')
    .where({ table_id: tableId })
    .whereIn('ui_widget', eligibleWidgets)
    .orderBy('sort_order')
    .select('field_name');
  if (fields.length === 0) return html;

  const searchTpl = fields
    .map((f: { field_name: string }) => `$search[${tableName}.${f.field_name}]`)
    .join('\n');
  const renderedInputs = await renderWidgetTokens(searchTpl, appId, {}, 'search');

  const onShowAdv    = `event.preventDefault();var a=this.closest('[data-wdp-form]').querySelector('.wdp-sf-adv');a.querySelectorAll('input,select').forEach(function(e){e.disabled=false});this.closest('[data-wdp-form]').querySelector('.wdp-sf-simple').style.display='none';a.style.display=''`;
  const onShowSimple = `var a=this.closest('[data-wdp-form]').querySelector('.wdp-sf-adv');a.querySelectorAll('input,select').forEach(function(e){e.disabled=true});a.style.display='none';this.closest('[data-wdp-form]').querySelector('.wdp-sf-simple').style.display=''`;

  // Inputs start disabled so they aren't submitted while the panel is hidden
  const advPanel = `\n<div class="wdp-sf-adv" style="display:none"><div class="wdp-adv-fields">${renderedInputs}</div><div class="wdp-adv-btns"><button type="submit" class="wdp-btn">Search</button> <button type="button" class="wdp-adv-link" onclick="${onShowSimple}">&#8593; Simple</button> <a data-wdp-action="clear" class="wdp-btn-link">Clear</a></div><script>document.currentScript.closest('.wdp-sf-adv').querySelectorAll('input,select').forEach(function(e){e.disabled=true});<\/script></div>`;
  const advLink  = ` <a href="#" class="wdp-adv-link" onclick="${onShowAdv}">Advanced</a>`;

  if (hasProperForm) {
    // Case 1 & 2: wrap existing form body in .wdp-sf-simple and append advanced panel
    return html.replace(
      /(<form[^>]*data-wdp-form=["']search["'][^>]*>)([\s\S]*?)(<\/form>)/,
      (_match, open: string, content: string, close: string) =>
        `${open}<div class="wdp-sf-simple">${content.trimEnd()}${advLink}</div>${advPanel}${close}`
    );
  }

  // Case 3: no form wrapper — find the .wdp-sf div and wrap it in a proper form
  return html.replace(
    /(<div[^>]*\bclass=["']wdp-sf["'][^>]*>)([\s\S]*?)(<\/div>)/,
    (_match, open: string, content: string, close: string) =>
      `<form data-wdp-form="search"><div class="wdp-sf-simple">${open}${content}${close}${advLink}</div>${advPanel}</form>`
  );
}

/**
 * Replace $update[table.field] tokens with the appropriate input widget,
 * pre-filled with the current record value, based on the field's ui_widget definition.
 *
 * Checkbox fields emit a hidden sentinel <input name="_wdpcb_field"> so the PATCH
 * handler can detect unchecked state (checkboxes omit themselves when unchecked).
 */
async function renderWidgetTokens(
  template: string,
  appId: number,
  rowData: Record<string, unknown>,
  mode: 'update' | 'search'
): Promise<string> {
  const tokenRe = /\$(?:update|search)\[([^\].]+)\.([^\]]+)\]/g;
  const matches = [...template.matchAll(tokenRe)];
  if (matches.length === 0) return template;

  // Load tables + fields for all referenced table names
  const tableNames = [...new Set(matches.map(m => m[1]))];
  const tables     = await db('app_tables').whereIn('table_name', tableNames).where({ app_id: appId });
  const allTableIds = tables.map((t: { id: number }) => t.id);
  const fields = allTableIds.length ? await db('app_fields').whereIn('table_id', allTableIds) : [];

  // "tableName.fieldName" → field row
  const fieldMap = new Map<string, {
    field_name: string; label: string; ui_widget: UIWidget;
    ui_options_json: string | null; is_required: boolean;
  }>();
  for (const f of fields) {
    const tid    = f.table_id as number;
    const tEntry = tables.find((t: { id: number }) => t.id === tid);
    if (tEntry) fieldMap.set(`${tEntry.table_name}.${f.field_name}`, f);
  }

  return template.replace(tokenRe, (_match, tableName: string, fieldName: string) => {
    const field = fieldMap.get(`${tableName}.${fieldName}`);
    if (!field) return `<!-- unknown field: ${tableName}.${fieldName} -->`;

    const alias    = `${tableName}__${fieldName}`;
    // search mode: inputs always start empty; update mode: pre-fill from row data
    const rawValue = mode === 'search' ? '' : (rowData[alias] ?? rowData[fieldName] ?? '');
    const value    = String(rawValue ?? '');
    const label    = escHtmlAttr(field.label || fieldName);
    const widget   = (field.ui_widget as UIWidget) || 'text';
    // search fields are never required
    const req      = (mode === 'update' && field.is_required) ? ' required' : '';
    const id       = `wdp-f-${fieldName}`;
    const v        = escHtmlAttr(value);
    // search mode: use full "table__field" alias so the server can locate the column unambiguously
    const n        = mode === 'search' ? alias : fieldName;

    // Parse max_length from ui_options_json; derive input width and maxlength attr
    let maxLen = 0;
    try { maxLen = JSON.parse(field.ui_options_json || '{}').max_length ?? 0; } catch { /* */ }
    // Width: cap at 50ch so long fields don't span the page; min 6ch for readability
    const szCh     = maxLen > 0 ? Math.max(6, Math.min(maxLen + 2, 50)) : 0;
    const sizeAttr = szCh > 0 ? ` maxlength="${maxLen}" style="width:${szCh}ch"` : '';

    switch (widget) {
      case 'textarea': {
        // In search mode, render as a single-line text input — a multiline textarea makes no sense for search
        if (mode === 'search') {
          return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
               + `<input type="text" id="${id}" name="${n}" value="${v}" class="wdp-input" placeholder="${label}"${sizeAttr}></div>`;
        }
        const { rows, cols } = parseTextareaOptions(field.ui_options_json);
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<textarea id="${id}" name="${n}" rows="${rows}" cols="${cols}" class="wdp-input"${req}>${escHtmlAttr(value)}</textarea></div>`;
      }
      case 'select': {
        const opts    = parseSelectOptions(field.ui_options_json);
        const optHtml = ['', ...opts].map(o =>
          `<option value="${escHtmlAttr(o)}"${o === value ? ' selected' : ''}>${o || '—'}</option>`
        ).join('');
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<select id="${id}" name="${n}" class="wdp-input"${req}>${optHtml}</select></div>`;
      }
      case 'checkbox': {
        // In search mode render as a tri-state select (any / yes / no) rather than a checkbox
        if (mode === 'search') {
          return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
               + `<select id="${id}" name="${n}" class="wdp-input">`
               + `<option value="">— any —</option>`
               + `<option value="1">Yes</option>`
               + `<option value="0">No</option>`
               + `</select></div>`;
        }
        const checked = (value === '1' || value === 'true' || value === 't') ? ' checked' : '';
        return `<div class="wdp-field wdp-field-check">`
             + `<input type="hidden" name="_wdpcb_${n}" value="">`
             + `<label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="checkbox" id="${id}" name="${n}" value="1"${checked}></div>`;
      }
      case 'date':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="date" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}></div>`;
      case 'datetime':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="datetime-local" id="${id}" name="${n}" value="${value.replace(' ', 'T')}" class="wdp-input"${req}></div>`;
      case 'time':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="time" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}></div>`;
      case 'number':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="number" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}${sizeAttr}></div>`;
      case 'email':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="email" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}${sizeAttr}></div>`;
      case 'url':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="url" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}${sizeAttr}></div>`;
      case 'password':
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="password" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}${sizeAttr}></div>`;
      case 'hidden':
        return `<input type="hidden" name="${n}" value="${v}">`;
      case 'image': {
        if (mode === 'search') return '';
        const thumbHtml = value
          ? `<div class="wdp-img-preview"><img src="/files/${v}?thumb=1" alt=""></div>`
          : '';
        return `<div class="wdp-field">`
             + `<label class="wdp-field-label" for="${id}">${label}</label>`
             + thumbHtml
             + `<input type="file" id="${id}" name="${n}" accept="image/*" class="wdp-input"${req}></div>`;
      }
      case 'upload': {
        if (mode === 'search') return '';
        const fileHtml = value
          ? `<div class="wdp-file-link"><a href="/files/${v}" target="_blank">View current file</a></div>`
          : '';
        return `<div class="wdp-field">`
             + `<label class="wdp-field-label" for="${id}">${label}</label>`
             + fileHtml
             + `<input type="file" id="${id}" name="${n}" class="wdp-input"${req}></div>`;
      }
      default:
        return `<div class="wdp-field"><label class="wdp-field-label" for="${id}">${label}</label>`
             + `<input type="text" id="${id}" name="${n}" value="${v}" class="wdp-input"${req}${sizeAttr}></div>`;
    }
  });
}
