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
