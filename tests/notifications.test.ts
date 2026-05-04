/**
 * Admin notifications on INSERT / UPDATE / DELETE.
 *
 * Regression: maybeNotify() was only called after insert; update and delete
 * were silent. We use notify_mode='daily' so notifications go to the
 * notification_queue table (no real email sent) and are easy to count.
 */
import { createAdminContext, cleanupTestApp } from './helpers/agent';
import * as appsService   from '../src/services/apps';
import * as tablesService from '../src/services/tables';
import { createField }    from '../src/services/fields';
import { getAppDb }       from '../src/db/adapters/appDb';
import { db }             from '../src/db/knex';

const SLUG = 'notify-test';

describe('Admin notifications (daily queue)', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;

  beforeAll(async () => {
    ctx = await createAdminContext(SLUG);

    // Enable daily-mode notifications for the 'contacts' table
    await appsService.updateApp(ctx.app.id, {
      notify_admin_email: 'admin@test.example',
      notify_tables_json: JSON.stringify(['contacts']),
      notify_mode:        'daily',
    });
    // Reload app so the route handlers see the updated settings
    ctx.app = (await appsService.getApp(ctx.app.id))!;

    // Create the contacts table with a name field
    const table = await tablesService.createTable({
      app_id:     ctx.app.id,
      table_name: 'contacts',
      label:      'Contacts',
    });
    await createField({
      table_id:   table.id,
      field_name: 'name',
      label:      'Name',
      data_type:  'string',
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  async function queueCount(): Promise<number> {
    const row = await db('notification_queue')
      .where({ app_id: ctx.app.id })
      .count('* as n')
      .first();
    return Number((row as { n: number }).n);
  }

  it('queues a notification on INSERT', async () => {
    const before = await queueCount();
    await ctx.agent
      .post('/admin/data/contacts')
      .type('form')
      .send({ name: 'Alice' })
      .expect(302);
    expect(await queueCount()).toBe(before + 1);
  });

  it('queues a notification on UPDATE', async () => {
    // Get the record we just inserted
    const app   = (await appsService.getApp(ctx.app.id))!;
    const appDb = getAppDb(app);
    const rec   = await appDb('contacts').first();

    const before = await queueCount();
    await ctx.agent
      .post(`/admin/data/contacts/${rec.id}`)
      .type('form')
      .send({ name: 'Alice Updated' })
      .expect(302);
    expect(await queueCount()).toBe(before + 1);
  });

  it('queues a notification on DELETE', async () => {
    const app   = (await appsService.getApp(ctx.app.id))!;
    const appDb = getAppDb(app);
    const rec   = await appDb('contacts').first();

    const before = await queueCount();
    await ctx.agent
      .post(`/admin/data/contacts/${rec.id}/delete`)
      .type('form')
      .send({})
      .expect(302);
    expect(await queueCount()).toBe(before + 1);
  });

  it('does NOT queue a notification for tables not in the watch list', async () => {
    // Create a second table that is NOT in notify_tables_json
    const table2 = await tablesService.createTable({
      app_id:     ctx.app.id,
      table_name: 'products',
      label:      'Products',
    });
    await createField({ table_id: table2.id, field_name: 'sku', label: 'SKU', data_type: 'string' });

    const before = await queueCount();
    await ctx.agent
      .post('/admin/data/products')
      .type('form')
      .send({ sku: 'ABC' })
      .expect(302);
    // Count must not change
    expect(await queueCount()).toBe(before);
  });
});
