'use strict';

const { spawnSync } = require('child_process');
const semver = require('./semver');

const IS_WIN = process.platform === 'win32';
const cache = new Map();

/**
 * Every stable version of a package published on the registry, ascending.
 * The planner only ever targets a version from this list, so it can never
 * propose a version that doesn't exist.
 */
function versions(name) {
  if (cache.has(name)) return cache.get(name);
  const res = spawnSync('npm', ['view', name, 'versions', '--json'], {
    shell: IS_WIN,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`could not query the registry for ${name}`);
  }
  let list;
  try {
    list = JSON.parse(res.stdout);
  } catch {
    throw new Error(`unreadable registry response for ${name}`);
  }
  if (typeof list === 'string') list = [list];
  const stable = list
    .filter((v) => !v.includes('-') && semver.parse(v))
    .sort((a, b) => semver.compare(semver.parse(a), semver.parse(b)));
  cache.set(name, stable);
  return stable;
}

module.exports = { versions };
