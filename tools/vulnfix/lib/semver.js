'use strict';

/**
 * Minimal semver helpers. Deliberately dependency-free — a security tool that
 * drags in a large transitive tree is auditing itself.
 */

/** "^1.2.3" | ">=1.2.3" | "1.2.3-rc.1" -> [1,2,3]; null if unparseable. */
function parse(str) {
  if (!str || typeof str !== 'string') return null;
  const clean = str.replace(/^[\^~>=< ]+/, '').split(/[\s-+]/)[0];
  const parts = clean.split('.').map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return parts;
}

/** -1 if a < b, 0 equal, 1 if a > b. */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** Highest of a list of version strings, or null. */
function max(versions) {
  const parsed = versions.filter((v) => parse(v));
  if (parsed.length === 0) return null;
  return parsed.sort((a, b) => compare(parse(a), parse(b))).pop();
}

/** Major number of a version or range, or null. */
function major(str) {
  const p = parse(str);
  return p ? p[0] : null;
}

/** Leading range operator of a declared dependency ("^", "~", or "" for exact). */
function rangePrefix(declared) {
  const m = String(declared || '').match(/^[\^~]/);
  return m ? m[0] : '';
}

/**
 * First safe version implied by an advisory's vulnerable range.
 *   "<3.0.5"          -> "3.0.5"
 *   ">=6.0.0 <8.0.3"  -> "8.0.3"
 *   "<=3.1.2"         -> "3.1.3"   (next patch above the last vulnerable one)
 */
function firstSafeVersion(range) {
  if (!range) return null;
  const lt = [...String(range).matchAll(/<(\d+\.\d+\.\d+)/g)];
  if (lt.length > 0) return lt[lt.length - 1][1];
  const lte = String(range).match(/<=(\d+)\.(\d+)\.(\d+)/);
  if (lte) return `${lte[1]}.${lte[2]}.${Number(lte[3]) + 1}`;
  return null;
}

module.exports = { parse, compare, max, major, rangePrefix, firstSafeVersion };
