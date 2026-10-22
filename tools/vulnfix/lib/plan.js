'use strict';

const semver = require('./semver');
const range = require('./range');
const registry = require('./registry');
const { frozenRule } = require('./policy');

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function isVulnerable(version, advisories) {
  return advisories.some((a) => a.range && range.satisfies(version, a.range));
}

/** Published versions of a package that no known advisory covers, ascending. */
function cleanVersions(name, advisories, resolveVersions) {
  return resolveVersions(name).filter((v) => !isVulnerable(v, advisories));
}

/** Lowest clean version in `major`, no older than `from`. */
function lowestInMajor(clean, major, from) {
  const floor = semver.parse(from);
  return (
    clean.find(
      (v) =>
        semver.major(v) === major &&
        (!floor || semver.compare(semver.parse(v), floor) >= 0)
    ) || null
  );
}

/** Lowest clean version in any major above that of `from`. */
function lowestAboveMajor(clean, from) {
  const m = semver.major(from);
  return clean.find((v) => semver.major(v) > m) || null;
}

/**
 * Classify every finding into exactly one action.
 *
 *   upgrade   - a direct dependency moves to the lowest clean published version
 *   override  - a transitive dependency is pinned via npm "overrides", one entry
 *               per installed major line (scoped as "name@major" when the
 *               package is installed at more than one major)
 *   unfixable - no automated fix is permitted or possible; a human decides
 *   carrier   - no advisory of its own; clears once its transitives are fixed
 *
 * The rule for every target: the lowest version that is actually published,
 * in the same major as what's installed, newer than what's installed, and not
 * covered by any known advisory for that package. Nothing is guessed.
 *
 * opts.resolveVersions(name) -> ascending stable versions (default: registry)
 * opts.preferParentUpgrade   -> fix a transitive by bumping its direct parent
 *                               when npm says that works (default true)
 */
function build(findings, manifest, config, opts = {}) {
  const resolveVersions = opts.resolveVersions || registry.versions;
  const preferParentUpgrade = opts.preferParentUpgrade !== false;
  const deps = manifest.dependencies || {};
  const devDeps = manifest.devDependencies || {};
  const isDirect = (n) => has(deps, n) || has(devDeps, n);

  const upgrades = [];
  const overrides = [];
  const unfixable = [];
  const carriers = [];

  for (const f of findings) {
    if (f.advisories.length === 0) {
      carriers.push({
        name: f.name,
        severity: f.severity,
        note: 'no advisory of its own — clears once its transitives are fixed',
      });
      continue;
    }

    let clean;
    try {
      clean = cleanVersions(f.name, f.advisories, resolveVersions);
    } catch (err) {
      unfixable.push({
        name: f.name,
        severity: f.severity,
        current: f.declared || f.vulnerableRange,
        reason: err.message,
        advisories: f.advisories,
      });
      continue;
    }

    if (f.isDirect) {
      planDirect(f, clean, config, { upgrades, overrides, unfixable, carriers });
    } else {
      planTransitive(f, clean, config, manifest, {
        isDirect,
        preferParentUpgrade,
        upgrades,
        overrides,
        unfixable,
      });
    }
  }

  return { upgrades, overrides, unfixable, carriers };
}

function planDirect(f, clean, config, out) {
  const topPath = `node_modules/${f.name}`;
  const top = f.topLevel ? f.topLevel.version : semver.parse(f.declared) ? f.declared.replace(/^[\^~>=< ]+/, '') : null;

  if (!top) {
    out.unfixable.push({
      name: f.name,
      severity: f.severity,
      current: f.declared,
      reason: 'installed version unknown — run npm install so package-lock.json exists',
      advisories: f.advisories,
    });
    return;
  }

  if (!isVulnerable(top, f.advisories)) {
    // The direct copy is clean; only copies nested under other packages are not.
    const nested = f.installed.filter(
      (c) => c.path !== topPath && isVulnerable(c.version, f.advisories)
    );
    if (nested.length === 0) {
      out.carriers.push({
        name: f.name,
        severity: f.severity,
        note: 'installed version is not covered by the advisories',
      });
      return;
    }
    const sameMajor = nested.every((c) => semver.major(c.version) === semver.major(top));
    if (sameMajor) {
      // A direct dependency can't take a normal override (EOVERRIDE), but "$name"
      // pins every nested copy to the version the project itself declares.
      out.overrides.push({
        name: f.name,
        key: f.name,
        to: `$${f.name}`,
        severity: f.severity,
        reason: `${nested.length} nested cop${nested.length === 1 ? 'y' : 'ies'} pinned to the direct dependency's version`,
        advisories: f.advisories,
      });
    } else {
      out.unfixable.push({
        name: f.name,
        severity: f.severity,
        current: nested.map((c) => c.version).join(', '),
        reason: `nested copies are on a different major than the direct dependency (${top}) and can't be pinned to it`,
        advisories: f.advisories,
      });
    }
    return;
  }

  const prefix = semver.rangePrefix(f.declared);
  const currentMajor = semver.major(top);
  const inMajor = lowestInMajor(clean, currentMajor, top);
  if (inMajor) {
    out.upgrades.push({
      name: f.name,
      section: f.section,
      severity: f.severity,
      from: f.declared,
      to: `${prefix}${inMajor}`,
      crossesMajor: false,
      advisories: f.advisories,
    });
    return;
  }

  const next = lowestAboveMajor(clean, top);
  if (!next) {
    out.unfixable.push({
      name: f.name,
      severity: f.severity,
      current: f.declared,
      reason: 'no published version is free of the advisories yet',
      advisories: f.advisories,
    });
    return;
  }

  const targetMajor = semver.major(next);
  const frozen = frozenRule(config, f.name);
  let blocked = null;
  if (frozen) {
    blocked = `fix requires major ${targetMajor}, but this package is held at major ${currentMajor}: ${frozen.reason}`;
  } else if (f.section === 'dependencies') {
    blocked = `fix requires a major bump (${currentMajor} -> ${targetMajor}) of a production dependency`;
  } else if (!config.allowDevMajor) {
    blocked = 'fix requires a major bump and allowDevMajor is disabled';
  }

  if (blocked) {
    out.unfixable.push({
      name: f.name,
      severity: f.severity,
      current: f.declared,
      target: next,
      reason: blocked,
      advisories: f.advisories,
    });
    return;
  }

  out.upgrades.push({
    name: f.name,
    section: f.section,
    severity: f.severity,
    from: f.declared,
    to: `${prefix}${next}`,
    crossesMajor: true,
    advisories: f.advisories,
  });
}

function planTransitive(f, clean, config, manifest, ctx) {
  const fix = f.fixAvailable;
  const root = fix && typeof fix === 'object' ? fix.name : null;
  const rootSection = !root
    ? null
    : has(manifest.dependencies, root)
      ? 'dependencies'
      : has(manifest.devDependencies, root)
        ? 'devDependencies'
        : null;
  // Per policy: a non-frozen parent may be bumped within its major; a
  // devDependency parent may also cross a major (nothing it ships reaches users).
  const parentIsMajor = !!(fix && typeof fix === 'object' && fix.isSemVerMajor);
  const parentMajorOk =
    !parentIsMajor || (rootSection === 'devDependencies' && config.allowDevMajor);
  // npm's audit-fix suggestion is sometimes a DOWNGRADE (an old parent major that
  // predates the vulnerable dependency). Never take one.
  const currentParent = rootSection ? semver.parse(manifest[rootSection][root]) : null;
  const suggested = fix && typeof fix === 'object' ? semver.parse(fix.version) : null;
  const isForward =
    !!currentParent && !!suggested && semver.compare(suggested, currentParent) > 0;

  if (
    ctx.preferParentUpgrade &&
    root &&
    root !== f.name &&
    rootSection &&
    !frozenRule(config, root) &&
    parentMajorOk &&
    isForward
  ) {
    const declared = manifest[rootSection][root];
    const existing = ctx.upgrades.find((u) => u.name === root);
    if (existing) {
      existing.fixes = [...(existing.fixes || []), f.name];
    } else {
      ctx.upgrades.push({
        name: root,
        section: rootSection,
        severity: f.severity,
        from: declared,
        to: `${semver.rangePrefix(declared)}${fix.version}`,
        crossesMajor: parentIsMajor,
        fixes: [f.name],
        advisories: f.advisories,
      });
    }
    return;
  }

  const vulnerable = f.installed.filter((c) => isVulnerable(c.version, f.advisories));
  if (vulnerable.length === 0) {
    ctx.unfixable.push({
      name: f.name,
      severity: f.severity,
      current: f.vulnerableRange,
      reason: 'no installed copy found in package-lock.json — run npm install first',
      advisories: f.advisories,
    });
    return;
  }

  const allMajors = new Set(f.installed.map((c) => semver.major(c.version)));
  const lines = new Map();
  for (const c of vulnerable) {
    const m = semver.major(c.version);
    if (!lines.has(m)) lines.set(m, []);
    lines.get(m).push(c);
  }

  for (const [m, copies] of lines) {
    const highest = semver.max(copies.map((c) => c.version));
    const target = lowestInMajor(clean, m, highest);
    const key = allMajors.size > 1 ? `${f.name}@${m}` : f.name;
    if (target) {
      ctx.overrides.push({
        name: f.name,
        key,
        to: `~${target}`,
        severity: f.severity,
        reason: root && root !== f.name ? `transitive (via ${root})` : 'transitive dependency',
        copies: copies.length,
        advisories: f.advisories,
      });
    } else {
      ctx.unfixable.push({
        name: f.name,
        severity: f.severity,
        current: [...new Set(copies.map((c) => c.version))].join(', '),
        reason: `no published ${f.name} ${m}.x is free of the advisories, and the packages that use it require major ${m}`,
        advisories: f.advisories,
      });
    }
  }
}

module.exports = { build, isVulnerable, lowestInMajor };
