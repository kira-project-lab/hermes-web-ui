# Branch Preview Dev Mode

Branch Preview is a local maintainer tool for checking another git branch from the Hermes Web UI. It is intentionally hidden from ordinary users and should be treated as a developer/reviewer feature, not a normal application setting.

## Who should use it

Use Branch Preview only on trusted local instances where a super administrator is reviewing code changes.

Ordinary users should not see this feature. Super administrators can find it under:

```text
Settings → Advanced → Developer tools → Branch preview
```

## Security model

Branch Preview builds code from the selected branch inside a local worktree. Building untrusted branches can execute untrusted build scripts or dependencies.

Keep it disabled unless all of these are true:

- you trust the repository checkout;
- you trust the branch or understand the risk;
- the instance is local/private;
- the current user is a super administrator.

Client-side hiding is only UX. Server-side super-admin guards and persisted Dev Mode checks remain authoritative.

## Requirements

- Hermes Web UI is running from a local git checkout.
- The server process can run `git` in that checkout.
- The server process can create/remove worktrees under the active Hermes profile directory.
- The user is `super_admin`.
- `dev.enabled` is enabled before build/reset actions are allowed.

Read-only branch listing/status can be available before `dev.enabled` is enabled so a maintainer can select a branch without a catch-22. Mutating actions still require persisted Dev Mode to be enabled.

## Generic maintainer setup

A maintainer of the original repository should use normal branch names and local paths. Do not rely on Kira-specific fork names.

Example profile config:

```yaml
dev:
  enabled: true
  review_base: main
  preview_branch: main
```

Then open the Web UI as a super administrator and use:

```text
Settings → Advanced → Developer tools → Branch preview
```

## Kira fork-review setup

Kira's local fork-review workflow can use a fork review base branch, but this is an environment convention, not product behavior.

Example local profile config:

```yaml
dev:
  enabled: true
  review_base: fork-review/review-base
  preview_branch: fork-review/review-base
```

Fork-first review PRs should use:

```text
base: kira-project-lab/hermes-web-ui:fork-review/review-base
head: kira-project-lab/hermes-web-ui:fork-review/<feature>
```

Do not create upstream PRs against `EKKOLearnAI/hermes-web-ui` unless explicitly approved.

## Unavailable states

The UI may show a compact unavailable message instead of controls:

- `not_git_repo` — the Web UI server is not running from a git checkout.
- `repo_path_missing` — a future explicit repo path setting points to a missing checkout.
- `disabled` — branch preview is disabled for this instance/user.

When unavailable, the UI should not render branch/build/reset controls.

## Troubleshooting

1. Confirm the server working directory is a git checkout:

   ```bash
   git rev-parse --is-inside-work-tree
   ```

2. Confirm branches are visible:

   ```bash
   git for-each-ref --format='%(refname:short)' refs/heads refs/remotes
   ```

3. Confirm the profile has the intended base branch:

   ```yaml
   dev:
     enabled: true
     review_base: main
   ```

4. If build/reset buttons are disabled, save Dev Mode settings first. The UI switch edits draft state; build/reset use the persisted server config.
