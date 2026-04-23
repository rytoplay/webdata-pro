/**
 * Auto-seeds a Demo App on first start when no apps exist.
 * Called from server.ts after migrations complete.
 */

import { db } from '../db/knex';
import * as appsService from './apps';
import * as tablesService from './tables';
import * as fieldsService from './fields';
import * as viewsService from './views';
import * as groupsService from './groups';
import { getAppDb } from '../db/adapters/appDb';

export async function maybeSeedDemo(): Promise<void> {
  const appCount = await db('apps').count('id as n').first() as { n: number };
  if (Number(appCount?.n ?? 0) > 0) return;

  console.log('[seed] No apps found — creating Demo App…');

  // ── App ────────────────────────────────────────────────────────────────────
  const app = await appsService.createApp({
    name: 'Demo App',
    slug: 'demo',
    database_mode: 'sqlite',
  });

  // ── Table ──────────────────────────────────────────────────────────────────
  const table = await tablesService.createTable({
    app_id: app.id,
    table_name: 'books',
    label: 'Books',
    description: 'Sample books table',
    is_public_addable: false,
    is_member_editable: true,
  });

  // ── Fields ─────────────────────────────────────────────────────────────────
  const fieldDefs = [
    { field_name: 'title',          label: 'Title',          data_type: 'string'  as const, ui_widget: 'text'     as const, is_required: true,  is_searchable_default: true,  is_visible_default: true,  sort_order: 0 },
    { field_name: 'author',         label: 'Author',         data_type: 'string'  as const, ui_widget: 'text'     as const, is_required: false, is_searchable_default: true,  is_visible_default: true,  sort_order: 1 },
    { field_name: 'genre',          label: 'Genre',          data_type: 'string'  as const, ui_widget: 'text'     as const, is_required: false, is_searchable_default: false, is_visible_default: true,  sort_order: 2 },
    { field_name: 'published_year', label: 'Published year', data_type: 'integer' as const, ui_widget: 'number'   as const, is_required: false, is_searchable_default: false, is_visible_default: true,  sort_order: 3 },
    { field_name: 'summary',        label: 'Summary',        data_type: 'text'    as const, ui_widget: 'textarea' as const, is_required: false, is_searchable_default: false, is_visible_default: false, sort_order: 4 },
  ];

  for (const f of fieldDefs) {
    await fieldsService.createField({ table_id: table.id, ...f });
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  const publicView = await viewsService.createView({
    app_id: app.id,
    view_name: 'books',
    label: 'Books',
    base_table_id: table.id,
    is_public: true,
    primary_sort_field: 'title',
    primary_sort_direction: 'asc',
  });

  const manageView = await viewsService.createView({
    app_id: app.id,
    view_name: 'manage-books',
    label: 'Manage Books',
    base_table_id: table.id,
    is_public: false,
    primary_sort_field: 'title',
    primary_sort_direction: 'asc',
  });

  // ── Auth provider ──────────────────────────────────────────────────────────
  await db('auth_providers').insert({
    app_id: app.id,
    provider_name: 'local',
    provider_type: 'local',
    is_enabled: true,
    is_default: true,
  });

  // ── Groups ─────────────────────────────────────────────────────────────────
  const adminGroup = await groupsService.createGroup({
    app_id: app.id,
    group_name: 'Administrators',
    description: 'Full access',
    default_home_view_id: manageView.id,
  });

  await db('group_table_permissions').insert({
    group_id: adminGroup.id,
    table_id: table.id,
    can_add: true, can_edit: true, can_delete: true, manage_all: true, single_record: false,
    can_view: true, can_edit_all_records: true, can_edit_own_records_only: false,
    can_view_all_records: true, can_view_own_records_only: false,
  });

  await db('view_group_permissions').insert({
    group_id: adminGroup.id,
    view_id: manageView.id,
    can_view: true,
    limit_to_own_records: false,
  });

  const memberGroup = await groupsService.createGroup({
    app_id: app.id,
    group_name: 'Members',
    description: 'Browse books',
    self_register_enabled: false,
    default_home_view_id: publicView.id,
  });

  await db('group_table_permissions').insert({
    group_id: memberGroup.id,
    table_id: table.id,
    can_add: false, can_edit: false, can_delete: false, manage_all: false, single_record: false,
    can_view: true, can_edit_all_records: false, can_edit_own_records_only: false,
    can_view_all_records: true, can_view_own_records_only: false,
  });

  await db('view_group_permissions').insert({
    group_id: memberGroup.id,
    view_id: publicView.id,
    can_view: true,
    limit_to_own_records: false,
  });

  // ── Sample data ────────────────────────────────────────────────────────────
  const appDb = getAppDb(app);
  await appDb(table.table_name).insert([
    { title: 'The Great Gatsby',        author: 'F. Scott Fitzgerald', genre: 'Fiction',    published_year: 1925, summary: 'A story of wealth and obsession in the Jazz Age.' },
    { title: 'To Kill a Mockingbird',   author: 'Harper Lee',          genre: 'Fiction',    published_year: 1960, summary: 'A young girl witnesses racial injustice in the American South.' },
    { title: '1984',                    author: 'George Orwell',        genre: 'Dystopia',   published_year: 1949, summary: 'A totalitarian future where Big Brother watches everything.' },
    { title: 'Pride and Prejudice',     author: 'Jane Austen',          genre: 'Romance',    published_year: 1813, summary: 'Elizabeth Bennet navigates love and social class in England.' },
    { title: 'The Hobbit',              author: 'J.R.R. Tolkien',       genre: 'Fantasy',    published_year: 1937, summary: 'Bilbo Baggins is swept into an epic quest.' },
  ]);

  console.log(`[seed] Demo App created (id=${app.id}, slug=demo) with ${fieldDefs.length} fields and 5 sample books.`);
}
