/**
 * View access control: public views are accessible without auth;
 * private views require a session.
 */
import request from 'supertest';
import { createAdminContext, cleanupTestApp, getExpressApp } from './helpers/agent';
import * as tablesService from '../src/services/tables';
import * as viewsService  from '../src/services/views';
import { getAppDb }        from '../src/db/adapters/appDb';
import * as appsService    from '../src/services/apps';

const SLUG = 'views-test';

describe('View access control', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;
  let publicViewName:  string;
  let privateViewName: string;

  beforeAll(async () => {
    ctx = await createAdminContext(SLUG);

    // Create a table with a text field
    const table = await tablesService.createTable({
      app_id: ctx.app.id,
      table_name: 'items',
      label: 'Items',
    });
    await viewsService;  // ensure module loaded
    const { createField } = await import('../src/services/fields');
    await createField({ table_id: table.id, field_name: 'title', label: 'Title', data_type: 'string' });

    // Insert one row so the view has something to render
    const appDb = getAppDb(ctx.app);
    await appDb('items').insert({ title: 'Hello World' });

    // Public view
    const pub = await viewsService.createView({
      app_id:        ctx.app.id,
      view_name:     'pub-view',
      label:         'Public View',
      base_table_id: table.id,
      is_public:     true,
    });
    publicViewName = pub.view_name;
    // Custom row template so field values appear in the HTML
    await viewsService.saveViewTemplates(ctx.app.id, pub.id, {
      row: '<div class="wdp-row">${items.title}</div>',
    });

    // Private view (no group permissions — requires any authenticated session)
    const priv = await viewsService.createView({
      app_id:        ctx.app.id,
      view_name:     'priv-view',
      label:         'Private View',
      base_table_id: table.id,
      is_public:     false,
    });
    privateViewName = priv.view_name;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  it('public view is accessible without auth', async () => {
    const res = await request(getExpressApp())
      .get(`/api/v/${SLUG}/${publicViewName}`)
      .expect(200);
    expect(res.text).toContain('Hello World');
  });

  it('private view returns 401 without auth', async () => {
    await request(getExpressApp())
      .get(`/api/v/${SLUG}/${privateViewName}`)
      .expect(401);
  });

  it('private view is accessible to authenticated admin', async () => {
    // Admin session is already set on ctx.agent
    const res = await ctx.agent
      .get(`/api/v/${SLUG}/${privateViewName}`)
      .expect(200);
    // The view renders — content will be empty rows but no 401
    expect(res.text).not.toContain('Authentication required');
  });

  it('unknown view returns 404', async () => {
    await request(getExpressApp())
      .get(`/api/v/${SLUG}/does-not-exist`)
      .expect(404);
  });

  it('unknown app returns 404', async () => {
    await request(getExpressApp())
      .get('/api/v/no-such-app/any-view')
      .expect(404);
  });
});
