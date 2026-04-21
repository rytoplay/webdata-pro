import { Router } from 'express';
import { z } from 'zod';
import nunjucks from 'nunjucks';
import { generateSecret as otpGenerateSecret, generate as otpGenerate, verify as otpVerify, generateURI as otpGenerateURI } from 'otplib';
import qrcode from 'qrcode';
import { db } from '../../db/knex';
import * as membersService from '../../services/members';
import * as emailService from '../../services/email';
import type { App } from '../../domain/types';
import { getAppDb } from '../../db/adapters/appDb';
import { renderBrandingTemplate, getBranding } from './branding';
import { memberTableRouter } from './table';

const RegisterSchema = z.object({
  first_name:       z.string().optional(),
  last_name:        z.string().optional(),
  email:            z.string().email('Enter a valid email address'),
  password:         z.string().min(8, 'Password must be at least 8 characters'),
  password_confirm: z.string(),
}).refine(d => d.password === d.password_confirm, {
  message: 'Passwords do not match',
  path: ['password_confirm'],
});

function renderHomeTemplate(
  template: string,
  app: App,
  member: object,
  browseViews: any[],
  manageViews: any[],
  tables: any[],
  portalHeader = '',
  portalFooter = '',
): string {
  try {
    let _widgetCount = 0;

    // embedView('viewname') — renders a full WDP view widget inline
    const embedView = (viewName: string) => {
      const id = `wdp-view-${++_widgetCount}`;
      return `<div id="${id}" class="wdp-widget mb-4"></div>` +
        `<script>WDP.mount('#${id}', {app:'${app.slug}', view:'${viewName}'});<\/script>`;
    };

    // viewUrl('viewname') — returns the member view page URL
    const viewUrl = (viewName: string) => `/app/${app.slug}/view/${viewName}`;

    // Resolve $portal_header / $portal_footer before Nunjucks so they aren't treated as unknown vars
    const resolved = template
      .replace(/\$portal_header/g, portalHeader)
      .replace(/\$portal_footer/g, portalFooter);

    // views = combined list for backward compat with custom templates
    const views = [...browseViews, ...manageViews];
    return nunjucks.renderString(resolved, {
      app, member, views, browseViews, manageViews, tables, embedView, viewUrl,
      logoutUrl: `/app/${app.slug}/logout`,
    });
  } catch (err: any) {
    return `<p style="color:red"><strong>Template error:</strong> ${err.message}</p>`;
  }
}

// Helper: does this member need TOTP? Returns 'verify'|'setup'|'none'
async function totpStatus(
  memberId: number,
  groupIds: number[],
): Promise<'verify' | 'setup' | 'none'> {
  if (groupIds.length === 0) return 'none';
  const requiresGroup = await db('groups')
    .whereIn('id', groupIds)
    .where({ tfa_required: true })
    .first();
  if (!requiresGroup) return 'none';
  const secret = await membersService.getTfaSecret(memberId);
  return secret ? 'verify' : 'setup';
}

// ── Member view/table helper ─────────────────────────────────────────────────

/**
 * Returns all views a member can access, split into two groups:
 *  - browseViews: views where the member has no edit/add rights on the table
 *  - manageViews: views where the member can add/edit records, or single_record views
 */
async function getMemberViews(
  appId: number,
  groupIds: number[],
  appSlug: string,
): Promise<{ browseViews: any[]; manageViews: any[] }> {
  if (!groupIds.length) return { browseViews: [], manageViews: [] };

  const rows = await db('views')
    .join('view_group_permissions', 'view_group_permissions.view_id', 'views.id')
    .whereIn('view_group_permissions.group_id', groupIds)
    .where('view_group_permissions.can_view', true)
    .where('views.app_id', appId)
    .distinct(
      'views.id', 'views.label', 'views.view_name', 'views.base_table_id',
      'view_group_permissions.limit_to_own_records',
    )
    .orderBy('views.label');

  // Which tables does this member have add/edit rights on, and which are single_record?
  const tablePerms = await db('group_table_permissions')
    .whereIn('group_id', groupIds)
    .select('table_id', 'can_add', 'can_edit', 'manage_all', 'single_record');

  const editableTables = new Set(
    tablePerms
      .filter((p: any) => p.can_add || p.can_edit || p.manage_all)
      .map((p: any) => p.table_id)
  );
  const singleRecordTables = new Set(
    tablePerms
      .filter((p: any) => p.single_record)
      .map((p: any) => p.table_id)
  );

  const views = rows.map((v: any) => ({
    ...v,
    url:          `/app/${appSlug}/view/${v.view_name}`,
    canEdit:      editableTables.has(v.base_table_id),
    singleRecord: singleRecordTables.has(v.base_table_id),
  }));

  return {
    browseViews: views.filter((v: any) => !v.canEdit && !v.singleRecord),
    manageViews: views.filter((v: any) => v.canEdit || v.singleRecord),
  };
}

// ── Member table access helper ───────────────────────────────────────────────

/**
 * Returns all tables a member can directly access (add/edit/delete/manage_all),
 * merged across all their groups, with CTA metadata for the homepage.
 */
async function getMemberTableAccess(
  app: App,
  groupIds: number[],
  memberId: number,
): Promise<any[]> {
  if (!groupIds.length) return [];

  const perms = await db('group_table_permissions')
    .whereIn('group_id', groupIds)
    .select('table_id', 'can_add', 'can_edit', 'can_delete', 'manage_all', 'single_record');

  if (!perms.length) return [];

  // Merge permissions across groups (OR logic)
  const merged = new Map<number, {
    can_add: boolean; can_edit: boolean; can_delete: boolean;
    manage_all: boolean; single_record: boolean;
  }>();
  for (const p of perms) {
    const ex = merged.get(p.table_id);
    if (!ex) {
      merged.set(p.table_id, {
        can_add:       !!p.can_add,
        can_edit:      !!p.can_edit,
        can_delete:    !!p.can_delete,
        manage_all:    !!p.manage_all,
        single_record: !!p.single_record,
      });
    } else {
      ex.can_add       = ex.can_add       || !!p.can_add;
      ex.can_edit      = ex.can_edit      || !!p.can_edit;
      ex.can_delete    = ex.can_delete    || !!p.can_delete;
      ex.manage_all    = ex.manage_all    || !!p.manage_all;
      ex.single_record = ex.single_record || !!p.single_record;
    }
  }

  // Only include tables where the member can actually do something
  const actionableIds = [...merged.entries()]
    .filter(([, p]) => p.can_add || p.can_edit || p.manage_all)
    .map(([id]) => id);
  if (!actionableIds.length) return [];

  const tables = await db('app_tables')
    .whereIn('id', actionableIds)
    .where({ app_id: app.id })
    .orderBy('label');

  const appDb = getAppDb(app);
  const result = [];

  for (const table of tables) {
    const perm = merged.get(table.id)!;
    let existingRecordId: string | null = null;

    if (perm.single_record) {
      try {
        const meta = await appDb('_wdpro_metadata')
          .where({ table_name: table.table_name, created_by_id: memberId })
          .orderBy('created_at', 'desc')
          .first();
        existingRecordId = meta?.record_id ?? null;
      } catch { /* metadata table not created yet */ }
    }

    result.push({
      ...table,
      ...perm,
      existingRecordId,
      tableUrl: `/app/${app.slug}/table/${table.table_name}`,
      newUrl:   `/app/${app.slug}/table/${table.table_name}/new`,
      editUrl:  existingRecordId ? `/app/${app.slug}/table/${table.table_name}/${existingRecordId}/edit` : null,
    });
  }

  return result;
}

// Default home template used when no group or app template has been configured.
const DEFAULT_HOME_TEMPLATE = `
$portal_header
<div style="max-width:680px;margin:2rem auto;padding:0 1rem;font-family:sans-serif;">
  <h2 style="font-size:1.5rem;font-weight:700;margin-bottom:0.25rem;">
    Welcome{% if member.first_name %}, {{ member.first_name }}{% endif %}!
  </h2>
  <p style="color:#6b7280;margin-bottom:2rem;">You are signed in to <strong>{{ app.name }}</strong>.</p>

  {% if browseViews.length %}
  <h3 style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:0.75rem;">Browse &amp; Search</h3>
  <div style="display:grid;gap:0.6rem;margin-bottom:2rem;">
    {% for v in browseViews %}
    <a href="{{ v.url }}" style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.1rem;
        background:#fff;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit;
        box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <span style="font-size:1.1rem;line-height:1;">&#128269;</span>
      <span style="font-weight:600;font-size:0.95rem;">{{ v.label }}</span>
      <span style="margin-left:auto;color:#9ca3af;font-size:0.85rem;">&#8250;</span>
    </a>
    {% endfor %}
  </div>
  {% endif %}

  {% if manageViews.length %}
  <h3 style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:0.75rem;">Searches and Reports</h3>
  <div style="display:grid;gap:0.6rem;margin-bottom:2rem;">
    {% for v in manageViews %}
    <a href="{{ v.url }}" style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.1rem;
        background:#fff;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit;
        box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <span style="font-size:1.1rem;line-height:1;">&#9998;</span>
      <span style="font-weight:600;font-size:0.95rem;">{{ v.label }}</span>
      <span style="margin-left:auto;color:#9ca3af;font-size:0.85rem;">&#8250;</span>
    </a>
    {% endfor %}
  </div>
  {% endif %}

  {% if tables.length %}
  <h3 style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:0.75rem;">Manage Data</h3>
  <div style="display:grid;gap:0.6rem;margin-bottom:2rem;">
    {% for t in tables %}
      {% if t.single_record %}
        {% if t.existingRecordId %}
        <a href="{{ t.editUrl }}" style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.1rem;
            background:#fff;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit;
            box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <span style="font-size:1.1rem;line-height:1;">&#9998;</span>
          <span style="font-weight:600;font-size:0.95rem;">Edit my {{ t.label }}</span>
          <span style="margin-left:auto;color:#9ca3af;font-size:0.85rem;">&#8250;</span>
        </a>
        {% elif t.can_add %}
        <a href="{{ t.newUrl }}" style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.1rem;
            background:#fff;border:1px solid #d1fae5;border-radius:10px;text-decoration:none;color:inherit;
            box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <span style="font-size:1.1rem;line-height:1;">&#43;</span>
          <span style="font-weight:600;font-size:0.95rem;">Create {{ t.label }}</span>
          <span style="margin-left:auto;color:#9ca3af;font-size:0.85rem;">&#8250;</span>
        </a>
        {% endif %}
      {% else %}
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <a href="{{ t.tableUrl }}" style="flex:1;display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.1rem;
            background:#fff;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit;
            box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <span style="font-size:1.1rem;line-height:1;">&#128196;</span>
          <span style="font-weight:600;font-size:0.95rem;">{{ t.label }}</span>
          <span style="margin-left:auto;color:#9ca3af;font-size:0.85rem;">&#8250;</span>
        </a>
        {% if t.can_add %}
        <a href="{{ t.newUrl }}" style="padding:0.85rem 1rem;background:#fff;border:1px solid #e5e7eb;
            border-radius:10px;text-decoration:none;color:#374151;font-weight:600;white-space:nowrap;
            box-shadow:0 1px 3px rgba(0,0,0,0.06);font-size:0.85rem;">
          &#43; Add
        </a>
        {% endif %}
      </div>
      {% endif %}
    {% endfor %}
  </div>
  {% endif %}

  {% if not browseViews.length and not manageViews.length and not tables.length %}
  <p style="color:#9ca3af;">You don't have access to any content yet. Contact your administrator.</p>
  {% endif %}

  <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e5e7eb;text-align:right;">
    <a href="{{ logoutUrl }}" style="font-size:0.85rem;color:#6b7280;text-decoration:none;">Sign out</a>
  </div>
</div>
$portal_footer
`.trim();

export const memberRouter = Router({ mergeParams: true });

// ── Load app by slug ─────────────────────────────────────────────────────────

memberRouter.use(async (req, res, next) => {
  const { appSlug } = req.params as { appSlug: string };
  const app = await db('apps').where({ slug: appSlug }).first() as App | undefined;
  if (!app) return res.status(404).send('App not found');
  res.locals.memberApp = app;
  next();
});

// ── GET /app/:appSlug/ ───────────────────────────────────────────────────────

memberRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login`);
    }

    // Check if any of the member's groups has a default home view → redirect straight there
    if (member.groupIds.length > 0) {
      const groupWithHome = await db('groups')
        .whereIn('id', member.groupIds)
        .whereNotNull('default_home_view_id')
        .first();
      if (groupWithHome) {
        const homeView = await db('views').where({ id: groupWithHome.default_home_view_id }).first();
        if (homeView) return res.redirect(`/app/${app.slug}/view/${homeView.view_name}`);
      }
    }

    const freshApp = await db('apps').where({ id: app.id }).first();
    const [{ browseViews, manageViews }, tables] = await Promise.all([
      getMemberViews(app.id, member.groupIds, app.slug),
      getMemberTableAccess(freshApp, member.groupIds, member.memberId),
    ]);

    // Use home_template from first matching group that has one
    let groupTemplate: string | null = null;
    let groupHomeHeader: string | null = null;
    let groupHomeFooter: string | null = null;
    if (member.groupIds.length > 0) {
      const groupWithTemplate = await db('groups')
        .whereIn('id', member.groupIds)
        .whereNotNull('home_template')
        .first();
      groupTemplate   = groupWithTemplate?.home_template    ?? null;
      groupHomeHeader = groupWithTemplate?.home_header_html ?? null;
      groupHomeFooter = groupWithTemplate?.home_footer_html ?? null;
    }

    const memberData = await membersService.getMember(member.memberId);
    const { headerHtml, footerHtml } = await getBranding(freshApp, member.memberId);

    const template = groupTemplate ?? freshApp.home_template ?? DEFAULT_HOME_TEMPLATE;
    const memberCtx = memberData || member;
    const pH = headerHtml ?? '';
    const pF = footerHtml ?? '';
    const bodyHtml = renderHomeTemplate(template, freshApp, memberCtx, browseViews, manageViews, tables, pH, pF);
    const homeParts = [
      groupHomeHeader ? renderBrandingTemplate(groupHomeHeader, freshApp, memberCtx, pH, pF) : '',
      bodyHtml,
      groupHomeFooter ? renderBrandingTemplate(groupHomeFooter, freshApp, memberCtx, pH, pF) : '',
    ].filter(Boolean);
    return res.render('member/home', {
      title: app.name, app: freshApp, renderedHtml: homeParts.join('\n'),
      suppressPortalNav: true, memberLogoutUrl: `/app/${app.slug}/logout`,
    });
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/view/:viewName ─────────────────────────────────────────

memberRouter.get('/view/:viewName', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const view = await db('views').where({ app_id: app.id, view_name: req.params.viewName }).first();
    if (!view) return res.status(404).send('View not found');

    // Check if this view's base table is single_record for any of the member's groups
    const singleRecordPerm = member.groupIds.length > 0
      ? await db('group_table_permissions')
          .whereIn('group_id', member.groupIds)
          .where({ table_id: view.base_table_id, single_record: true })
          .first()
      : null;

    if (singleRecordPerm) {
      // Find the base table name for this view
      const baseTable = await db('app_tables').where({ id: view.base_table_id }).first();
      const baseTableName = baseTable?.table_name ?? null;

      let existingRecordId: string | null = null;
      if (baseTableName) {
        const { getAppDb } = await import('../../db/adapters/appDb');
        const appDb = getAppDb(app);
        const metaRow = await appDb('_wdpro_metadata')
          .where({ table_name: baseTableName, created_by_id: member.memberId })
          .orderBy('created_at', 'desc')
          .first();
        existingRecordId = metaRow?.record_id ?? null;
      }

      const { headerHtml, footerHtml } = await getBranding(app, member.memberId);
      return res.render('member/view', {
        title: `${view.label} — ${app.name}`,
        app, view, singleRecord: true, existingRecordId,
        headerHtml, footerHtml,
        suppressPortalNav: !!headerHtml,
        memberLogoutUrl: `/app/${app.slug}/logout`,
        homeUrl:    `/app/${app.slug}/`,
        sitemapUrl: `/app/${app.slug}/sitemap`,
      });
    }

    const { headerHtml, footerHtml } = await getBranding(app, member.memberId);
    res.render('member/view', {
      title: `${view.label} — ${app.name}`, app, view,
      headerHtml, footerHtml,
      suppressPortalNav: !!headerHtml,
      memberLogoutUrl: `/app/${app.slug}/logout`,
      homeUrl:    `/app/${app.slug}/`,
      sitemapUrl: `/app/${app.slug}/sitemap`,
    });
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/register ───────────────────────────────────────────────

memberRouter.get('/register', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const selfRegGroups = await db('groups')
      .where({ app_id: app.id, self_register_enabled: true });
    if (selfRegGroups.length === 0) {
      return res.status(403).send('Self-registration is not enabled for this app.');
    }
    if (req.session.member?.appId === app.id) {
      return res.redirect(`/app/${app.slug}/`);
    }
    const flash = req.session.flash; delete req.session.flash;
    res.render('member/register', { title: `Create account — ${app.name}`, app, flash, formData: null, errors: null });
  } catch (err) { next(err); }
});

// ── POST /app/:appSlug/register ──────────────────────────────────────────────

memberRouter.post('/register', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;

    const selfRegGroups = await db('groups')
      .where({ app_id: app.id, self_register_enabled: true });
    if (selfRegGroups.length === 0) {
      return res.status(403).send('Self-registration is not enabled for this app.');
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('member/register', {
        title: `Create account — ${app.name}`,
        app,
        flash: null,
        formData: req.body,
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { email, password, first_name, last_name } = parsed.data;

    // Check for duplicate email
    const existing = await membersService.getMemberByEmail(app.id, email);
    if (existing) {
      return res.render('member/register', {
        title: `Create account — ${app.name}`,
        app,
        flash: null,
        formData: req.body,
        errors: { email: ['An account with this email already exists.'] },
      });
    }

    const member = await membersService.createMember({
      app_id: app.id,
      email,
      password,
      first_name: first_name || null,
      last_name:  last_name  || null,
    });

    // Assign to all self-register-enabled groups
    for (const group of selfRegGroups) {
      await membersService.assignMemberToGroup(member.id, group.id);
    }

    const groupIds = selfRegGroups.map((g: { id: number }) => g.id);
    const returnTo = `/app/${app.slug}/`;

    // Check if TOTP setup is required
    const tfaStatus = await totpStatus(member.id, groupIds);
    if (tfaStatus === 'setup') {
      const secret = await otpGenerateSecret();
      req.session.pendingTotpSetup = { memberId: member.id, appId: app.id, groupIds, secret, returnTo };
      return res.redirect(`/app/${app.slug}/totp-setup`);
    }

    req.session.member = { memberId: member.id, appId: app.id, groupIds };
    res.redirect(returnTo);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/login ──────────────────────────────────────────────────

memberRouter.get('/login', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    if (req.session.member?.appId === app.id) {
      return res.redirect(req.query.returnTo as string || `/app/${app.slug}/`);
    }
    const flash = req.session.flash; delete req.session.flash;
    const selfRegCount = await db('groups')
      .where({ app_id: app.id, self_register_enabled: true }).count('id as n').first();
    const { headerHtml, footerHtml } = await getBranding(app, null);
    res.render('member/login', {
      title: `Sign in — ${app.name}`,
      app,
      returnTo:        req.query.returnTo || '',
      flash,
      allowRegister:   Number(selfRegCount?.n ?? 0) > 0,
      headerHtml,
      footerHtml,
      memberLogoutUrl: null,
    });
  } catch (err) { next(err); }
});

// ── POST /app/:appSlug/login ─────────────────────────────────────────────────

memberRouter.post('/login', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const { email, password, returnTo } = req.body as { email: string; password: string; returnTo: string };

    const member = await membersService.getMemberByEmail(app.id, email);

    const invalid = async () => {
      const { headerHtml, footerHtml } = await getBranding(app, null);
      return res.render('member/login', {
        title: `Sign in — ${app.name}`,
        app,
        returnTo:        returnTo || '',
        flash:           { type: 'danger', message: 'Invalid email or password.' },
        allowRegister:   false,
        headerHtml,
        footerHtml,
        memberLogoutUrl: null,
      });
    };

    if (!member || !member.is_active) return invalid();

    const ok = await membersService.verifyPassword(member, password);
    if (!ok) return invalid();

    const groupIds = await membersService.getMemberGroups(member.id);
    const dest = (returnTo && returnTo.startsWith('/')) ? returnTo : `/app/${app.slug}/`;

    // Check if TOTP is needed
    const tfaStatus = await totpStatus(member.id, groupIds);

    if (tfaStatus === 'verify') {
      req.session.pendingMember = { memberId: member.id, appId: app.id, groupIds, returnTo: dest };
      return res.redirect(`/app/${app.slug}/totp-verify`);
    }

    if (tfaStatus === 'setup') {
      const secret = await otpGenerateSecret();
      req.session.pendingTotpSetup = { memberId: member.id, appId: app.id, groupIds, secret, returnTo: dest };
      return res.redirect(`/app/${app.slug}/totp-setup`);
    }

    req.session.member = { memberId: member.id, appId: app.id, groupIds };
    res.redirect(dest);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/totp-verify ────────────────────────────────────────────

memberRouter.get('/totp-verify', (req, res) => {
  const app = res.locals.memberApp as App;
  if (!req.session.pendingMember || req.session.pendingMember.appId !== app.id) {
    return res.redirect(`/app/${app.slug}/login`);
  }
  const flash = req.session.flash; delete req.session.flash;
  res.render('member/totp-verify', { title: `Verify identity — ${app.name}`, app, flash });
});

// ── POST /app/:appSlug/totp-verify ───────────────────────────────────────────

memberRouter.post('/totp-verify', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const pending = req.session.pendingMember;
    if (!pending || pending.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login`);
    }

    const { code } = req.body as { code: string };
    const secret = await membersService.getTfaSecret(pending.memberId);

    const result = secret ? await otpVerify({ token: code?.trim() || '', secret }) : null;
    if (!result || !result.valid) {
      req.session.flash = { type: 'danger', message: 'Invalid code. Please try again.' };
      return res.redirect(`/app/${app.slug}/totp-verify`);
    }

    // Promote to full session
    delete req.session.pendingMember;
    req.session.member = { memberId: pending.memberId, appId: pending.appId, groupIds: pending.groupIds };
    res.redirect(pending.returnTo || `/app/${app.slug}/`);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/totp-setup ─────────────────────────────────────────────

memberRouter.get('/totp-setup', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const pending = req.session.pendingTotpSetup;
    if (!pending || pending.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login`);
    }

    const flash = req.session.flash; delete req.session.flash;

    // Get member email for the QR label
    const member = await db('members').where({ id: pending.memberId }).select('email').first();
    const otpAuthUrl = await otpGenerateURI({
      label: member?.email || 'user',
      issuer: app.name,
      secret: pending.secret,
    });
    const qrDataUrl = await qrcode.toDataURL(otpAuthUrl);

    res.render('member/totp-setup', {
      title: `Set up two-factor authentication — ${app.name}`,
      app,
      flash,
      secret: pending.secret,
      qrDataUrl,
    });
  } catch (err) { next(err); }
});

// ── POST /app/:appSlug/totp-setup ────────────────────────────────────────────

memberRouter.post('/totp-setup', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const pending = req.session.pendingTotpSetup;
    if (!pending || pending.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login`);
    }

    const { code } = req.body as { code: string };

    const setupResult = await otpVerify({ token: code?.trim() || '', secret: pending.secret });
    if (!setupResult.valid) {
      req.session.flash = { type: 'danger', message: 'That code is incorrect. Please scan the QR code again and enter the 6-digit code from your app.' };
      return res.redirect(`/app/${app.slug}/totp-setup`);
    }

    // Save the verified secret
    await membersService.setTfaSecret(pending.memberId, pending.secret);

    // Promote to full session
    delete req.session.pendingTotpSetup;
    req.session.member = { memberId: pending.memberId, appId: pending.appId, groupIds: pending.groupIds };
    req.session.flash = { type: 'success', message: 'Two-factor authentication is now enabled on your account.' };
    res.redirect(pending.returnTo || `/app/${app.slug}/`);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/forgot ─────────────────────────────────────────────────

memberRouter.get('/forgot', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const flash = req.session.flash; delete req.session.flash;
    res.render('member/forgot', { title: `Forgot password — ${app.name}`, app, flash, sent: false });
  } catch (err) { next(err); }
});

// ── POST /app/:appSlug/forgot ────────────────────────────────────────────────

memberRouter.post('/forgot', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const { email } = req.body as { email: string };

    // Always show the same "check your email" message to avoid enumeration
    const showSent = () =>
      res.render('member/forgot', {
        title: `Forgot password — ${app.name}`,
        app,
        flash: null,
        sent: true,
      });

    if (!email) return showSent();

    const member = await membersService.getMemberByEmail(app.id, email.trim().toLowerCase());
    if (!member || !member.is_active) return showSent();

    let emailConfigured = false;
    try { emailConfigured = await emailService.isEmailConfigured(); } catch {}

    if (!emailConfigured) {
      return res.render('member/forgot', {
        title: `Forgot password — ${app.name}`,
        app,
        flash: { type: 'warning', message: 'Email is not configured for this app. Please contact your administrator to reset your password.' },
        sent: false,
      });
    }

    const token = await membersService.createResetToken(member.id);
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host     = req.headers['x-forwarded-host']  || req.headers.host;
    const resetUrl = `${protocol}://${host}/app/${app.slug}/reset?token=${token}`;

    try {
      await emailService.sendPasswordResetEmail(email.trim(), resetUrl, app.name);
    } catch (err: any) {
      return res.render('member/forgot', {
        title: `Forgot password — ${app.name}`,
        app,
        flash: { type: 'danger', message: `Could not send email: ${err.message}` },
        sent: false,
      });
    }

    showSent();
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/reset ──────────────────────────────────────────────────

memberRouter.get('/reset', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const token = req.query.token as string;
    const flash = req.session.flash; delete req.session.flash;

    const memberId = token ? await membersService.peekResetToken(token) : null;
    if (!memberId) {
      return res.render('member/reset', {
        title: `Reset password — ${app.name}`,
        app,
        flash: { type: 'danger', message: 'This reset link is invalid or has expired.' },
        token: null,
        valid: false,
      });
    }

    res.render('member/reset', { title: `Reset password — ${app.name}`, app, flash, token, valid: true });
  } catch (err) { next(err); }
});

// ── POST /app/:appSlug/reset ─────────────────────────────────────────────────

memberRouter.post('/reset', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const { token, password, password_confirm } = req.body as {
      token: string; password: string; password_confirm: string;
    };

    const memberId = token ? await membersService.peekResetToken(token) : null;
    if (!memberId) {
      return res.render('member/reset', {
        title: `Reset password — ${app.name}`,
        app,
        flash: { type: 'danger', message: 'This reset link is invalid or has expired.' },
        token: null,
        valid: false,
      });
    }

    if (!password || password.length < 8) {
      return res.render('member/reset', {
        title: `Reset password — ${app.name}`,
        app,
        flash: { type: 'danger', message: 'Password must be at least 8 characters.' },
        token,
        valid: true,
      });
    }

    if (password !== password_confirm) {
      return res.render('member/reset', {
        title: `Reset password — ${app.name}`,
        app,
        flash: { type: 'danger', message: 'Passwords do not match.' },
        token,
        valid: true,
      });
    }

    // Consume token and set new password
    const confirmedId = await membersService.consumeResetToken(token);
    if (!confirmedId) {
      // Token was used between peek and consume — extremely unlikely but safe
      return res.redirect(`/app/${app.slug}/forgot`);
    }

    await membersService.setPassword(confirmedId, password);

    // Check if TOTP is needed for the new login
    const groupIds = await membersService.getMemberGroups(confirmedId);
    const tfaStatus = await totpStatus(confirmedId, groupIds);

    req.session.flash = { type: 'success', message: 'Password updated. Please sign in.' };

    if (tfaStatus === 'verify') {
      req.session.pendingMember = { memberId: confirmedId, appId: app.id, groupIds, returnTo: `/app/${app.slug}/` };
      return res.redirect(`/app/${app.slug}/totp-verify`);
    }

    res.redirect(`/app/${app.slug}/login`);
  } catch (err) { next(err); }
});

// ── GET /app/:appSlug/sitemap ────────────────────────────────────────────────

memberRouter.get('/sitemap', async (req, res, next) => {
  try {
    const app = res.locals.memberApp as App;
    const member = req.session.member;
    if (!member || member.appId !== app.id) {
      return res.redirect(`/app/${app.slug}/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const [{ browseViews, manageViews }, tables, { headerHtml, footerHtml }] = await Promise.all([
      getMemberViews(app.id, member.groupIds, app.slug),
      getMemberTableAccess(app, member.groupIds, member.memberId),
      getBranding(app, member.memberId),
    ]);
    res.render('member/sitemap', {
      title: `Site Map — ${app.name}`,
      app,
      browseViews,
      manageViews,
      tables,
      headerHtml,
      footerHtml,
      suppressPortalNav: !!headerHtml,
      memberLogoutUrl: `/app/${app.slug}/logout`,
      homeUrl:    `/app/${app.slug}/`,
      sitemapUrl: `/app/${app.slug}/sitemap`,
    });
  } catch (err) { next(err); }
});

// ── Table CRUD sub-router ────────────────────────────────────────────────────

memberRouter.use('/table', memberTableRouter);

// ── GET /app/:appSlug/logout ─────────────────────────────────────────────────

memberRouter.get('/logout', async (req, res) => {
  const app = res.locals.memberApp as App;
  const member = req.session.member;

  // Check if any of the member's groups has a post_logout_url configured
  let postLogoutUrl: string | null = null;
  if (member?.groupIds?.length) {
    const group = await db('groups')
      .whereIn('id', member.groupIds)
      .whereNotNull('post_logout_url')
      .where('post_logout_url', '!=', '')
      .first();
    postLogoutUrl = group?.post_logout_url ?? null;
  }

  delete req.session.member;
  delete req.session.pendingMember;
  delete req.session.pendingTotpSetup;
  res.redirect(postLogoutUrl ?? `/app/${app.slug}/login`);
});
