/**
 * Security regression tests.
 *
 * 1. DB config — blank password on save must not overwrite the existing password.
 *    Regression: the POST /admin/apps/:id/db-config route used `!== undefined`
 *    to detect a new password, but form submissions always include the field
 *    (as an empty string), so any save with a blank password field wiped the
 *    stored credentials.
 *
 * 2. Member login — returnTo query param must be validated to prevent open
 *    redirects. Only paths starting with '/' are followed; external URLs are
 *    silently ignored and the user is sent to the app home instead.
 */
import request from 'supertest';
import { createAdminContext, cleanupTestApp, getExpressApp } from './helpers/agent';
import * as appsService from '../src/services/apps';

// ── 1. DB config password preservation ───────────────────────────────────────

const DB_SLUG = 'security-db-test';

describe('DB config: password preservation', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;

  beforeAll(async () => {
    ctx = await createAdminContext(DB_SLUG);

    // Put the app into MySQL mode with an initial known password
    await appsService.updateApp(ctx.app.id, {
      database_mode:        'mysql' as const,
      database_config_json: JSON.stringify({
        host:     'localhost',
        port:     3306,
        database: 'testdb',
        username: 'testuser',
        password: 'original-password',
      }),
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  it('saves a new password when one is provided', async () => {
    await ctx.agent
      .post(`/admin/apps/${ctx.app.id}/db-config`)
      .type('form')
      .send({
        db_host:     'localhost',
        db_port:     '3306',
        db_name:     'testdb',
        db_username: 'testuser',
        db_password: 'new-password',
      })
      .expect(302);

    const app    = await appsService.getApp(ctx.app.id);
    const config = JSON.parse(app!.database_config_json);
    expect(config.password).toBe('new-password');
  });

  it('preserves the existing password when the field is submitted blank', async () => {
    // Set a known password first
    await ctx.agent
      .post(`/admin/apps/${ctx.app.id}/db-config`)
      .type('form')
      .send({
        db_host:     'localhost',
        db_port:     '3306',
        db_name:     'testdb',
        db_username: 'testuser',
        db_password: 'keep-this',
      })
      .expect(302);

    // Now submit with a blank password — should not wipe it
    await ctx.agent
      .post(`/admin/apps/${ctx.app.id}/db-config`)
      .type('form')
      .send({
        db_host:     'localhost',
        db_port:     '3306',
        db_name:     'testdb',
        db_username: 'testuser',
        db_password: '',
      })
      .expect(302);

    const app    = await appsService.getApp(ctx.app.id);
    const config = JSON.parse(app!.database_config_json);
    expect(config.password).toBe('keep-this');
  });
});

// ── 2. Member login open redirect ─────────────────────────────────────────────
//
// The `returnTo` field is submitted in the POST body (a hidden form input).
// On successful login, the route validates it before redirecting:
//   const dest = (returnTo && returnTo.startsWith('/')) ? returnTo : `/app/${slug}/`;
// We need a real member account to reach the success path.

const MEMBER_SLUG = 'security-redirect-test';

describe('Member login: open redirect prevention', () => {
  let ctx: Awaited<ReturnType<typeof createAdminContext>>;
  const MEMBER_EMAIL = 'test@example.com';
  const MEMBER_PASS  = 'correct-password';

  beforeAll(async () => {
    ctx = await createAdminContext(MEMBER_SLUG);

    // Create a real member so the login success path is reachable
    const { createMember } = await import('../src/services/members');
    await createMember({
      app_id:   ctx.app.id,
      email:    MEMBER_EMAIL,
      password: MEMBER_PASS,
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx.app.id);
  });

  it('ignores an external returnTo and redirects to app home on successful login', async () => {
    const res = await request(getExpressApp())
      .post(`/app/${MEMBER_SLUG}/login`)
      .type('form')
      .send({ email: MEMBER_EMAIL, password: MEMBER_PASS, returnTo: 'https://evil.com/steal' })
      .expect(302);

    expect(res.headers.location).not.toMatch(/^https?:\/\//);
    expect(res.headers.location).toBe(`/app/${MEMBER_SLUG}/`);
  });

  it('follows a local returnTo path starting with / on successful login', async () => {
    const localPath = `/app/${MEMBER_SLUG}/some-view`;
    const res = await request(getExpressApp())
      .post(`/app/${MEMBER_SLUG}/login`)
      .type('form')
      .send({ email: MEMBER_EMAIL, password: MEMBER_PASS, returnTo: localPath })
      .expect(302);

    expect(res.headers.location).toBe(localPath);
  });
});
