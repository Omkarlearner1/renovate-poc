'use strict';

const redact = require('./redact');
const prompt = require('./prompt');
const provider = require('./provider');

/**
 * Deterministic fallback used whenever AI is off or unreachable.
 *
 * The tool has to stay fully useful with no model: if turning AI off broke
 * something important, the AI would have crept into a job it shouldn't hold.
 */
function template(list) {
  return list
    .map((u) => {
      const titles = (u.advisories || []).map((a) => a.title).filter(Boolean);
      const what = titles.length ? titles[0] : 'a published security advisory';
      return [
        `### ${u.name}`,
        `${u.severity.toUpperCase()} — ${what}.`,
        `Not fixed automatically: ${u.reason}.`,
        `Options: accept the risk with a review date, replace the library, or schedule a coordinated upgrade.`,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Turn the unfixable list into prose for a human. Returns the text plus how it
 * was produced, so the report can say so honestly.
 */
async function unfixable(list) {
  if (list.length === 0) return { text: '', source: 'none' };
  if (!provider.isEnabled()) {
    return { text: template(list), source: 'template' };
  }
  try {
    const safe = redact.unfixable(list);
    const text = await provider.complete(prompt.build(safe));
    if (!text) throw new Error('empty response');
    return { text, source: provider.config().provider };
  } catch (err) {
    return {
      text: template(list),
      source: 'template',
      warning: `AI explanation failed (${err.message}); used the built-in template instead.`,
    };
  }
}

module.exports = { unfixable, template };
