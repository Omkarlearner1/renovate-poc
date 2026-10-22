'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write a plan into package.json. Purely mechanical: the planner already
 * decided what changes; this only decides where they go.
 *
 * Invariants enforced here (not left to the planner):
 *   - an upgrade only ever edits the section the dependency already lives in
 *   - an override is refused for anything that is a direct dependency
 */
function toManifest(cwd, plan, { selected = null } = {}) {
  const file = path.join(cwd, 'package.json');
  const raw = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  const indent = raw.match(/\n(\s+)"/) ? raw.match(/\n(\s+)"/)[1].length : 2;

  const want = (name) => selected === null || selected.has(name);
  const changes = [];
  const refused = [];

  for (const up of plan.upgrades) {
    if (!want(up.name)) continue;
    const section = up.section;
    if (!pkg[section] || !Object.prototype.hasOwnProperty.call(pkg[section], up.name)) {
      refused.push(`${up.name}: not present in ${section}`);
      continue;
    }
    if (pkg[section][up.name] === up.to) continue;
    changes.push(`${section}/${up.name}: ${pkg[section][up.name]} -> ${up.to}`);
    pkg[section][up.name] = up.to;
  }

  for (const ov of plan.overrides) {
    if (!want(ov.name)) continue;
    const key = ov.key || ov.name;
    const isDirect =
      (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, ov.name)) ||
      (pkg.devDependencies &&
        Object.prototype.hasOwnProperty.call(pkg.devDependencies, ov.name));
    // "$name" (pin nested copies to the project's own declared version) is the
    // only override npm accepts for a direct dependency.
    if (isDirect && ov.to !== `$${ov.name}`) {
      refused.push(`${ov.name}: direct dependency — override would cause EOVERRIDE`);
      continue;
    }
    pkg.overrides = pkg.overrides || {};
    if (pkg.overrides[key] === ov.to) continue;
    const before = pkg.overrides[key];
    changes.push(`overrides/${key}: ${before ? `${before} -> ` : '(new) '}${ov.to}`);
    pkg.overrides[key] = ov.to;
  }

  if (changes.length > 0) {
    fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + '\n');
  }
  return { changes, refused };
}

module.exports = { toManifest };
