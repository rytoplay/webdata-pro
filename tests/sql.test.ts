/**
 * Advanced SQL view mode.
 *
 * Regression fixes tested:
 * 1. :q placeholder — was not substituted, caused "named parameters" SQL error
 * 2. effectivePkAlias — when custom SQL doesn't alias as table__id, the detail
 *    link wrapper should fall back to bare 'id' column so rows still render
 */
import request         from 'supertest';
import { createAdminContext, cleanupTestApp, getExpressApp } from './helpers/agent';
import * as tablesService from '../src/services/tables';
import * as viewsService  from '../src/services/views';
import { createField }    from '../src/services/fields';
import { getAppDb }       from '../src/db/adapters/appDb';

const SLUG = 'sql-test';

describe('Advanced SQL views', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;

  beforeAll(async () => {
    ctx = await createAdminContext(SLUG);

    // Create table
    const table = await tablesService.createTable({
      app_id:     ctx.app.id,
      table_name: 'items',
      label:      'Items',
    });
    await createField({ table_id: table.id, field_name: 'name', label: 'Name', data_type: 'string' });

    // Insert test records
    const appDb = getAppDb(ctx.app);
    await appDb('items').insert([{ name: 'Apple' }, { name: 'Banana' }, { name: 'Cherry' }]);

    // View with proper aliases and :q filter
    const sv = await viewsService.createView({
      app_id:        ctx.app.id,
      view_name:     'search-view',
      label:         'Search View',
      base_table_id: table.id,
      is_public:     true,
      query_mode:    'advanced_sql',
      custom_sql: `
        SELECT
          items.id   AS items__id,
          items.name AS items__name
        FROM items
        WHERE (:q = '' OR items.name LIKE '%' || :q || '%')
        ORDER BY items.name ASC
      `,
    });
    await viewsService.saveViewTemplates(ctx.app.id, sv.id, {
      row: '<div>${items.name}</div>',
    });

    // View whose custom SQL omits the table__id alias (tests effectivePkAlias fallback)
    const bv = await viewsService.createView({
      app_id:        ctx.app.id,
      view_name:     'bare-alias-view',
      label:         'Bare Alias View',
      base_table_id: table.id,
      is_public:     true,
      query_mode:    'advanced_sql',
      custom_sql: `
        SELECT id, name AS items__name
        FROM items
        ORDER BY name ASC
      `,
    });
    await viewsService.saveViewTemplates(ctx.app.id, bv.id, {
      row: '<div>${items.name}</div>',
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  // ── :q substitution ───────────────────────────────────────────────────────

  it('returns all rows when q is empty', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/search-view`)
      .expect(200);
    expect(res.text).toContain('Apple');
    expect(res.text).toContain('Banana');
    expect(res.text).toContain('Cherry');
  });

  it('filters rows when q is set (:q substitution)', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/search-view?q=Apple`)
      .expect(200);
    expect(res.text).toContain('Apple');
    expect(res.text).not.toContain('Banana');
  });

  it('does not throw on SQL-injection-like q values', async () => {
    // Should not throw 500; single-quote escaping must work
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/search-view?q=${encodeURIComponent("'; DROP TABLE items; --")}`)
      .expect(200);
    // The injected text is treated as a literal search term — no rows match
    expect(res.text).not.toContain('Apple');
  });

  // ── effectivePkAlias fallback ─────────────────────────────────────────────

  it('renders rows even when custom SQL does not alias id as table__id', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/bare-alias-view`)
      .expect(200);
    // View should render without 500 error, and rows should appear
    expect(res.text).toContain('Apple');
  });
});
