import { db } from '../db/knex';
import type { App, CreateAppInput, UpdateAppInput } from '../domain/types';

export async function listApps(): Promise<App[]> {
  return db('apps').orderBy('name');
}

export async function getApp(id: number): Promise<App | undefined> {
  return db('apps').where({ id }).first();
}

export async function getAppBySlug(slug: string): Promise<App | undefined> {
  return db('apps').where({ slug }).first();
}

export async function createApp(input: CreateAppInput): Promise<App> {
  const [id] = await db('apps').insert({
    name: input.name,
    slug: input.slug,
    database_mode: input.database_mode ?? 'sqlite',
    database_config_json: input.database_config_json ?? null
  });
  return db('apps').where({ id }).first() as Promise<App>;
}

export async function updateApp(id: number, input: UpdateAppInput): Promise<App | undefined> {
  await db('apps').where({ id }).update(input);
  return getApp(id);
}

export async function deleteApp(id: number): Promise<void> {
  await db('apps').where({ id }).delete();
}
