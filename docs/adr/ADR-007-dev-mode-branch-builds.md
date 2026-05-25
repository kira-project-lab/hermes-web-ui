---
title: ADR-007 — Dev Mode Branch Builds
status: draft
date: 2026-05-25
branch: fork-review/dev-mode-branch-builds
tags:
  - hermes
  - web-ui
  - adr
  - dev-mode
  - branch-builds
---

# ADR-007 — Dev Mode Branch Builds

## Context

Maxim wants a developer-only mode in Hermes Web UI settings. When enabled, the UI should expose a way to build any branch from the repository.

The requested number was ADR-006, but ADR-006 is already used by [[ADR-006 — Session Tab Title Reflection]]. This decision is recorded as ADR-007 to avoid renumbering existing notes.

## Problem

Branch builds are useful for reviewing feature branches from the Web UI, but they are also risky:

- building an arbitrary branch executes untrusted package scripts and source code;
- builds can consume CPU, RAM, disk, and time;
- local build output can conflict with the currently running app if not isolated;
- exposing this to non-admin users would be a security issue;
- a naïve implementation can accidentally deploy or serve an unsafe branch.

## Decision

Use a guarded **Dev Mode Branch Builds** feature.

Recommended MVP:

1. Add a config flag:
   - `dev.enabled: false` by default.
2. Add a Settings UI section visible only when config supports Dev Mode.
3. When Dev Mode is enabled, show a **Branch Builds** panel.
4. Server endpoint allows an authenticated/admin user to:
   - fetch/list repository branches;
   - select a branch;
   - start a build job;
   - view job status/log tail/result.
5. Build jobs must run in an isolated worktree/cache directory under the Web UI runtime home, never in the active app checkout.
6. MVP should run build only; do **not** automatically deploy or replace the active Web UI instance.
7. Add explicit warning copy: branch builds execute code from that branch.

## Best implementation path

### Option A — local isolated worktree build

Server creates an isolated git worktree for the selected branch and runs the project build command with timeout/concurrency limits.

Pros:

- works with local branches and fork-review branches;
- can expose logs directly in the UI;
- does not depend on GitHub Actions secrets or workflow permissions;
- closest to “build any branch in this repository”.

Cons:

- executes branch code on the server;
- needs strong guardrails: admin-only, dev mode off by default, timeout, one build at a time, cleanup, path validation.

Verdict: best MVP if the target is local developer workflow.

### Option B — trigger GitHub Actions workflow_dispatch

UI calls GitHub API to run a workflow for a selected branch.

Pros:

- safer isolation: build runs on GitHub-hosted runner;
- uses existing CI logs/artifacts;
- avoids local arbitrary-code execution.

Cons:

- needs GitHub token/permissions;
- only works for remote branches known to GitHub;
- does not directly produce local build output unless artifacts are downloaded.

Verdict: good later option or safer enterprise mode, not the simplest local-review MVP.

### Option C — switch the active deployed app to another branch

UI builds and serves/restarts Hermes Web UI from the selected branch.

Pros:

- fastest path to previewing a branch as the active app.

Cons:

- high blast radius;
- can break the running UI from inside itself;
- needs service manager integration and rollback.

Verdict: not MVP. Add only after branch builds are reliable.

## Proposed MVP scope

- Config model and config persistence for `dev.enabled`.
- Settings UI toggle for Dev Mode.
- Branch Builds panel hidden unless Dev Mode is enabled.
- Server endpoints:
  - list branches from configured repo/remotes;
  - start build for one selected branch;
  - read current/recent build status/logs.
- Local build runner:
  - isolated worktree per job or per branch;
  - timeout;
  - single active job lock;
  - log capture;
  - cleanup policy.
- Tests for config gating, endpoint authorization/gating, branch validation, and build-runner command construction.

## Non-goals

- No automatic deployment/restart of the active Web UI.
- No arbitrary shell command input from the UI.
- No public/non-admin access.
- No upstream PR actions.
- No support for building external arbitrary repositories in MVP.

## Security and safety requirements

- Dev Mode is off by default.
- Branch Builds endpoints reject requests unless Dev Mode is enabled.
- Branch names are selected from discovered branches or validated with strict git ref rules.
- Server never interpolates branch names into shell strings; use argument arrays.
- Build workdir is under a controlled runtime directory.
- One build at a time for MVP.
- Build command and timeout are fixed/configured server-side, not user-supplied.
- Logs must not expose secrets intentionally; avoid printing environment dumps.

## Success criteria

- User can enable Dev Mode in settings.
- Branch Builds UI appears only when Dev Mode is enabled.
- User can choose a branch and start a build.
- UI shows running/success/failure state and log tail.
- Active Hermes Web UI instance is not replaced by the build.
- PR exists only in `kira-project-lab/hermes-web-ui` against `fork-review/upstream-main`.

## Open questions

- Should branch list include only `origin/fork-review/*` or all local/remotes?
- Should successful builds produce downloadable artifacts?
- Should a later phase add “serve preview” as a separate explicit action?
- Which user role is considered admin in the current auth model?
