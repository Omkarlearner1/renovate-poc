#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const policy = require('../lib/policy');
const scan = require('../lib/scan');
const planner = require('../lib/plan');
const { remediate, restrict } = require('../lib/remediate');
const verify = require('../lib/verify');
const check = require('../lib/check');
const report = require('../lib/report');
const explain = require('../lib/ai/explain');
const provider = require('../lib/ai/provider');

const USAGE = `vulnfix — local CVE remediation for npm projects

Usage
  vulnfix scan              Show findings and the fix plan. Changes nothing.
  vulnfix fix               Apply the plan, then verify (clean install, re-audit, build).
  vulnfix explain           Write up the findings that need a human.
  vulnfix check             Fail if a frozen package moved to a new major
                            (use as a required check on fix PRs).

Options
  --cwd <path>         Project directory (default: current directory)
  --only <a,b>         Limit to these packages
  --overrides-only     Only pin transitive dependencies; leave direct
                       dependencies to Dependabot
  --yes, -y            Skip the confirmation prompt (fix)
  --no-build           Skip the build step (fix)
  --no-clean           Reuse node_modules instead of a clean re-resolve (fix)
  --ignore-scripts     Run npm install without lifecycle scripts (fix)
  --lockfile-only      Re-resolve package-lock.json only: no node_modules, no
                       package code runs, no build (fix; meant for CI)
  --base <git-ref>     Baseline to compare against (check), e.g. origin/main
  --base-file <path>   Baseline package.json instead of a git ref (check)
  --json               Machine-readable output
  --out <file>         Markdown report path (default: vulnfix-report.md)
  -h, --help           Show this

AI is OFF by default; everything above works with no model and no network
beyond the npm registry. Set VULNFIX_AI=anthropic|azure|ollama to have the
"needs a human" section written as prose. Only package names, versions and
public advisory IDs are ever sent.

Exit codes: 0 clean · 1 fixable findings remain / check failed · 2 error
`;

const VALUE_FLAGS = {
  '--cwd': 'cwd',
  '--out': 'out',
  '--only': 'only',
  '--base': 'base',
  '--base-file': 'baseFile',
};
const BOOL_FLAGS = {
  '-h': 'help',
  '--help': 'help',
  '-y': 'yes',
  '--yes': 'yes',
  '--json': 'json',
  '--no-build': 'noBuild',
  '--no-clean': 'noClean',
  '--ignore-scripts': 'ignoreScripts',
  '--overrides-only': 'overridesOnly',
  '--lockfile-only': 'lockfileOnly',
};

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL_FLAGS[a]) out.flags[BOOL_FLAGS[a]] = true;
    else if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out.flags[VALUE_FLAGS[a]] = argv[++i];
    } else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else out._.push(a);
  }
  return out;
}

function onlyList(flags) {
  return flags.only ? flags.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

function loadContext(flags) {
  const cwd = path.resolve(flags.cwd || process.cwd());
  const config = policy.load(cwd);
  const manifest = scan.readManifest(cwd);
  const findings = scan.findings(cwd);
  const plan = restrict(
    planner.build(findings, manifest, config, {
      preferParentUpgrade: !flags.overridesOnly,
    }),
    { overridesOnly: flags.overridesOnly, only: onlyList(flags) }
  );
  return { cwd, config, manifest, findings, plan };
}

function policyBanner(config) {
  if (!config._source) {
    return 'No vulnfix.config.json found — no packages are pinned. Majors will be proposed freely.';
  }
  const n = (config.frozen || []).length;
  return `Policy: ${config._source} (${n} frozen pattern${n === 1 ? '' : 's'})`;
}

async function cmdScan(ctx, flags) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(ctx.plan, null, 2) + '\n');
  } else {
    console.log(policyBanner(ctx.config));
    console.log('');
    console.log(report.console(ctx.plan));
  }
  const n = report.counts(ctx.plan);
  return n.upgrades + n.overrides > 0 ? 1 : 0;
}

async function cmdFix(ctx, flags) {
  const n = report.counts(ctx.plan);
  console.log(policyBanner(ctx.config));
  console.log('');
  console.log(report.console(ctx.plan));

  if (n.upgrades + n.overrides === 0) {
    console.log('Nothing to apply.');
    await writeReport(ctx, flags, null);
    return 0;
  }

  if (!flags.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Apply ${n.upgrades} upgrade(s) and ${n.overrides} override(s)? [y/N] `
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Aborted. Nothing was changed.');
      return 0;
    }
  }

  console.log('');
  const result = remediate(ctx.cwd, ctx.config, {
    overridesOnly: flags.overridesOnly,
    only: onlyList(flags),
    lockfileOnly: flags.lockfileOnly,
    ignoreScripts: flags.ignoreScripts,
    clean: !flags.noClean,
    log: (m) => console.log(m),
  });

  if (result.installFailed) {
    console.error('\nInstall failed. package.json was changed — review with `git diff`.');
    console.error(result.installOutput.split('\n').slice(-15).join('\n'));
    return 2;
  }

  let built = null;
  if (!flags.noBuild && !flags.lockfileOnly) {
    console.log('\nBuilding...');
    const b = verify.build(ctx.cwd, {
      command: ctx.config.buildCommand,
      log: (m) => console.log(m),
    });
    built = b.skipped ? null : b.ok;
    if (b.skipped) console.log(`  build skipped (${b.reason})`);
    if (built === false) {
      console.error('\nBuild FAILED after the fix. Review `git diff` before committing.');
      console.error(b.output.split('\n').slice(-25).join('\n'));
    }
  }

  const left = result.remaining;
  console.log(
    `\nAfter ${result.passes.length} pass(es): ${result.fixableLeft} fixable finding(s) left, ` +
      `${left.unfixable.length} needing a human.`
  );

  await writeReport(
    { ...ctx, plan: mergeApplied(result) },
    flags,
    { install: true, build: built, residualFixable: result.fixableLeft }
  );

  console.log('\nNothing was committed. Review with `git diff`, then commit.');
  if (built === false) return 2;
  return result.fixableLeft > 0 ? 1 : 0;
}

/** For the report: everything that was applied, plus what is still blocked. */
function mergeApplied(result) {
  const applied = { upgrades: [], overrides: [], unfixable: [], carriers: [] };
  for (const p of result.passes) {
    if (p.changes.length === 0) continue;
    applied.upgrades.push(...p.plan.upgrades);
    applied.overrides.push(...p.plan.overrides);
  }
  applied.unfixable = result.remaining.unfixable;
  return applied;
}

async function cmdExplain(ctx, flags) {
  if (ctx.plan.unfixable.length === 0) {
    console.log('Nothing needs a human — no unfixable findings.');
    return 0;
  }
  if (!provider.isEnabled()) {
    console.log('VULNFIX_AI is off — using the built-in template.\n');
  }
  const explanation = await explain.unfixable(ctx.plan.unfixable);
  if (explanation.warning) console.error(`warning: ${explanation.warning}\n`);
  console.log(explanation.text);
  await writeReport(ctx, flags, null, explanation);
  return 1;
}

async function cmdCheck(flags) {
  const cwd = path.resolve(flags.cwd || process.cwd());
  const config = policy.load(cwd);
  if (!flags.base && !flags.baseFile) {
    throw new Error('check needs --base <git-ref> or --base-file <path>');
  }
  const base = flags.base
    ? { ref: flags.base }
    : {
        manifestFile: path.resolve(flags.baseFile),
        lockFile: path.join(path.dirname(path.resolve(flags.baseFile)), 'package-lock.json'),
      };
  const violations = check.frozenMajors(cwd, config, base);

  if (flags.json) {
    process.stdout.write(JSON.stringify({ violations }, null, 2) + '\n');
  } else if (violations.length === 0) {
    console.log(`${policyBanner(config)}\nOK — no frozen package moved to a new major.`);
  } else {
    console.log(`${policyBanner(config)}\n`);
    console.log('Frozen packages moved to a new major:');
    for (const v of violations) {
      console.log(`  ${v.name}  ${v.from} -> ${v.to}  (${v.where})`);
      console.log(`      ${v.reason}`);
    }
  }
  return violations.length > 0 ? 1 : 0;
}

async function writeReport(ctx, flags, verified, explanation) {
  const exp = explanation || (await explain.unfixable(ctx.plan.unfixable));
  const md = report.markdown(ctx.plan, {
    explanation: exp,
    project: (ctx.manifest && ctx.manifest.name) || '',
    verified,
  });
  const out = path.resolve(ctx.cwd, flags.out || 'vulnfix-report.md');
  fs.writeFileSync(out, md);
  console.log(`\nReport written to ${path.relative(process.cwd(), out) || out}`);
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }

  const command = args._[0];
  if (args.flags.help || !command) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!['scan', 'fix', 'explain', 'check'].includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    process.stdout.write(USAGE);
    return 2;
  }

  try {
    if (command === 'check') return await cmdCheck(args.flags);
    const ctx = loadContext(args.flags);
    const run = { scan: cmdScan, fix: cmdFix, explain: cmdExplain }[command];
    return await run(ctx, args.flags);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
);
