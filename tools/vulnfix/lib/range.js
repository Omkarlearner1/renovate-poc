'use strict';

const semver = require('./semver');

/**
 * Evaluate the range syntax npm audit emits:
 *   "<1.1.16"   ">=4.0.0 <5.0.12"   "<=7.5.20"
 *   "<=1.1.20 || 3.0.0 - 5.0.11"     "*"
 * Comparators separated by spaces must all hold; "||" branches are alternatives.
 * Prerelease tags are ignored on both sides.
 */
function comparatorHolds(v, comp) {
  const m = comp.match(/^(<=|>=|<|>|=)?\s*v?(\d+\.\d+\.\d+)/);
  if (!m) return null;
  const op = m[1] || '=';
  const c = semver.compare(v, semver.parse(m[2]));
  switch (op) {
    case '<':
      return c < 0;
    case '<=':
      return c <= 0;
    case '>':
      return c > 0;
    case '>=':
      return c >= 0;
    default:
      return c === 0;
  }
}

function branchHolds(v, branch) {
  const b = branch.trim();
  if (b === '' || b === '*') return true;
  const hyphen = b.match(/^v?(\d+\.\d+\.\d+)\S*\s+-\s+v?(\d+\.\d+\.\d+)\S*$/);
  if (hyphen) {
    return (
      semver.compare(v, semver.parse(hyphen[1])) >= 0 &&
      semver.compare(v, semver.parse(hyphen[2])) <= 0
    );
  }
  const comps = b.replace(/(<=|>=|<|>|=)\s+/g, '$1').split(/\s+/);
  for (const comp of comps) {
    const ok = comparatorHolds(v, comp);
    if (ok === null) return false;
    if (!ok) return false;
  }
  return true;
}

/** Does `version` fall inside `range`? */
function satisfies(version, range) {
  const v = semver.parse(version);
  if (!v || range === undefined || range === null) return false;
  return String(range)
    .split('||')
    .some((branch) => branchHolds(v, branch));
}

module.exports = { satisfies };
