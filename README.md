<div align="center">

# omp-green-gh

[![CI](https://github.com/aryrabelo/omp-green-gh/actions/workflows/ci.yml/badge.svg)](https://github.com/aryrabelo/omp-green-gh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000.svg?logo=bun)

**The current branch's pull request status in your OMP statusline — is it green, and
what is blocking it?**

⭐ Star omp-green-gh on GitHub — it's a one-person project and every star helps.

</div>

## Table of contents

- [💡 The idea](#-the-idea)
- [🔍 Reading the segment](#-reading-the-segment)
- [🚦 The blocker ladder](#-the-blocker-ladder)
- [📦 Install](#-install)
- [🔧 How it works](#-how-it-works)
- [📁 Project layout](#-project-layout)
- [✅ Verification](#-verification)
- [🧬 Provenance](#-provenance)
- [🚫 Non-goals (v1)](#-non-goals-v1)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 💡 The idea

You are on a branch. There is a pull request open for it. You do not know whether it
is green, and if it isn't, you do not know what is holding it up — so you go and look:
a browser tab, or `gh pr view`, or `gh pr checks`, every few minutes.

omp-green-gh is an OMP (Oh My Pi) harness extension that answers that question where
you are already looking. It writes one statusline segment through
`ctx.ui.setStatus("z-pr", text)`:

```
PR #64 ✅ 12/12 · approved → Merge PR
PR #64 ⌛ 3/12 · review required · 💬 2 → Resolve 2 review comments
PR #64 draft · ❌ 2/12 · conflicts → Fix CI
PR #64 merged
```

The `#64` is an OSC8 hyperlink to the pull request, so the segment is also the way in.
Colors are plain ANSI.

It is one line on purpose. The harness statusline collapses newlines to spaces and
truncates to the terminal width, so a two-row layout would simply be cut. Keeping it
to a single line means the next action rides inline after the arrow instead of on a
second row that never renders.

## 🔍 Reading the segment

| Piece | What it tells you |
| --- | --- |
| `✅ 12/12` | Every check completed and passed — 12 of 12 passed. |
| `⌛ 3/12` | Nothing failed, but 3 of 12 are still running or not started yet. |
| `❌ 2/12` | 2 of 12 checks failed. |
| `draft` | The pull request is still a draft, so it cannot merge yet. |
| `approved` | The review decision is approval. |
| `changes requested` | A reviewer asked for changes. |
| `review required` | Review is still required — nobody has approved yet. |
| `💬 2` | Two unresolved review threads are waiting on you. |
| `conflicts` | The branch no longer merges cleanly into its base. |
| `merged` / `closed` | Terminal state, collapsed to that one word. |
| `→ ...` | The next action: the highest-priority thing blocking the merge. |

The numerator always counts whatever the icon is reporting: failures on `❌`, still-running
on `⌛`, passes on `✅`. So `❌ 2/12` is two failures, not two passes.

The check verdict follows a strict precedence: **❌ beats ⌛ beats ✅**. A failure
outranks anything still running, and any check that is not `COMPLETED` counts as
pending. That ordering is what keeps the line honest — it can never claim green while
CI is still in flight, which is exactly the moment a naive reading of "no failures
yet" would be wrong.

Check names are normalized to strip provider prefixes, so `ci/circleci: unit` shows up
as `unit`.

## 🚦 The blocker ladder

The text after the arrow is the first match in this fixed priority order, top to
bottom:

1. **Fix CI** — a check failed; the failure has to go away before anything else
   matters.
2. **Resolve conflicts with base** — rebase, or merge the base branch back in.
3. **Publish draft** — take it out of draft so it can be reviewed and merged.
4. **Resolve N review comment(s)** — N review threads are unresolved; answer or
   resolve them.
5. **Set reviewers** — nobody is on the hook to review it yet.
6. **Address changes requested** — a reviewer blocked it; push the fixes.
7. **Waiting for approval** — it is on the reviewers now, not on you.
8. **CI running** — nothing to do but wait for the checks to finish.
9. **Merge PR** — nothing is blocking it.

## 📦 Install

Prerequisites:

- [Bun](https://bun.sh) >= 1.0.0
- [`gh`](https://cli.github.com) on your `PATH` and authenticated (`gh auth status`)

```sh
bun install
ln -s "$PWD/src/main.ts" ~/.omp/agent/extensions/omp-green-gh.ts
```

User-level extensions are auto-discovered from `~/.omp/agent/extensions/` — `.ts` and
`.js` files, symlinks included — so the symlink is the whole installation step. Start
OMP in a repository with an open pull request on the current branch and the segment
appears.

> [!NOTE]
> If `gh` is missing or unauthenticated, the segment stays silent. There is no error
> and no warning, so a blank statusline on a branch you know has a pull request is
> worth checking with `gh auth status` first.

To turn it off without uninstalling, in `~/.omp/agent/config.yml`:

```yaml
disabledExtensions:
  - extension-module:omp-green-gh
```

## 🔧 How it works

Four subprocesses, in order, each capped at 8 seconds:

1. `git branch --show-current`
2. `git remote get-url origin`
3. `gh pr view <branch> --repo <origin> --json
   number,url,state,isDraft,mergeable,reviewDecision`
4. `gh api graphql` on the pull request url — unresolved review threads, reviewers,
   and the check rollup

The owner and repository name always come from the `origin` remote, never from
configuration. That is the point: the same extension works in every checkout you open
without being told where it is. SSH remotes work too, since `gh` accepts the SSH URL
as `--repo`.

The second call exists because `gh pr view --json` cannot report unresolved review
threads at all. The `💬 N` count and the "Resolve N review comment(s)" rung of the
ladder are only possible through GraphQL, so the detail query is a separate step
rather than a nicety.

It has no credentials of its own — `gh` owns authentication. It makes no network call
directly, keeps no configuration file, writes no files, and sends no telemetry.

Refresh is event-driven: the segment is redrawn on `session_start` and `turn_end`,
fire-and-forget, so a turn never blocks waiting on `gh`. Each answer is cached for 60
seconds per directory, which means an idle session spends no subprocesses at all.

The segment is cleared — not left stale — whenever there is nothing to say:

- not a git repository
- on `main`, `master`, `trunk`, or `develop`
- no `origin` remote
- no pull request for the branch
- `gh` missing or unauthenticated

Merged and closed pull requests collapse to one word and skip the detail query. The
whole thing is a no-op when `ctx.hasUI` is false, so headless, print, and subagent
runs cost nothing.

## 📁 Project layout

```
src/
  pr-status.ts    the gh calls plus four pure functions: the check fold, the
                  verdict, the blocker ladder, and the rendering
  main.ts         wiring only: the session events into ctx.ui.setStatus
tests/
  pr-status.test.ts   the pure functions, case by case
  main.test.ts        the wiring and the silence conditions
```

21 tests, run with `bun test`.

## ✅ Verification

```sh
bun run lint && bun run typecheck && bun test
```

## 🧬 Provenance

omp-green-gh is a port of the PR block of the CNX Claude Code statusline
([aryrabelo/cnx-claude](https://github.com/aryrabelo/cnx-claude)):
`cnx/scripts/lib/pr-status.ts` for the data, and the `getNextAction` ladder of
`cnx/statusline/statusline.ts` for the arrow.

Everything installation-specific was cut so it runs in any repository:

| CNX | here |
| --- | --- |
| hardcoded `entrc/entrc-backend` repository | owner and repository from `origin` |
| CircleCI check-group name lists | every check, folded into one verdict |
| `preview-app` / `canix-UAT` label squares | dropped |
| Linear and Jira gates | dropped |
| `/cnx:` command suffixes on the next action | plain action text |

## 🚫 Non-goals (v1)

- No PR management: it never merges, approves, comments, or labels. It reports.
- No background watcher and no refresh timer — it redraws on session events only.
- No forge other than GitHub, and no GitHub access that bypasses `gh`.
- No multi-PR or multi-repo dashboard: one segment, the current branch, the current
  directory.
- No configuration file: no custom thresholds, no per-repo check groups, no label
  rules.
- No ticket-tracker integration (Linear, Jira) — deliberately cut from the CNX
  original.
- No desktop or terminal notifications.

## 🤝 Contributing

Bug reports, feature ideas, and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the project, the verification a
change has to pass, and the scope this project keeps (see **Non-goals** above).
Security issues: please follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## 📄 License

[MIT](LICENSE) © Ary Rabelo
