# renovate-pilot

A minimal repo that proves out dependency-vulnerability remediation for an
Angular + Kendo Module Federation app using **only GitHub first-party features
plus our own code**: no Renovate, no third-party bot with repo access.

(The repo name is historical; Renovate has been removed.)

| File | Purpose |
|---|---|
| `package.json` | Frozen Angular 20 + Kendo 24 deps, **plus an intentional vuln: `qs@6.5.2`** |
| `package-lock.json` | The resolved tree that Dependabot and vulnfix scan |
| `vulnfix.config.json` | Policy: which packages are frozen at their current major, and why |
| `.github/dependabot.yml` | Dependabot security updates for **direct** dependencies |
| `.github/workflows/vulnfix-overrides.yml` | Weekly job: pins vulnerable **transitive** dependencies via npm overrides and opens a **draft** PR |
| `.github/workflows/frozen-major-check.yml` | Merge gate on every PR: fails if a frozen package moved to a new major |
| `tools/vulnfix/` | Vendored copy of the vulnfix CLI (zero dependencies) |

> `package.json` carries a deliberately vulnerable `qs@6.5.2`. Keep this repo **private**.

## Who does what

| Job | Done by |
|---|---|
| Detect | Dependabot alerts |
| Fix direct dependencies | Dependabot security updates (targets the minimum patched version) |
| Fix transitive dependencies | vulnfix, via scoped npm `overrides` (one per installed major) |
| Enforce frozen majors | `dependabot.yml` ignore rules **and** the frozen-major check on every PR |
| Decide what can't be auto-fixed | A human, using the report vulnfix attaches to its PR |

## Setup

1. **Settings → Code security**: enable **Dependency graph** (private repos), **Dependabot alerts**, and **Dependabot security updates**.
2. **Settings → Actions → General → Workflow permissions**: tick **Allow GitHub Actions to create and approve pull requests** (needed by the vulnfix workflow).
3. **Settings → Branches**: protect `main`, make **Frozen-major check / frozen-majors** a required status check, and **require at least one approving review**. Dependabot can't open draft PRs, so the required review is what stops its PRs from merging without a person.
4. **Actions → vulnfix overrides → Run workflow** to trigger the first run instead of waiting for Monday.

## What to check

- ✅ Dependabot opens a PR bumping **`qs` within major 6**.
- ✅ The vulnfix workflow opens a **draft** PR adding `overrides` for vulnerable transitives (e.g. scoped keys like `brace-expansion@1` and `brace-expansion@5`), with a report as the PR body.
- ✅ Both PRs pass **Frozen-major check**.
- ✅ No PR moves any `@angular/*`, `@angular-devkit/*`, `@progress/kendo-*` or native-federation package to a new major.
- ❌ If a PR does cross a frozen major, the check must fail and block the merge.

To see the gate fail on purpose: open a PR that changes `@angular/core` to `^22.0.0`.

## Run vulnfix locally

```bash
node tools/vulnfix/bin/vulnfix.js scan                     # plan only, changes nothing
node tools/vulnfix/bin/vulnfix.js scan --overrides-only    # what the workflow would do
node tools/vulnfix/bin/vulnfix.js check --base origin/main # the merge gate
```

## Known limits

- PRs opened with `GITHUB_TOKEN` don't trigger other workflows, so the frozen-major check runs **inside** the vulnfix job as well. In an enterprise setup, use a GitHub App token so the required checks run on the PR normally.
- This repo has no application source, so nothing is built. In a real app, add the build and a Module Federation smoke test as required checks; that's the step that catches a fix which satisfies the advisory but breaks the app.
- Actions are referenced by tag. For enterprise use, pin them to a full commit SHA.
