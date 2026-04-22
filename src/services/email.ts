import nodemailer from 'nodemailer';
import { db } from '../db/knex';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const rows = await db('settings').whereIn('key', [
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  ]);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value ?? '';

  if (!map['smtp_host'] || !map['smtp_user']) return null;

  return {
    host:   map['smtp_host'],
    port:   parseInt(map['smtp_port'] || '587', 10),
    secure: map['smtp_secure'] === 'true',
    user:   map['smtp_user'],
    pass:   map['smtp_pass'] || '',
    from:   map['smtp_from'] || map['smtp_user'],
  };
}

export async function isEmailConfigured(): Promise<boolean> {
  const cfg = await getSmtpConfig();
  return cfg !== null;
}

export async function sendNewRecordNotification(
  toEmail: string,
  appName: string,
  tableLabel: string,
  recordId: string | null,
  submittedBy: string,
): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return; // silently skip — SMTP not configured

  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const when = new Date().toLocaleString();
  const recordLine = recordId ? `<br>Record ID: <strong>${recordId}</strong>` : '';

  await transporter.sendMail({
    from:    `"${appName}" <${cfg.from}>`,
    to:      toEmail,
    subject: `New record in ${tableLabel} — ${appName}`,
    html: `
      <p>A new record was submitted to the <strong>${tableLabel}</strong> table
         in your <strong>${appName}</strong> app.</p>
      <p>Submitted by: <strong>${submittedBy}</strong><br>
         Time: ${when}${recordLine}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb">
      <p style="font-size:0.8em;color:#6b7280">You are receiving this because admin notifications
         are enabled for ${appName}. Manage settings in the App Settings page.</p>
    `,
    text: `New record in ${tableLabel} — ${appName}\nSubmitted by: ${submittedBy}\nTime: ${when}${recordId ? `\nRecord ID: ${recordId}` : ''}`,
  });
}

export async function sendDailyDigest(): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return;

  // Find all apps that have daily mode and a notify email
  const apps = await db('apps')
    .whereNotNull('notify_admin_email')
    .where('notify_mode', 'daily')
    .whereNotNull('notify_tables_json')
    .select('id', 'name', 'notify_admin_email');

  if (apps.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  for (const app of apps) {
    const items = await db('notification_queue')
      .where({ app_id: app.id })
      .orderBy('queued_at', 'asc')
      .select('table_label', 'record_id', 'submitted_by', 'queued_at');

    if (items.length === 0) continue;

    const rows = items.map((r: { table_label: string; record_id: string | null; submitted_by: string; queued_at: string }) =>
      `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${r.table_label ?? r.table_label}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${r.record_id ?? ''}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${r.submitted_by ?? ''}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${new Date(r.queued_at).toLocaleString()}</td>
      </tr>`
    ).join('');

    await transporter.sendMail({
      from:    `"${app.name}" <${cfg.from}>`,
      to:      app.notify_admin_email,
      subject: `Daily digest — ${items.length} new record${items.length !== 1 ? 's' : ''} in ${app.name}`,
      html: `
        <p><strong>${app.name}</strong> — daily new-record digest</p>
        <table style="border-collapse:collapse;font-size:0.9em">
          <thead><tr style="background:#f9fafb">
            <th style="padding:4px 8px;text-align:left">Table</th>
            <th style="padding:4px 8px;text-align:left">Record ID</th>
            <th style="padding:4px 8px;text-align:left">Submitted by</th>
            <th style="padding:4px 8px;text-align:left">Time</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:0.8em;color:#6b7280;margin-top:16px">
          Manage notification settings in the App Settings page.</p>
      `,
      text: items.map((r: { table_label: string; record_id: string | null; submitted_by: string; queued_at: string }) =>
        `${r.table_label} | ID: ${r.record_id ?? 'n/a'} | ${r.submitted_by ?? ''} | ${r.queued_at}`
      ).join('\n'),
    });

    // Clear sent items
    await db('notification_queue').where({ app_id: app.id }).delete();
  }
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string,
  appName: string,
): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) throw new Error('SMTP is not configured. Set smtp_host and smtp_user in Settings.');

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  await transporter.sendMail({
    from: `"${appName}" <${cfg.from}>`,
    to: toEmail,
    subject: `Reset your password — ${appName}`,
    text: `You requested a password reset.\n\nClick this link to reset your password (valid for 60 minutes):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>You requested a password reset for <strong>${appName}</strong>.</p>
      <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
      <p style="font-size:0.85em;color:#666">Link expires in 60 minutes. If you didn't request this, ignore this email.</p>
    `,
  });
}
