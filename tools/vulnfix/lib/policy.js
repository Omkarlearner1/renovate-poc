'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_NAMES = ['vulnfix.config.json', '.vulnfixrc.json'];

const DEFAULT_CONFIG = {
  frozen: [],
  allowDevMajor: true,
  buildCommand: null,
};

/**
 * Glob match supporting a single trailing "*" within the last path segment,
 * e.g. "@angular/*" matches "@angular/core"; "@progress/kendo-angular-*"
 * matches "@progress/kendo-angular-grid". No "*" means exact match.
 */
function matches(pattern, name) {
  if (!pattern.includes('*')) return pattern === name;
  const idx = pattern.indexOf('*');
  const head = pattern.slice(0, idx);
  const tail = pattern.slice(idx + 1);
  if (!name.startsWith(head) || !name.endsWith(tail)) return false;
  const middle = name.slice(head.length, name.length - tail.length);
  return !middle.includes('/');
}

function load(cwd) {
  for (const name of CONFIG_NAMES) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...raw, _source: name };
    } catch (err) {
      throw new Error(`Could not parse ${name}: ${err.message}`);
    }
  }
  return { ...DEFAULT_CONFIG, _source: null };
}

/**
 * Is this package pinned to its current major? Returns the matching rule
 * (with its human-readable reason) or null.
 */
function frozenRule(config, name) {
  for (const rule of config.frozen || []) {
    const pattern = typeof rule === 'string' ? rule : rule.pattern;
    if (pattern && matches(pattern, name)) {
      return {
        pattern,
        reason:
          (typeof rule === 'object' && rule.reason) ||
          'pinned to its current major by policy',
      };
    }
  }
  return null;
}

module.exports = { load, frozenRule, matches, DEFAULT_CONFIG };
