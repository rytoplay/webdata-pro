import { Router } from 'express';
import { requireApp } from '../../middleware/currentApp';
import * as aiService from '../../services/ai';
import { buildUserPrompt, BLUEPRINT_SYSTEM_PROMPT, type WizardAnswers } from '../../services/blueprintPrompt';
import { validateBlueprint, applyBlueprint, type Blueprint } from '../../services/blueprintImport';
import type { App } from '../../domain/types';

export const blueprintRouter = Router();

blueprintRouter.use(requireApp);

// ── GET /admin/blueprint — wizard form ────────────────────────────────────────

blueprintRouter.get('/', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;
    const aiSettings = await aiService.getAiSettings();
    res.render('admin/blueprint/wizard', {
      title:      'AI App Builder',
      app,
      aiSettings,
      flash:      null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/blueprint/generate — call AI, return JSON ─────────────────────

blueprintRouter.post('/generate', async (req, res, next) => {
  try {
    const answers: WizardAnswers = {
      description:    (req.body.description    ?? '').trim(),
      knownFields:    req.body.known_fields === 'yes',
      fieldList:      (req.body.field_list     ?? '').trim(),
      isPublic:       req.body.is_public === 'yes',
      layoutStyle:    (req.body.layout_style   ?? 'compact table').trim(),
      hasAdminGroup:  req.body.has_admin_group  === 'yes',
      hasMemberGroup: req.body.has_member_group === 'yes',
    };

    if (!answers.description) {
      return res.status(400).json({ error: 'Please describe your database.' });
    }

    const aiSettings = await aiService.getAiSettings();
    const userPrompt = buildUserPrompt(answers);

    let raw: string;
    try {
      raw = await aiService.callAi(aiSettings, BLUEPRINT_SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      return res.status(502).json({ error: `AI call failed: ${err instanceof Error ? err.message : String(err)}` });
    }

    const jsonStr = aiService.extractJson(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(422).json({ error: 'AI returned invalid JSON. Try again or adjust your description.', raw });
    }

    const errors = validateBlueprint(parsed);
    if (errors.length > 0) {
      return res.status(422).json({
        error: `Blueprint validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join('; ')}`,
        raw
      });
    }

    res.json({ blueprint: parsed, raw });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/blueprint/apply — create everything ───────────────────────────

blueprintRouter.post('/apply', async (req, res, next) => {
  try {
    const app = res.locals.currentApp as App;

    let blueprint: Blueprint;
    try {
      blueprint = JSON.parse(req.body.blueprint_json ?? '{}') as Blueprint;
    } catch {
      req.session.flash = { type: 'danger', message: 'Invalid blueprint JSON.' };
      return res.redirect('/admin/blueprint');
    }

    const errors = validateBlueprint(blueprint);
    if (errors.length > 0) {
      req.session.flash = { type: 'danger', message: `Invalid blueprint: ${errors[0].message}` };
      return res.redirect('/admin/blueprint');
    }

    const result = await applyBlueprint(app, blueprint);

    const parts: string[] = [];
    if (result.tablesCreated.length)  parts.push(`${result.tablesCreated.length} table(s)`);
    if (result.fieldsCreated)         parts.push(`${result.fieldsCreated} field(s)`);
    if (result.viewsCreated.length)   parts.push(`${result.viewsCreated.length} view(s)`);
    if (result.groupsCreated.length)  parts.push(`${result.groupsCreated.length} group(s)`);

    const summary = parts.length ? `Created: ${parts.join(', ')}.` : 'Nothing was created.';
    const errorNote = result.errors.length
      ? ` Warnings: ${result.errors.join('; ')}`
      : '';

    req.session.flash = {
      type:    result.errors.length ? 'warning' : 'success',
      message: summary + errorNote,
    };
    res.redirect('/admin/tables');
  } catch (err) {
    next(err);
  }
});
