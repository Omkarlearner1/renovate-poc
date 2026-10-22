'use strict';

const scan = require('./scan');
const planner = require('./plan');
const apply = require('./apply');
const verify = require('./verify');

/** Narrow a plan to what this run is allowed to touch. */
function restrict(plan, { overridesOnly = false, only = null } = {}) {
  const keep = only ? new Set(only) : null;
  const allowed = (n) => !keep || keep.has(n);
  return {
    ...plan,
    upgrades: overridesOnly ? [] : plan.upgrades.filter((u) => allowed(u.name)),
    overrides: plan.overrides.filter((o) => allowed(o.name)),
  };
}

function makePlan(cwd, config, opts, preferParentUpgrade) {
  const manifest = scan.readManifest(cwd);
  const findings = scan.findings(cwd);
  const plan = planner.build(findings, manifest, config, {
    resolveVersions: opts.resolveVersions,
    preferParentUpgrade,
  });
  return restrict(plan, opts);
}

/**
 * Apply fixes in passes until nothing more changes.
 *
 * npm's own "fixAvailable" is optimistic — "upgrade mocha to fix diff" can be
 * wrong when the newer parent still ships a vulnerable nested copy. So the first
 * pass may bump parents, and every later pass re-audits the resolved tree and
 * pins whatever is still vulnerable with an override. It stops when a pass
 * changes nothing or after maxPasses.
 */
function remediate(cwd, config, opts = {}) {
  const {
    overridesOnly = false,
    lockfileOnly = false,
    ignoreScripts = false,
    clean = true,
    maxPasses = 3,
    log = () => {},
  } = opts;

  const passes = [];
  for (let i = 1; i <= maxPasses; i++) {
    const plan = makePlan(cwd, config, opts, i === 1 && !overridesOnly);
    const { changes, refused } = apply.toManifest(cwd, plan);
    passes.push({ plan, changes, refused });
    if (changes.length === 0) break;

    log(`pass ${i}: ${changes.length} change(s)`);
    for (const c of changes) log(`  ${c}`);
    for (const r of refused) log(`  refused: ${r}`);

    const install = verify.reinstall(cwd, { clean, lockfileOnly, ignoreScripts, log });
    if (!install.ok) {
      return { passes, installFailed: true, installOutput: install.output };
    }
  }

  const remaining = makePlan(cwd, config, opts, false);
  const fixableLeft = remaining.upgrades.length + remaining.overrides.length;
  return { passes, installFailed: false, remaining, fixableLeft };
}

module.exports = { remediate, restrict, makePlan };
