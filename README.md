<div align="center">

# omp-green-gh

[![CI](https://github.com/aryrabelo/omp-green-gh/actions/workflows/ci.yml/badge.svg)](https://github.com/aryrabelo/omp-green-gh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000.svg?logo=bun)

**Your repository's pull requests in the OMP statusline — is the current branch green,
what is blocking it, and what else is open?**

⭐ Star omp-green-gh on GitHub — it's a one-person project and every star helps.

</div>

## Table of contents

- [💡 The idea](#-the-idea)
- [🔍 Reading the lines](#-reading-the-lines)
- [🔁 The second line](#-the-second-line)
- [🚦 The blocker ladder](#-the-blocker-ladder)
- [⌨️ Commands](#-commands)
- [📦 Install](#-install)
- [🔧 How it works](#-how-it-works)
- [⚠️ Known limits](#-known-limits)
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
you are already looking. It writes two statusline lines, through
`ctx.ui.setStatus("gh-pr", …)` and `ctx.ui.setStatus("gh-pr-others", …)`:

```
PR #11 ⌛ 1/3 → Set reviewers
aryrabelo/omp-green-gh#10 draft · ❌ 1/2 → Fix CI (1/3)
```

The first line is the current branch's pull request. The second is one of the
repository's *other* open pull requests, labelled `owner/repo#N`, with its position in
the rotation: `(1/3)` is the first of three.

Each is one line on purpose. The harness statusline collapses newlines to spaces and
truncates to the terminal width, so the next action rides inline after the arrow
instead of on a row that never renders.

Either line can appear without the other. On `main` there is no pull request for the
branch, so the first line is silent and the second still reports what is open.

## 🔍 Reading the lines

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
| `owner/repo#N` | Second line only: which pull request, since it is not the branch you are on. |
| `(1/3)` | Second line only: position in the rotation — the first of three other open pull requests. |
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

## 🔁 The second line

The second line is one of the repository's other open pull requests, and it steps to
the next one on every redraw — a redraw being session start and the end of a turn.
There is no timer, so an idle session does not rotate, and a repository with three
other open pull requests shows all three across three turns.

- **Label** — `owner/repo#N`, owner and name parsed from the `origin` remote, because
  a bare `#N` says nothing about which pull request the rotation landed on.
- **Position** — the trailing `(i/n)`: which of the `n` other open pull requests this
  is.
- **Order** — by pull request number, descending, so the order is stable between
  redraws.
- **Which ones** — open pull requests, up to 20, minus the current branch's own (that
  one is the first line).
- **No "Set reviewers"** — `gh pr list` cannot report reviewer counts, so that rung of
  the ladder is skipped here rather than guessed. Every other rung applies.
- **No `💬 N`** — unresolved review threads need a GraphQL query per pull request, so
  the second line does without the count. The first line has it.

Rotating is free: the list is fetched once, pre-rendered with its positions, and
cached for 60 seconds per directory, so stepping to the next pull request only indexes
into an array and spawns nothing. The feature costs one extra subprocess per cache
window.

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

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| `/gh-open` | Opens the current branch's pull request in your browser, via `gh pr view --web`. |
| `/gh-open 7` or `/gh-open #7` | Opens pull request 7. An argument that is not a number is refused before any subprocess runs. |
| `/green` | Hands the agent a prompt to get the current branch's pull request green. |

`/green` runs nothing itself. It sends the agent a request to inspect the pull request
with `gh` — the failing checks and their logs, the unresolved review threads with the
body of every comment, whether the branch is behind its base, any merge conflict —
then fix what is fixable in the working tree and report what it changed and what it
left alone. The prompt tells it not to merge and not to force-push.

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
OMP in a repository with an open pull request and the lines appear.

> [!NOTE]
> If `gh` is missing or unauthenticated, both lines stay silent. There is no error and
> no warning, so a blank statusline in a repository you know has open pull requests is
> worth checking with `gh auth status` first.

To turn it off without uninstalling, in `~/.omp/agent/config.yml`:

```yaml
disabledExtensions:
  - extension-module:omp-green-gh
```

## 🔧 How it works

Five subprocesses at most, each capped at 8 seconds:

1. `git branch --show-current`
2. `git remote get-url origin`
3. `gh pr view <branch> --repo <origin> --json
   number,url,state,isDraft,mergeable,reviewDecision`
4. `gh api graphql` on the pull request url — unresolved review threads, reviewers,
   and the check rollup
5. `gh pr list --repo <origin> --state open --limit 20 --json
   number,url,isDraft,mergeable,reviewDecision,statusCheckRollup` — every other open
   pull request, in one round trip, for the second line

On a trunk branch, 3 and 4 are skipped: only the git pair and the list call run.

The owner and repository name always come from the `origin` remote, never from
configuration. That is the point: the same extension works in every checkout you open
without being told where it is. SSH remotes work too, since `gh` accepts the SSH URL
as `--repo`.

The GraphQL call exists because `gh pr view --json` cannot report unresolved review
threads at all. The `💬 N` count and the "Resolve N review comment(s)" rung of the
ladder are only possible through GraphQL, so the detail query is a separate step
rather than a nicety.

The list call is one round trip for all of them on purpose. A GraphQL query per pull
request would buy the second line its `💬 N` count and its reviewer check at a cost of
up to 20 subprocesses; it goes without both instead.

It has no credentials of its own — `gh` owns authentication. It makes no network call
directly, keeps no configuration file, writes no files, and sends no telemetry.

Refresh is event-driven: both lines are redrawn on `session_start` and `turn_end`,
fire-and-forget, so a turn never blocks waiting on `gh`. The answer is cached for 60
seconds per directory, which means an idle session spends no subprocesses at all.

A line is cleared — not left stale — whenever it has nothing to say: `setStatus` is
called with `undefined`, which removes the segment, where `""` would leave an empty one
behind. The first line is silent when there is:

- no git repository
- a trunk branch: `main`, `master`, `trunk`, or `develop`
- no `origin` remote
- no pull request for the branch
- no `gh`, or an unauthenticated one

The second line is silent when there is no `origin` remote, when `origin` is a url
`repoSlug` will not parse, when `gh` is missing or unauthenticated, or when the
repository has no other open pull request.

Merged and closed pull requests collapse to one word and skip the detail query. The
whole extension is a no-op when `ctx.hasUI` is false, so headless, print, and subagent
runs cost nothing.

## ⚠️ Known limits

- **No colour and no clickable link.** The extension emits ANSI colours and an OSC 8
  hyperlink on the pull request number, and neither survives the harness statusline —
  what you see is the emoji and the plain text. That is why the rendering leans on
  emoji, and why `/gh-open` exists.
- **`origin` urls with inline credentials are not parsed.** `repoSlug` accepts
  `git@host:owner/repo`, `ssh://git@host/owner/repo` and `https://host/owner/repo`,
  with or without `.git`. It rejects a remote like
  `https://user:token@host/owner/repo`, and the second line is simply absent for such
  a checkout. The first line still works there, because it hands the raw `origin` url
  to `gh --repo`.
- **The second line carries no `💬 N` and never says "Set reviewers"** — see
  [The second line](#-the-second-line).
- **20 pull requests at most** in the rotation — that is `gh pr list --limit 20`.
- **Failures are silent.** A missing or unauthenticated `gh`, a timeout, or malformed
  json produces no line and no warning.

## 📁 Project layout

```
src/
  pr-status.ts    the gh calls plus the pure functions: the check fold, the verdict,
                  the blocker ladder, the rendering, the rotation, the origin parse
  main.ts         wiring only: the session events into ctx.ui.setStatus, and the
                  /gh-open and /green commands
tests/
  pr-status.test.ts   the pure functions, case by case
  main.test.ts        the wiring, the commands, and the silence conditions
```

44 tests, run with `bun test`.

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

- No pull request management from the extension itself: it never merges, approves,
  comments, or labels. `/gh-open` opens a browser, and `/green` asks the agent — with
  instructions not to merge and not to force-push.
- No background watcher and no refresh timer — it redraws on session events only.
- No forge other than GitHub, and no GitHub access that bypasses `gh`.
- No cross-repository dashboard: both lines describe the `origin` of the current
  directory, and the second is capped at 20 open pull requests.
- No configuration file: no custom thresholds, no per-repo check groups, no label
  rules, no way to change the rotation or its order.
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
