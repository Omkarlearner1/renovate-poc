'use strict';

/**
 * Thin provider adapters. No SDKs — Node 18+ ships global fetch, and a
 * security tool should not add a dependency tree to send one HTTP request.
 *
 * Selected with VULNFIX_AI; "off" (the default) means this file is never
 * reached and the tool runs fully offline.
 */

const DEFAULTS = {
  anthropic: 'claude-opus-4-8',
  azure: null, // deployment name is supplied by the user
  ollama: 'llama3.1',
};

function config() {
  const provider = (process.env.VULNFIX_AI || 'off').toLowerCase();
  return {
    provider,
    model: process.env.VULNFIX_AI_MODEL || DEFAULTS[provider] || null,
    timeoutMs: Number(process.env.VULNFIX_AI_TIMEOUT_MS || 60000),
  };
}

async function post(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function anthropic({ system, user }, cfg) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const data = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model: cfg.model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    },
    cfg.timeoutMs
  );
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function azure({ system, user }, cfg) {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const key = process.env.AZURE_OPENAI_API_KEY;
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is not set');
  if (!key) throw new Error('AZURE_OPENAI_API_KEY is not set');
  if (!cfg.model) throw new Error('VULNFIX_AI_MODEL must name your Azure deployment');
  const data = await post(
    `${endpoint}/openai/deployments/${cfg.model}/chat/completions?api-version=${version}`,
    { 'api-key': key },
    {
      max_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    cfg.timeoutMs
  );
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function ollama({ system, user }, cfg) {
  const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const data = await post(
    `${host}/api/chat`,
    {},
    {
      model: cfg.model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    cfg.timeoutMs
  );
  return (data.message?.content || '').trim();
}

const ADAPTERS = { anthropic, azure, ollama };

function isEnabled() {
  return config().provider !== 'off';
}

async function complete(prompt) {
  const cfg = config();
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) {
    throw new Error(
      `Unknown VULNFIX_AI="${cfg.provider}". Use: off | anthropic | azure | ollama`
    );
  }
  return adapter(prompt, cfg);
}

module.exports = { complete, isEnabled, config };
