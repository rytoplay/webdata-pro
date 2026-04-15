import { db } from '../db/knex';

// ── Settings ────────────────────────────────────────────────────────────────

export interface AiSettings {
  provider: 'ollama' | 'anthropic' | 'openai' | 'gemini';
  model:    string;
  baseUrl:  string;   // Ollama only
  apiKey:   string;   // Anthropic / OpenAI / Gemini
}

const DEFAULTS: AiSettings = {
  provider: 'ollama',
  model:    'qwen2.5:7b',
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
  userPrompt: string,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  switch (settings.provider) {
    case 'ollama':     return callOllama(settings, systemPrompt, userPrompt, maxTokens, temperature);
    case 'anthropic':  return callAnthropic(settings, systemPrompt, userPrompt, maxTokens);
    case 'openai':     return callOpenAI(settings, systemPrompt, userPrompt, maxTokens);
    case 'gemini':     return callGemini(settings, systemPrompt, userPrompt, maxTokens);
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

async function callOllama(s: AiSettings, system: string, user: string, maxTokens?: number, temperature?: number): Promise<string> {
  const userMsg = user;

  const res = await fetch(`${s.baseUrl}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    s.model,
      stream:   true,
      messages: [
        { role: 'system',  content: system },
        { role: 'user',    content: userMsg },
      ],
      options: {
        temperature: temperature ?? 0.7,
        num_predict: Math.min(maxTokens ?? 4096, 6000),
        num_ctx:     8192,
      },
      think: s.model.toLowerCase().startsWith('qwen') ? false : undefined,
    }),
    signal: AbortSignal.timeout(600_000),   // 10 min — large local models are slow without a GPU
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);

  // Collect streamed chunks — keeps the TCP connection alive during long generations
  const chunks: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line) as { message?: { content: string }; done?: boolean };
        if (chunk.message?.content) chunks.push(chunk.message.content);
      } catch { /* ignore partial lines */ }
    }
  }
  return stripThink(chunks.join(''));
}

async function callAnthropic(s: AiSettings, system: string, user: string, maxTokens?: number): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       s.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      s.model || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens ?? 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content?: { text: string }[] };
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(s: AiSettings, system: string, user: string, maxTokens?: number): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${s.apiKey}`,
    },
    body: JSON.stringify({
      model:      s.model || 'gpt-4o-mini',
      max_tokens: maxTokens,
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

async function callGemini(s: AiSettings, system: string, user: string, maxTokens?: number): Promise<string> {
  const model = s.model || 'gemini-2.0-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens ?? 4096,
        temperature:     0.7,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { candidates?: { content: { parts: { text: string }[] } }[] };
  return data.candidates?.[0]?.content.parts.map(p => p.text).join('') ?? '';
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
  const raw = fence ? fence[1].trim() : (() => {
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    return (start !== -1 && end > start) ? text.slice(start, end + 1) : text;
  })();
  return sanitizeJson(raw);
}

/**
 * Fix common model mistakes that produce invalid JSON:
 * - Backtick template literals → double-quoted strings
 * - Invalid escape sequences like \$ \# \! → unescaped character
 */
export function sanitizeJson(text: string): string {
  // 1. Replace backtick strings (possibly multiline) with double-quoted JSON strings.
  let result = text.replace(/`([\s\S]*?)`/g, (_match, content: string) => {
    const escaped = content
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r\n/g, '\\n')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\n')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });

  // 2. Remove invalid JSON escape sequences inside double-quoted strings.
  // Valid JSON escapes: \" \\ \/ \b \f \n \r \t \uXXXX
  // Everything else (e.g. \$ \# \!) is invalid — strip the backslash.
  result = result.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) => {
    const fixed = inner.replace(/\\([^"\\\/bfnrtu])/g, '$1');
    return `"${fixed}"`;
  });

  return result;
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
