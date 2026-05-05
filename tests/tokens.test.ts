/**
 * Template token rendering regression tests.
 *
 * Covers: $sum[], $avg[], $count[], $if(), $currency[]
 *
 * Setup: one table with three rows of known data so aggregate and conditional
 * tokens can be verified against exact expected values.
 *
 *   items: { name, price, status }
 *   Alpha  100  'active'
 *   Beta   200  ''        ← empty status; $count should not count this row
 *   Gamma  300  'active'
 */
import request from 'supertest';
import { createAdminContext, cleanupTestApp, getExpressApp } from './helpers/agent';
import * as tablesService from '../src/services/tables';
import * as viewsService  from '../src/services/views';
import { createField }    from '../src/services/fields';
import { getAppDb }       from '../src/db/adapters/appDb';

const SLUG = 'tokens-test';

describe('Template token rendering', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;
  let viewName: string;

  beforeAll(async () => {
    ctx = await createAdminContext(SLUG);

    const table = await tablesService.createTable({
      app_id:     ctx.app.id,
      table_name: 'items',
      label:      'Items',
    });
    await createField({ table_id: table.id, field_name: 'name',   label: 'Name',   data_type: 'string' });
    await createField({ table_id: table.id, field_name: 'price',  label: 'Price',  data_type: 'number' });
    await createField({ table_id: table.id, field_name: 'status', label: 'Status', data_type: 'string' });

    const appDb = getAppDb(ctx.app);
    await appDb('items').insert([
      { name: 'Alpha', price: 100, status: 'active' },
      { name: 'Beta',  price: 200, status: ''       },
      { name: 'Gamma', price: 300, status: 'active' },
    ]);

    const view = await viewsService.createView({
      app_id:        ctx.app.id,
      view_name:     'items-view',
      label:         'Items View',
      base_table_id: table.id,
      is_public:     true,
    });
    viewName = view.view_name;

    await viewsService.saveViewTemplates(ctx.app.id, view.id, {
      // Row: field value, conditional, and currency formatting
      row: '<div class="item">'
         + '${items.name} '
         + '$if(items.status, "active", "inactive") '
         + '$currency[items.price, 2]'
         + '</div>',
      // Footer: aggregates across the full result set
      footer: '<div id="ft">'
            + '<span id="sum">$sum[items.price]</span>'
            + '<span id="avg">$avg[items.price]</span>'
            + '<span id="count">$count[items.status]</span>'
            + '</div>',
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  // ── Row-level tokens ──────────────────────────────────────────────────────

  it('$if renders true branch when field is non-empty', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('Alpha active');
    expect(res.text).toContain('Gamma active');
  });

  it('$if renders false branch when field is empty', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('Beta inactive');
  });

  it('$currency formats a row-level number to fixed decimal places', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('100.00');
    expect(res.text).toContain('200.00');
    expect(res.text).toContain('300.00');
  });

  // ── Aggregate tokens (footer) ─────────────────────────────────────────────

  it('$sum returns the total of a numeric field across all rows', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('<span id="sum">600</span>');
  });

  it('$avg returns the average to 2 decimal places', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('<span id="avg">200.00</span>');
  });

  it('$count counts only rows where the field is non-empty', async () => {
    // Beta has status='', so only Alpha + Gamma are counted → 2
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${viewName}`)
      .expect(200);
    expect(res.text).toContain('<span id="count">2</span>');
  });
});
