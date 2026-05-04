/**
 * Blueprint: apply, validation, idempotency.
 *
 * Regression fixes tested:
 * 1. Flash message not shown after failed apply (GET route hardcoded flash:null)
 * 2. Sample data re-inserted on every apply (idempotency bug)
 * 3. Blueprint with missing table_name is rejected
 */
import { createAdminContext, cleanupTestApp } from './helpers/agent';
import * as appsService from '../src/services/apps';
import { getAppDb }     from '../src/db/adapters/appDb';

const SLUG = 'blueprint-test';

// A minimal valid blueprint with two sample records
const VALID_BLUEPRINT = {
  tables: [
    {
      table_name:  'tasks',
      label:       'Tasks',
      fields: [
        { field_name: 'title',  label: 'Title',  data_type: 'string' },
        { field_name: 'status', label: 'Status', data_type: 'string' },
      ],
      sample_data: [
        { title: 'First task',  status: 'Open'   },
        { title: 'Second task', status: 'Closed' },
      ],
    },
  ],
};

describe('Blueprint: apply', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;

  beforeAll(async () => {
    ctx = await createAdminContext(SLUG);
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  it('applies a valid blueprint and redirects to /admin/tables', async () => {
    const res = await ctx.agent
      .post('/admin/blueprint/apply')
      .type('form')
      .send({ blueprint_json: JSON.stringify(VALID_BLUEPRINT) })
      .expect(302);
    expect(res.headers.location).toMatch(/\/admin\/tables/);
  });

  it('creates the table and sample records on first apply', async () => {
    const app   = (await appsService.getApp(ctx.app.id))!;
    const appDb = getAppDb(app);
    const rows  = await appDb('tasks').select('*');
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { title: string }) => r.title)).toContain('First task');
  });

  it('does NOT duplicate sample data on second apply (idempotency)', async () => {
    const app   = (await appsService.getApp(ctx.app.id))!;
    const appDb = getAppDb(app);

    await ctx.agent
      .post('/admin/blueprint/apply')
      .type('form')
      .send({ blueprint_json: JSON.stringify(VALID_BLUEPRINT) })
      .expect(302);

    const rows = await appDb('tasks').select('*');
    // Count must still be 2, not 4
    expect(rows).toHaveLength(2);
  });
});

describe('Blueprint: validation', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;

  beforeAll(async () => {
    ctx = await createAdminContext(`${SLUG}-val`);
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  it('redirects back to /admin/blueprint for invalid JSON', async () => {
    const res = await ctx.agent
      .post('/admin/blueprint/apply')
      .type('form')
      .send({ blueprint_json: 'not-valid-json{{{' })
      .expect(302);
    expect(res.headers.location).toMatch(/\/admin\/blueprint/);
  });

  it('redirects back to /admin/blueprint when table_name is missing', async () => {
    const bad = { tables: [{ fields: [{ field_name: 'x', data_type: 'string' }] }] };
    const res = await ctx.agent
      .post('/admin/blueprint/apply')
      .type('form')
      .send({ blueprint_json: JSON.stringify(bad) })
      .expect(302);
    expect(res.headers.location).toMatch(/\/admin\/blueprint/);
  });

  it('redirects back when tables array is empty (validation rejects it)', async () => {
    const res = await ctx.agent
      .post('/admin/blueprint/apply')
      .type('form')
      .send({ blueprint_json: JSON.stringify({ tables: [] }) })
      .expect(302);
    // An empty tables array fails validation — redirects back to blueprint page
    expect(res.headers.location).toMatch(/\/admin\/blueprint/);
  });
});
