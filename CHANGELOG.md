# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-03

First release of omp-green-gh: an OMP (Oh My Pi) extension that answers, in the
statusline, whether the current branch's pull request is green and what is blocking it.

### Added

- A single statusline segment published through `ctx.ui.setStatus("z-pr", …)`, kept to one
  line because the harness collapses newlines to spaces and truncates to the terminal
  width — so the next action rides inline after the arrow instead of on a second row.
- Check verdict with the precedence ❌ > ⌛ > ✅: a failure outranks anything still running,
  and any check that is not `COMPLETED` counts as pending, so the line can never claim
  green while CI is in flight. Check names are normalized to strip provider prefixes
  (`ci/circleci: unit` becomes `unit`).
- Unresolved review-thread count, taken from a `gh api graphql` query on the PR — the only
  way to get it, since `gh pr view --json` cannot report unresolved review threads at all.
- Blocker ladder after the arrow, in priority order: Fix CI; Resolve conflicts with base;
  Publish draft; Resolve N review comment(s); Set reviewers; Address changes requested;
  Waiting for approval; CI running; Merge PR.
- OSC8 hyperlink on the PR number, so `#64` opens the pull request from the statusline.
- Owner/repo resolved from the `origin` remote every time, never from configuration; SSH
  remotes work, since `gh` accepts the SSH URL as `--repo`.
- Per-directory 60-second cache of the answer, and an 8-second cap on each of the four
  subprocesses (`git branch --show-current`, `git remote get-url origin`, `gh pr view`,
  `gh api graphql`). The segment is redrawn on `session_start` and `turn_end`,
  fire-and-forget, so a turn never blocks on `gh` and an idle session spends no
  subprocesses.
- Silence — the segment is cleared, not left stale — outside a git repo, on
  `main`/`master`/`trunk`/`develop`, with no `origin` remote, with no PR for the branch, or
  when `gh` is missing or unauthenticated. Merged and closed PRs collapse to one word and
  skip the detail query.
- No-op when `ctx.hasUI` is false, so headless, print, and subagent runs spend nothing.

### Notes

- Ported from the PR block of the CNX Claude Code statusline
  ([aryrabelo/cnx-claude](https://github.com/aryrabelo/cnx-claude) —
  `cnx/scripts/lib/pr-status.ts` for the data, the `getNextAction` ladder of
  `cnx/statusline/statusline.ts` for the arrow). Everything installation-specific was cut
  so it runs in any repository: the hardcoded `entrc/entrc-backend` repo, the CircleCI
  check-group name lists, the `preview-app`/`canix-UAT` label squares, the Linear and Jira
  gates, and the `/cnx:` command suffixes.

[Unreleased]: https://github.com/aryrabelo/omp-green-gh/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aryrabelo/omp-green-gh/releases/tag/v0.1.0
