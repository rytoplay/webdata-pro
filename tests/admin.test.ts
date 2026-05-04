/**
 * Admin authentication + basic route access.
 */
import request from 'supertest';
import { getExpressApp } from './helpers/agent';

describe('Admin: authentication', () => {
  const app = getExpressApp();

  it('GET /admin redirects to login when unauthenticated', async () => {
    const res = await request(app).get('/admin').expect(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  it('POST /admin/login rejects wrong password', async () => {
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'wrong' })
      .expect(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  it('POST /admin/login accepts correct credentials', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'testpass' })
      .expect(302);
    expect(res.headers.location).not.toMatch(/\/admin\/login/);

    // After login, admin dashboard is accessible
    await agent.get('/admin').expect(200);
  });

  it('POST /admin/logout destroys the session', async () => {
    const agent = request.agent(app);
    await agent.post('/admin/login').type('form').send({ username: 'admin', password: 'testpass' });
    await agent.post('/admin/logout').expect(302);

    // Should be redirected to login again
    const res = await agent.get('/admin').expect(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  it('GET /admin (authenticated) returns 200', async () => {
    const agent = request.agent(app);
    await agent.post('/admin/login').type('form').send({ username: 'admin', password: 'testpass' });
    await agent.get('/admin').expect(200);
  });
});
