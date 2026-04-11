import { Router } from 'express';
import * as aiService from '../../services/ai';

export const settingsRouter = Router();

// ── GET /admin/settings ───────────────────────────────────────────────────────

settingsRouter.get('/', async (req, res, next) => {
  try {
    const settings     = await aiService.getAiSettings();
    const ollamaModels = settings.provider === 'ollama'
      ? await aiService.listOllamaModels(settings.baseUrl).catch(() => [])
      : [];
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('admin/settings', { title: 'Settings', settings, ollamaModels, flash });
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
