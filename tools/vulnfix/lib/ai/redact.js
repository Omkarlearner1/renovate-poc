'use strict';

/**
 * The privacy boundary of this tool.
 *
 * Everything sent to a model is constructed HERE, field by field, from the
 * planner's own output — never from files, source, lockfiles or scan exports.
 * This is an allowlist by construction: a field that isn't named below cannot
 * reach a prompt, regardless of what any other code does.
 *
 * Package names, versions and public advisory IDs are all derivable from a
 * lockfile plus a public advisory database, so nothing here is a secret.
 */

const MAX_TITLE = 200;

function clip(s, n) {
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

function advisory(a) {
  return {
    id: clip(a.id, 64),
    title: clip(a.title, MAX_TITLE),
    severity: clip(a.severity, 16),
  };
}

function item(u) {
  return {
    package: clip(u.name, 128),
    severity: clip(u.severity, 16),
    current: clip(u.current, 64),
    blocked_reason: clip(u.reason, 300),
    advisories: (u.advisories || []).slice(0, 4).map(advisory),
  };
}

/** Reduce an unfixable list to the minimum a model needs to explain it. */
function unfixable(list) {
  return list.map(item);
}

module.exports = { unfixable, item, advisory };
