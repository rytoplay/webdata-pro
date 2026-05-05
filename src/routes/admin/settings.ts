import { Router } from 'express';
import * as aiService from '../../services/ai';
import { db } from '../../db/knex';

export const settingsRouter = Router();

async function getCaptchaSettings() {
  const rows = await db('settings').whereIn('key', ['recaptcha_site_key', 'recaptcha_secret_key']);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value ?? '';
  return {
    siteKey:   map['recaptcha_site_key']   || '',
    secretKey: map['recaptcha_secret_key'] || '',
  };
}

async function getGeocodingSettings() {
  const row = await db('settings').where({ key: 'google_geocoding_api_key' }).first() as { value: string } | undefined;
  return { googleApiKey: row?.value || '' };
}

async function getSmtpSettings() {
  const rows = await db('settings').whereIn('key', [
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  ]);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value ?? '';
  return {
    host:   map['smtp_host']   || '',
    port:   map['smtp_port']   || '587',
    secure: map['smtp_secure'] === 'true',
    user:   map['smtp_user']   || '',
    pass:   map['smtp_pass']   || '',
    from:   map['smtp_from']   || '',
  };
}

// ── GET /admin/settings ───────────────────────────────────────────────────────

settingsRouter.get('/', async (req, res, next) => {
  try {
    const settings     = await aiService.getAiSettings();
    const ollamaModels = settings.provider === 'ollama'
      ? await aiService.listOllamaModels(settings.baseUrl).catch(() => [])
      : [];
    const smtpSettings       = await getSmtpSettings();
    const captchaSettings    = await getCaptchaSettings();
    const geocodingSettings  = await getGeocodingSettings();
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/settings', { title: 'Settings', settings, ollamaModels, smtpSettings, captchaSettings, geocodingSettings, flash });
  } catch (err) { next(err); }
});

// ── POST /admin/settings ──────────────────────────────────────────────────────

settingsRouter.post('/', async (req, res, next) => {
  try {
    const body       = req.body as Record<string, string>;
    const provider   = body.ai_provider as aiService.AiSettings['provider'];
    // Two separate inputs avoid duplicate-name arrays — pick the right one by provider
    const model      = provider === 'ollama' ? body.ai_model : body.ai_model_cloud;
    await aiService.saveAiSettings({
      provider,
      model:   model ?? '',
      baseUrl: body.ai_base_url ?? '',
      apiKey:  body.ai_api_key  ?? '',
    });
    req.session.flash = { type: 'success', message: 'Settings saved.' };
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

// ── POST /admin/settings/smtp ─────────────────────────────────────────────────

settingsRouter.post('/smtp', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string>;
    const pairs: Record<string, string> = {
      smtp_host:   body.smtp_host   || '',
      smtp_port:   body.smtp_port   || '587',
      smtp_secure: body.smtp_secure === '1' ? 'true' : 'false',
      smtp_user:   body.smtp_user   || '',
      smtp_from:   body.smtp_from   || '',
    };
    // Only overwrite password if a new one was entered
    if (body.smtp_pass) pairs['smtp_pass'] = body.smtp_pass;

    for (const [key, value] of Object.entries(pairs)) {
      await db('settings').insert({ key, value }).onConflict('key').merge();
    }
    req.session.flash = { type: 'success', message: 'Email settings saved.' };
    res.redirect('/admin/settings#email');
  } catch (err) { next(err); }
});

// ── POST /admin/settings/test-smtp — send a test email ───────────────────────

settingsRouter.post('/test-smtp', async (req, res) => {
  try {
    const { to } = req.body as { to: string };
    if (!to) return res.json({ ok: false, error: 'Enter a recipient email address.' });
    const emailService = await import('../../services/email');
    const configured = await emailService.isEmailConfigured();
    if (!configured) return res.json({ ok: false, error: 'SMTP is not configured yet.' });
    await emailService.sendPasswordResetEmail(to, 'https://example.com/test', 'Webdata Pro (test)');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /admin/settings/test-ai — quick connectivity check ──────────────────

settingsRouter.post('/test-ai', async (req, res) => {
  try {
    const settings = await aiService.getAiSettings();
    const reply    = await aiService.callAi(settings, 'You are a helpful assistant.', 'Reply with only the word PONG.');
    res.json({ ok: true, reply: reply.trim() });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /admin/settings/captcha — save reCAPTCHA keys ───────────────────────

settingsRouter.post('/captcha', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string>;
    const pairs: Record<string, string> = {
      recaptcha_site_key: body.recaptcha_site_key || '',
    };
    // Only overwrite secret key if a new one was entered
    if (body.recaptcha_secret_key) pairs['recaptcha_secret_key'] = body.recaptcha_secret_key;
    for (const [key, value] of Object.entries(pairs)) {
      await db('settings').insert({ key, value }).onConflict('key').merge();
    }
    req.session.flash = { type: 'success', message: 'CAPTCHA settings saved.' };
    res.redirect('/admin/settings#captcha');
  } catch (err) { next(err); }
});

// ── POST /admin/settings/geocoding — save Google Geocoding API key ────────────

settingsRouter.post('/geocoding', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string>;
    if (body.google_geocoding_api_key !== undefined) {
      await db('settings')
        .insert({ key: 'google_geocoding_api_key', value: body.google_geocoding_api_key || '' })
        .onConflict('key').merge();
    }
    req.session.flash = { type: 'success', message: 'Geocoding settings saved.' };
    res.redirect('/admin/settings#geocoding');
  } catch (err) { next(err); }
});

// ── GET /admin/settings/ollama-models — live model list ──────────────────────

settingsRouter.get('/ollama-models', async (req, res) => {
  try {
    const settings = await aiService.getAiSettings();
    const models   = await aiService.listOllamaModels(settings.baseUrl);
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
});
