'use strict';

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info', 'unknown'];

function bySeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

function counts(plan) {
  return {
    upgrades: plan.upgrades.length,
    overrides: plan.overrides.length,
    unfixable: plan.unfixable.length,
    carriers: plan.carriers.length,
  };
}

/** Human-readable console summary. */
function console_(plan, { colour = true } = {}) {
  const c = (code, s) => (colour ? `[${code}m${s}[0m` : s);
  const lines = [];

  if (plan.upgrades.length) {
    lines.push(c(1, 'Upgrade (direct dependencies)'));
    for (const u of [...plan.upgrades].sort(bySeverity)) {
      const flag = u.crossesMajor ? c(33, ' [major]') : '';
      lines.push(`  ${u.name}  ${u.from} -> ${u.to}  (${u.severity})${flag}`);
    }
    lines.push('');
  }

  if (plan.overrides.length) {
    lines.push(c(1, 'Override (transitive dependencies)'));
    for (const o of [...plan.overrides].sort(bySeverity)) {
      lines.push(`  ${o.key || o.name}  -> ${o.to}  (${o.severity})  ${o.reason}`);
    }
    lines.push('');
  }

  if (plan.unfixable.length) {
    lines.push(c(1, 'Needs a human'));
    for (const u of [...plan.unfixable].sort(bySeverity)) {
      lines.push(`  ${c(31, u.name)}  (${u.severity})`);
      lines.push(`      ${u.reason}`);
    }
    lines.push('');
  }

  if (plan.carriers.length) {
    lines.push(
      c(2, `${plan.carriers.length} package(s) clear automatically once their transitives are fixed`)
    );
    lines.push('');
  }

  const n = counts(plan);
  if (n.upgrades + n.overrides + n.unfixable === 0) {
    lines.push(c(32, 'No action needed — nothing fixable found.'));
  }
  return lines.join('\n');
}

/** Markdown report — the artefact a developer pastes into a ticket. */
function markdown(plan, { explanation = null, project = '', verified = null } = {}) {
  const n = counts(plan);
  const out = [];
  out.push(`# Vulnerability remediation${project ? ` — ${project}` : ''}`);
  out.push('');
  out.push(`_Generated ${new Date().toISOString()} by vulnfix._`);
  out.push('');
  out.push(
    `**${n.upgrades}** upgrade(s), **${n.overrides}** override(s), **${n.unfixable}** needing human review.`
  );
  out.push('');

  if (verified) {
    out.push('## Verification');
    out.push('');
    out.push(`- Clean install: ${verified.install ? 'passed' : 'FAILED'}`);
    out.push(
      `- Build: ${verified.build === null ? 'skipped' : verified.build ? 'passed' : 'FAILED'}`
    );
    out.push(`- Remaining fixable findings after fix: ${verified.residualFixable}`);
    out.push('');
  }

  if (plan.upgrades.length) {
    out.push('## Upgraded');
    out.push('');
    out.push('| Package | Section | From | To | Severity |');
    out.push('|---|---|---|---|---|');
    for (const u of [...plan.upgrades].sort(bySeverity)) {
      out.push(`| \`${u.name}\` | ${u.section} | ${u.from} | ${u.to} | ${u.severity} |`);
    }
    out.push('');
  }

  if (plan.overrides.length) {
    out.push('## Overridden (transitive)');
    out.push('');
    out.push('| Package | Pinned to | Severity | Why |');
    out.push('|---|---|---|---|');
    for (const o of [...plan.overrides].sort(bySeverity)) {
      out.push(`| \`${o.key || o.name}\` | ${o.to} | ${o.severity} | ${o.reason} |`);
    }
    out.push('');
  }

  if (plan.unfixable.length) {
    out.push('## Needs a human decision');
    out.push('');
    for (const u of [...plan.unfixable].sort(bySeverity)) {
      out.push(`- **\`${u.name}\`** (${u.severity}) — ${u.reason}`);
    }
    out.push('');
    if (explanation && explanation.text) {
      out.push('### Triage notes');
      out.push('');
      if (explanation.source === 'template') {
        out.push('_Generated from the built-in template (no AI provider configured)._');
      } else {
        out.push(`_Written by ${explanation.source}. Review before acting._`);
      }
      out.push('');
      out.push(explanation.text);
      out.push('');
    }
  }

  return out.join('\n');
}

module.exports = { console: console_, markdown, counts };
