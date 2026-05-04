/**
 * Test helpers: creates a supertest agent pre-authenticated as admin,
 * with a test app already selected in the session.
 */
import request from 'supertest';
import { createApp as createExpressApp } from '../../src/app';
import * as appsService from '../../src/services/apps';
import { releaseAppDb } from '../../src/db/adapters/appDb';
import type { App } from '../../src/domain/types';
import type { Express } from 'express';

// One Express instance shared across all tests in a worker
let _expressApp: Express | null = null;

export function getExpressApp(): Express {
  if (!_expressApp) _expressApp = createExpressApp();
  return _expressApp;
}

export interface TestContext {
  agent: ReturnType<typeof request.agent>;
  app: App;
}

/**
 * Creates a test app, logs in as admin, and selects the app in the session.
 * Each test file should call this with a unique slug.
 */
export async function createAdminContext(slug: string): Promise<TestContext> {
  const httpApp = getExpressApp();
  const agent   = request.agent(httpApp);

  // Admin login
  await agent
    .post('/admin/login')
    .type('form')
    .send({ username: 'admin', password: 'testpass' })
    .expect(302);

  // Create the test app
  const app = await appsService.createApp({ name: `Test ${slug}`, slug });

  // Select it in the session
  await agent
    .post(`/admin/apps/${app.id}/select`)
    .type('form')
    .send({})
    .expect(302);

  return { agent, app };
}

/** Tears down a test app: releases DB connection and deletes all control DB rows. */
export async function cleanupTestApp(appId: number): Promise<void> {
  releaseAppDb(appId);
  await appsService.deleteApp(appId);
}
