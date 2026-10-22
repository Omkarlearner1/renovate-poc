'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

/** Run an npm subcommand in `cwd`, returning { status, stdout, stderr }. */
function npm(args, cwd, { capture = true } = {}) {
  return spawnSync('npm', args, {
    cwd,
    shell: IS_WIN,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readManifest(cwd) {
  const file = path.join(cwd, 'package.json');
  if (!fs.existsSync(file)) {
    throw new Error(`No package.json found in ${cwd}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Run `npm audit --json` and normalize it.
 *
 * npm audit exits non-zero whenever vulnerabilities exist, so a non-zero status
 * is expected and not an error — we only fail if stdout isn't parseable JSON.
 */
function audit(cwd) {
  const res = npm(['audit', '--json'], cwd);
  const raw = res.stdout || '';
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const hint = (res.stderr || raw || '').trim().split('\n').slice(0, 3).join('\n');
    throw new Error(
      `npm audit did not return JSON. Is this an installed npm project?\n${hint}`
    );
  }
  if (data.error) {
    throw new Error(`npm audit failed: ${data.error.summary || data.error.code}`);
  }
  return data;
}

/**
 * Every installed copy of every package, from package-lock.json:
 *   { name -> [{ path, version }] }
 * A package can be installed several times at different majors under
 * different parents — each copy has to be fixed within its own major.
 */
function installed(cwd) {
  const file = path.join(cwd, 'package-lock.json');
  if (!fs.existsSync(file)) return {};
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    const idx = key.lastIndexOf('node_modules/');
    if (idx === -1 || !entry || !entry.version) continue;
    const name = key.slice(idx + 'node_modules/'.length);
    (out[name] = out[name] || []).push({ path: key, version: entry.version });
  }
  return out;
}

/**
 * Flatten npm audit output into one record per vulnerable package.
 * Advisory objects in `via` carry the CVE ranges we need; string entries in
 * `via` are just pointers to another vulnerable package in the chain.
 */
function findings(cwd) {
  const auditData = audit(cwd);
  const manifest = readManifest(cwd);
  const copies = installed(cwd);
  const deps = manifest.dependencies || {};
  const devDeps = manifest.devDependencies || {};
  const vulns = auditData.vulnerabilities || {};

  return Object.entries(vulns).map(([name, v]) => {
    const advisories = (v.via || []).filter((x) => x && typeof x === 'object');
    const section = Object.prototype.hasOwnProperty.call(deps, name)
      ? 'dependencies'
      : Object.prototype.hasOwnProperty.call(devDeps, name)
        ? 'devDependencies'
        : null;

    return {
      name,
      severity: v.severity || 'unknown',
      isDirect: section !== null,
      section,
      declared: section ? manifest[section][name] : null,
      vulnerableRange: v.range || '',
      advisories: advisories.map((a) => ({
        id: a.url ? String(a.url).split('/').pop() : String(a.source || ''),
        title: a.title || '',
        severity: a.severity || v.severity,
        range: a.range || '',
        url: a.url || '',
      })),
      viaNames: (v.via || []).filter((x) => typeof x === 'string'),
      fixAvailable: v.fixAvailable,
      installed: copies[name] || [],
      topLevel: (copies[name] || []).find((c) => c.path === `node_modules/${name}`) || null,
    };
  });
}

module.exports = { npm, audit, findings, installed, readManifest };
