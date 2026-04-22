/**
 * Blueprint QA test — Bookstore app
 *
 * Simulates a real admin going through the AI Builder wizard:
 * "I'm evaluating this tool for my bookstore. I have a web page already
 *  and inventory in a different system which can export CSV."
 *
 * Run with:  npx ts-node test-blueprint-bookstore.ts
 */

import { db } from './src/db/knex';
import * as appsService from './src/services/apps';
import * as aiService from './src/services/ai';
import { buildUserPrompt, BLUEPRINT_SYSTEM_PROMPT } from './src/services/blueprintPrompt';
import { validateBlueprint, applyBlueprint, type Blueprint } from './src/services/blueprintImport';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const B = (s: string) => `\x1b[1m${s}\x1b[0m`;

function pass(label: string, detail = '') {
  console.log(`  ${G('✓')} ${label}${detail ? `  ${Y(detail)}` : ''}`);
}
function fail(label: string, detail = '') {
  console.log(`  ${R('✗')} ${label}${detail ? `  ${detail}` : ''}`);
}
function section(title: string) {
  console.log(`\n${B('── ' + title + ' ' + '─'.repeat(Math.max(0, 60 - title.length)))}`);
}

// ── Wizard answers (as a real admin would fill in) ────────────────────────────
const WIZARD: Parameters<typeof buildUserPrompt>[0] = {
  description:
    'A used bookstore inventory and storefront. We sell secondhand books ' +
    'across all genres. Customers browse online and buy in-store. Staff need to ' +
    'manage stock, update prices, and mark items as sold. We already have a ' +
    'website and will import existing inventory from a CSV export.',
  knownFields: true,
  fieldList:
    'title, author, isbn, genre, condition, price, in_stock, description, published_year, cover_image',
  isPublic: true,
  layoutStyle: 'compact table',
  hasAdminGroup: true,
  hasMemberGroup: false,
};

async function run() {
  console.log(B('\nWebdata Pro — Blueprint QA: Bookstore\n'));

  // ── Run migrations first ──────────────────────────────────────────────────
  await db.migrate.latest();

  // ── 1. Create (or reuse) the app ──────────────────────────────────────────
  section('1. App setup');

  const existing = (await appsService.listApps()).find(a => a.slug === 'bookstore-qa');
  let app = existing ?? null;

  if (app) {
    pass('Reusing existing app', app.name);
  } else {
    app = await appsService.createApp({
      name: 'Bookstore QA',
      slug: 'bookstore-qa',
      description: 'Blueprint QA test — used bookstore',
      database_mode: 'sqlite',
    });
    pass('Created new app', `id=${app.id}  slug=${app.slug}`);
  }

  // ── 2. Call the AI ────────────────────────────────────────────────────────
  section('2. AI Blueprint generation');

  const aiSettings = await aiService.getAiSettings();
  console.log(`  Provider: ${Y(aiSettings.provider)}  Model: ${Y(aiSettings.model || '(default)')}`);

  const userPrompt = buildUserPrompt(WIZARD);

  let blueprint: Blueprint | null = null;
  let rawResponse = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`  Calling AI (attempt ${attempt}/3)…`);
    const temp = attempt === 1 ? 0.4 : 0.2;
    try {
      rawResponse = await aiService.callAi(aiSettings, BLUEPRINT_SYSTEM_PROMPT, userPrompt, 16000, temp);
    } catch (err) {
      fail(`AI call failed`, String(err));
      process.exit(1);
    }

    const jsonStr = aiService.extractJson(rawResponse);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.log(`  ${Y('!')} JSON parse failed on attempt ${attempt}, retrying…`);
      continue;
    }

    const errors = validateBlueprint(parsed);
    if (errors.length > 0) {
      console.log(`  ${Y('!')} Validation failed (${errors[0].path}: ${errors[0].message}), retrying…`);
      continue;
    }

    blueprint = parsed as Blueprint;
    pass(`Blueprint generated on attempt ${attempt}`);
    break;
  }

  if (!blueprint) {
    fail('Could not obtain a valid blueprint after 3 attempts');
    console.log('\nRaw AI output:\n', rawResponse.slice(0, 1000));
    process.exit(1);
  }

  // ── 3. Inspect the blueprint ──────────────────────────────────────────────
  section('3. Blueprint contents');

  console.log(`  Tables (${blueprint.tables.length}):`);
  for (const t of blueprint.tables) {
    console.log(`    ${B(t.table_name)} — ${t.fields.length} fields: ${t.fields.map(f => f.field_name).join(', ')}`);
  }

  const views = blueprint.views ?? [];
  console.log(`\n  Views (${views.length}):`);
  for (const v of views) {
    const pub = v.is_public ? G('public') : Y('private');
    console.log(`    ${v.view_name}  [${pub}]  style=${v.style_hint ?? 'default'}  sort=${v.primary_sort_field ?? 'none'}`);
  }

  const groups = blueprint.groups ?? [];
  console.log(`\n  Groups (${groups.length}):`);
  for (const g of groups) {
    const tables = Object.keys(g.table_permissions ?? {}).join(', ') || '—';
    const viewPerms = Object.keys(g.view_permissions ?? {}).join(', ') || '—';
    console.log(`    ${g.group_name}  tables: [${tables}]  views: [${viewPerms}]`);
  }

  const sampleCounts: string[] = [];
  for (const [tname, rows] of Object.entries(blueprint.sample_data ?? {})) {
    sampleCounts.push(`${tname}: ${rows.length}`);
  }
  // also inline sample_data on tables
  for (const t of blueprint.tables) {
    if (t.sample_data && t.sample_data.length > 0) {
      sampleCounts.push(`${t.table_name} (inline): ${t.sample_data.length}`);
    }
  }
  console.log(`\n  Sample data: ${sampleCounts.join(', ') || 'none'}`);

  // ── 4. Apply the blueprint ────────────────────────────────────────────────
  section('4. Applying blueprint');

  const result = await applyBlueprint(app, blueprint);

  if (result.tablesCreated.length)  pass(`Tables created`,  result.tablesCreated.join(', '));
  if (result.viewsCreated.length)   pass(`Views created`,   result.viewsCreated.join(', '));
  if (result.groupsCreated.length)  pass(`Groups created`,  result.groupsCreated.join(', '));
  if (result.fieldsCreated)         pass(`Fields created`,  String(result.fieldsCreated));
  if (result.rowsInserted)          pass(`Sample records`,  String(result.rowsInserted));
  if (result.errors.length) {
    for (const e of result.errors) fail('Warning', e);
  }

  // ── 5. Verify DB structure ────────────────────────────────────────────────
  section('5. Verifying database structure');

  const dbTables  = await db('app_tables').where({ app_id: app.id });
  const dbViews   = await db('views').where({ app_id: app.id });
  const dbGroups  = await db('groups').where({ app_id: app.id });
  const dbJoins   = await db('app_joins').where({ app_id: app.id });

  dbTables.length >= 1
    ? pass(`${dbTables.length} table(s) in DB`, dbTables.map((t: any) => t.table_name).join(', '))
    : fail('No tables in DB');

  dbViews.length >= 2
    ? pass(`${dbViews.length} view(s) in DB`, dbViews.map((v: any) => v.view_name).join(', '))
    : fail(`Only ${dbViews.length} view(s) — expected at least 2`);

  dbGroups.length >= 1
    ? pass(`${dbGroups.length} group(s) in DB`)
    : fail('No groups in DB');

  // Check default_home_view_id was set
  const groupsWithHome = dbGroups.filter((g: any) => g.default_home_view_id !== null);
  groupsWithHome.length === dbGroups.length
    ? pass('All groups have default_home_view_id set', groupsWithHome.map((g: any) => `${g.group_name}→view#${g.default_home_view_id}`).join(', '))
    : fail(`${dbGroups.length - groupsWithHome.length} group(s) missing default_home_view_id`);

  dbJoins.length > 0
    ? pass(`${dbJoins.length} FK join(s) detected`)
    : console.log(`  ${Y('–')} No FK joins detected (expected if no *_id fields)`);

  // Check templates were generated
  const mainTable = dbTables[0];
  const mainView  = dbViews[0];
  if (mainView) {
    const templates = await db('templates').where({ app_id: app.id, related_id: mainView.id });
    templates.length >= 4
      ? pass(`${templates.length} templates generated for "${mainView.label}"`)
      : fail(`Only ${templates.length} templates for "${mainView.label}" — expected ≥ 4`);
  }

  // Check sample data in the app SQLite
  if (mainTable) {
    const { getAppDb } = await import('./src/db/adapters/appDb');
    const appDb = getAppDb(app);
    try {
      const rows = await appDb(mainTable.table_name).count('* as n').first() as any;
      const n = Number(rows?.n ?? 0);
      n >= 15
        ? pass(`${n} sample records in "${mainTable.table_name}"`)
        : n > 0
          ? console.log(`  ${Y('!')} Only ${n} sample records in "${mainTable.table_name}" (wanted ≥ 15)`)
          : fail(`No sample records in "${mainTable.table_name}"`);

      // Show a few sample rows
      const preview = await appDb(mainTable.table_name).limit(3);
      console.log(`\n  ${B('Sample rows preview:')}`);
      for (const row of preview) {
        const fields = Object.entries(row as Record<string, unknown>)
          .filter(([k]) => !['id'].includes(k))
          .slice(0, 4)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join('  ');
        console.log(`    ${fields}`);
      }
    } catch (e) {
      fail(`Could not query "${mainTable.table_name}"`, String(e));
    }
  }

  // ── 6. CSV import readiness ───────────────────────────────────────────────
  section('6. CSV import readiness');

  // Simulate what a CSV export from an external system would look like
  const csvHeaders = ['title', 'author', 'isbn', 'genre', 'condition', 'price', 'in_stock', 'published_year'];

  if (mainTable) {
    const fields = await db('app_fields').where({ table_id: mainTable.id });
    const fieldNames = new Set(fields.map((f: any) => f.field_name));
    const matched    = csvHeaders.filter(h => fieldNames.has(h));
    const unmatched  = csvHeaders.filter(h => !fieldNames.has(h));

    pass(`${matched.length}/${csvHeaders.length} CSV columns match table fields`, matched.join(', '));
    if (unmatched.length) {
      console.log(`  ${Y('!')} Unmatched CSV columns: ${unmatched.join(', ')}`);
    }
    console.log(`  ${G('→')} CSV import available at: /admin/data/${mainTable.table_name}/import-csv`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  section('Summary');

  console.log(`  App slug:   ${Y('bookstore-qa')}`);
  console.log(`  Browse URL: ${Y(`http://localhost:3000/app/bookstore-qa/${dbViews.find((v: any) => v.is_public)?.view_name ?? '?'}`)}`);
  console.log(`  Admin URL:  ${Y('http://localhost:3000/admin/views')}`);
  console.log(`\n  ${G('Blueprint QA complete.')}\n`);

  await db.destroy();
}

run().catch(err => {
  console.error(R('\nFatal error:'), err);
  process.exit(1);
});
