import { db } from '../db/knex';

// ── Settings ────────────────────────────────────────────────────────────────

export interface AiSettings {
  provider: 'ollama' | 'anthropic' | 'openai';
  model:    string;
  baseUrl:  string;   // Ollama only
  apiKey:   string;   // Anthropic / OpenAI
}

const DEFAULTS: AiSettings = {
  provider: 'ollama',
  model:    'llama3.2',
  baseUrl:  'http://localhost:11434',
  apiKey:   '',
};

export async function getAiSettings(): Promise<AiSettings> {
  const rows = await db('settings')
    .whereIn('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);
  const m = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
  return {
    provider: (m.get('ai_provider') ?? DEFAULTS.provider) as AiSettings['provider'],
    model:    m.get('ai_model')    ?? DEFAULTS.model,
    baseUrl:  m.get('ai_base_url') ?? DEFAULTS.baseUrl,
    apiKey:   m.get('ai_api_key')  ?? DEFAULTS.apiKey,
  };
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<void> {
  const map: Record<string, string> = {
    ...(patch.provider !== undefined && { ai_provider: patch.provider }),
    ...(patch.model    !== undefined && { ai_model:    patch.model    }),
    ...(patch.baseUrl  !== undefined && { ai_base_url: patch.baseUrl  }),
    ...(patch.apiKey   !== undefined && { ai_api_key:  patch.apiKey   }),
  };
  for (const [key, value] of Object.entries(map)) {
    const exists = await db('settings').where({ key }).first();
    if (exists) await db('settings').where({ key }).update({ value });
    else        await db('settings').insert({ key, value });
  }
}

// ── Ollama model list ────────────────────────────────────────────────────────

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = await res.json() as { models?: { name: string }[] };
  return (data.models ?? []).map(m => m.name);
}

// ── Main call ────────────────────────────────────────────────────────────────

export async function callAi(
  settings: AiSettings,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  switch (settings.provider) {
    case 'ollama':     return callOllama(settings, systemPrompt, userPrompt);
    case 'anthropic':  return callAnthropic(settings, systemPrompt, userPrompt);
    case 'openai':     return callOpenAI(settings, systemPrompt, userPrompt);
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

async function callOllama(s: AiSettings, system: string, user: string): Promise<string> {
  // Some Qwen3 models support /no_think to skip the reasoning step — faster output.
  const userMsg = s.model.toLowerCase().startsWith('qwen') ? `/no_think\n\n${user}` : user;

  const res = await fetch(`${s.baseUrl}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    s.model,
      stream:   false,
      messages: [
        { role: 'system',  content: system },
        { role: 'user',    content: userMsg },
      ],
      options: { temperature: 0.7, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(600_000),   // 10 min — large local models are slow without a GPU
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { message?: { content: string } };
  return stripThink(data.message?.content ?? '');
}

async function callAnthropic(s: AiSettings, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       s.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      s.model || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content?: { text: string }[] };
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(s: AiSettings, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${s.apiKey}`,
    },
    body: JSON.stringify({
      model:    s.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices?: { message: { content: string } }[] };
  return data.choices?.[0]?.message.content ?? '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip <think>...</think> blocks emitted by reasoning models (Qwen3, DeepSeek-R1, etc.) */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Extract the first JSON object from a response that may have surrounding prose */
export function extractJson(text: string): string {
  // Try to find a ```json ... ``` block first
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Otherwise find first { … } block
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

/**
 * Extract named template blocks from a delimiter-formatted response.
 * Format: ===TEMPLATE_TYPE===\n<content>\n===NEXT_TYPE=== (or end of string)
 * The END marker is optional — content runs until the next marker or EOF.
 */
export function extractTemplateBlocks(text: string, types: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};

  // Build regex that matches ANY known marker (plus optional END)
  const allMarkers = [...types.map(t => t.toUpperCase()), 'END'].join('|');
  const splitRe    = new RegExp(`===\\s*(${allMarkers})\\s*===`, 'gi');

  // Walk through every marker occurrence, capturing the text between them
  let lastMarker  = '';
  let lastEnd     = 0;

  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(text)) !== null) {
    if (lastMarker && lastMarker !== 'END') {
      const key = lastMarker.toLowerCase();
      if (types.includes(key as never)) {
        result[key] = text.slice(lastEnd, m.index).trim();
      }
    }
    lastMarker = m[1].toUpperCase();
    lastEnd    = m.index + m[0].length;
  }

  // Capture content after the final marker (if not END)
  if (lastMarker && lastMarker !== 'END') {
    const key = lastMarker.toLowerCase();
    if (types.includes(key as never)) {
      result[key] = text.slice(lastEnd).trim();
    }
  }

  return result;
}
