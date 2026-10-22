'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { npm, audit, readManifest } = require('./scan');

const IS_WIN = process.platform === 'win32';

/**
 * Re-resolve the tree and confirm the fix actually took.
 *
 * A clean resolve requires deleting BOTH package-lock.json and node_modules:
 * otherwise npm reuses cached nested copies and newly added overrides show as
 * "invalid" in the tree without taking effect.
 */
function reinstall(
  cwd,
  { clean = true, lockfileOnly = false, ignoreScripts = false, log = () => {} } = {}
) {
  if (clean && !lockfileOnly) {
    for (const target of ['node_modules', 'package-lock.json']) {
      const p = path.join(cwd, target);
      if (fs.existsSync(p)) {
        log(`  removing ${target}`);
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  }
  const args = ['install', '--no-audit', '--no-fund'];
  if (lockfileOnly) args.push('--package-lock-only');
  if (ignoreScripts) args.push('--ignore-scripts');
  log(`  npm ${args.join(' ')}`);
  const res = npm(args, cwd);
  return {
    ok: res.status === 0,
    output: (res.stderr || '') + (res.stdout || ''),
  };
}

/** Re-run audit and report what is still fixable. */
function residuals(cwd) {
  const data = audit(cwd);
  const vulns = data.vulnerabilities || {};
  const remaining = Object.entries(vulns).map(([name, v]) => ({
    name,
    severity: v.severity,
    fixAvailable: v.fixAvailable,
  }));
  return {
    total: remaining.length,
    fixable: remaining.filter((r) => r.fixAvailable && r.fixAvailable !== false),
    all: remaining,
  };
}

/**
 * Run the project's build. This is the step that catches the failure mode no
 * audit can see: a version that satisfies the advisory but breaks the app.
 */
function build(cwd, { command = null, log = () => {} } = {}) {
  const manifest = readManifest(cwd);
  const scripts = manifest.scripts || {};
  if (!command && !scripts.build) {
    return { ok: true, skipped: true, reason: 'no build script defined' };
  }
  log(`  ${command || 'npm run build'}`);
  const res = command
    ? spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : npm(['run', 'build'], cwd);
  return {
    ok: res.status === 0,
    skipped: false,
    output: (res.stdout || '') + (res.stderr || ''),
  };
}

module.exports = { reinstall, residuals, build };
