# renovate-pilot

A minimal repo to validate **Renovate** as a Module-Federation-aware, frozen-major
dependency fixer — the deterministic alternative to the bespoke gpt-4o security agent.

It contains only what Renovate and Dependabot need to make decisions:

| File | Why it's here |
|---|---|
| `package.json` | Frozen Angular 20 + Kendo 24 deps, **plus an intentional vuln: `qs@6.5.2`** |
| `package-lock.json` | The resolved tree — Dependabot/Renovate scan this for the CVE |
| `renovate.json` | The pilot config: frozen-major caps + vulnerability remediation |

No `node_modules`, no app source, no build — none of that affects Renovate's decisions.

> ⚠️ `package.json` carries a deliberately vulnerable `qs@6.5.2`. That's the point of
> the pilot. Keep this repo **private**.

---

## What we're testing (the two make-or-break behaviors)

1. **Frozen majors are respected.** Renovate must NOT raise any `@angular/*` or
   `@progress/kendo-*` **major** PR (those crash the host/remote via Module Federation
   `shareAll({ singleton, strictVersion })`). Newer majors exist on npm (Angular 22,
   Kendo 25) — the config caps them via `allowedVersions`.
2. **In-major security fixes still flow.** Renovate SHOULD raise one PR bumping
   `qs` within its major (`6.5.2` → `6.15.x`) — no override, no major jump.

The `renovate.json` caps are per-group because Kendo packages span majors:
`@angular/*` + `@angular-devkit/*` + native-federation → `<21`;
`@progress/kendo-angular-*` → `<25`; kendo data-query/drawing/licensing → `<2`;
kendo-theme-default → `<15`. (The Angular rule is intentionally **last** — Renovate's
`allowedVersions` rules interact by order.)

---

## Setup (you run these)

### 1. Create the repo and push
Create a **private** GitHub repo and push this folder.

### 2. Enable Dependabot alerts
Repo → **Settings → Advanced Security (Code security) → Dependabot alerts: Enable.**
This is the alert feed Renovate's `vulnerabilityAlerts` reads. Without it, the
security-fix behavior won't trigger.

### 3. Pick a Renovate runner

**Option A — Mend Renovate app (recommended, zero config):**
Install <https://github.com/apps/renovate> and grant it this repo. It auto-reads
`renovate.json`. The first run opens an onboarding **Dependency Dashboard** issue/PR.

**Option B — Self-hosted Action (fully in your repo):**
- Add a repo secret `RENOVATE_TOKEN` — a classic PAT with `repo` scope.
- Pin the action in `.github/workflows/renovate.yml` to the latest release:
  <https://github.com/renovatebot/github-action/releases>
- Run **Actions → Renovate (self-hosted) → Run workflow** with **Dry run = true** first
  (logs only). Once the log looks right, re-run with Dry run = false to raise real PRs.

---

## How to grade the result ✅ / ❌

After the first real (non-dry) run, check the PRs and the Dependency Dashboard:

- ✅ A PR exists bumping **`qs` to `~6.15.x`** (within major 6).
- ✅ **No** open PR bumps any `@angular/*` or `@progress/kendo-*` to a new **major**.
- ✅ The Dependency Dashboard lists the `qs` update under security/remediation.
- ❌ If an Angular/Kendo major PR appears → the `allowedVersions` cap didn't hold
  (the thing the local dry-run couldn't certify — this is exactly what we're verifying).

Record the outcome; that's the head-to-head data point against the gpt-4o agent.
