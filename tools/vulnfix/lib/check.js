'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const semver = require('./semver');
const { frozenRule } = require('./policy');

function gitShow(cwd, ref, file) {
  const res = spawnSync('git', ['show', `${ref}:${file}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) return null;
  return res.stdout;
}

function topLevelVersions(lockText) {
  if (!lockText) return {};
  const lock = JSON.parse(lockText);
  const out = {};
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key.startsWith('node_modules/') || key.indexOf('node_modules/', 1) !== -1) continue;
    if (entry && entry.version) out[key.slice('node_modules/'.length)] = entry.version;
  }
  return out;
}

function declared(manifest) {
  return { ...(manifest.devDependencies || {}), ...(manifest.dependencies || {}) };
}

/**
 * Compare the current package.json / package-lock.json against a baseline and
 * report every frozen package whose major went up — in what's declared, or in
 * what the lockfile actually installs. This is the merge gate for fix PRs from
 * any engine (Dependabot, vulnfix, a human): policy enforced in CI rather than
 * trusted to the tool that proposed the change.
 *
 * base: { ref } to read the baseline from git, or { manifestFile, lockFile }.
 */
function frozenMajors(cwd, config, base) {
  let baseManifestText;
  let baseLockText = null;
  if (base.ref) {
    baseManifestText = gitShow(cwd, base.ref, 'package.json');
    if (baseManifestText === null) {
      throw new Error(`could not read package.json at ${base.ref} — is the ref fetched?`);
    }
    baseLockText = gitShow(cwd, base.ref, 'package-lock.json');
  } else {
    baseManifestText = fs.readFileSync(base.manifestFile, 'utf8');
    if (base.lockFile && fs.existsSync(base.lockFile)) {
      baseLockText = fs.readFileSync(base.lockFile, 'utf8');
    }
  }

  const before = declared(JSON.parse(baseManifestText));
  const after = declared(JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')));
  const lockPath = path.join(cwd, 'package-lock.json');
  const installedBefore = topLevelVersions(baseLockText);
  const installedAfter = topLevelVersions(
    fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null
  );

  const violations = [];
  const names = new Set([...Object.keys(after), ...Object.keys(installedAfter)]);
  for (const name of names) {
    const rule = frozenRule(config, name);
    if (!rule) continue;

    const dBefore = semver.major(before[name]);
    const dAfter = semver.major(after[name]);
    if (dBefore !== null && dAfter !== null && dAfter > dBefore) {
      violations.push({ name, where: 'package.json', from: before[name], to: after[name], reason: rule.reason });
      continue;
    }

    const iBefore = semver.major(installedBefore[name]);
    const iAfter = semver.major(installedAfter[name]);
    if (iBefore !== null && iAfter !== null && iAfter > iBefore) {
      violations.push({
        name,
        where: 'package-lock.json',
        from: installedBefore[name],
        to: installedAfter[name],
        reason: rule.reason,
      });
    }
  }
  return violations;
}

module.exports = { frozenMajors, topLevelVersions };
