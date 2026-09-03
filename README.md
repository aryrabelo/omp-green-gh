# omp-green-gh

OMP harness extension. One statusline segment: **is the current branch's pull request green, and
what is blocking it?**

```
PR #64 ✅ 12/12 · approved → Merge PR
PR #64 ⌛ 3/12 · review required · 💬 2 → Resolver 2 review comments
PR #64 draft · ❌ 2/12 · conflicts → Corrigir CI
PR #64 merged
```

`#64` is an OSC8 hyperlink to the PR. One line on purpose: the harness statusline is
`ctx.ui.setStatus(key, text)`, which collapses newlines and truncates to the terminal width, so
the next action rides inline after the arrow instead of on a second row.

## Origin

Port of the PR block of the CNX Claude Code statusline
([aryrabelo/cnx-claude](https://github.com/aryrabelo/cnx-claude)): `cnx/scripts/lib/pr-status.ts`
for the data, and the `getNextAction` ladder of `cnx/statusline/statusline.ts` for the arrow.

Everything installation-specific was cut, so this runs in any repository:

| CNX | here |
|---|---|
| hardcoded `entrc/entrc-backend` | owner/repo from the `origin` remote |
| `CI_MAIN_CHECKS` / `CI_E2E_CHECKS` / `CI_DEPLOY_PREVIEW_CHECKS` name lists | every check, one verdict |
| `preview-app` / `canix-UAT` label squares | dropped |
| Linear + Jira gates, `/cnx:` command suffixes | dropped |
| statusline stdin protocol, `/tmp` cache files | `setStatus` segment, in-process cache |

Kept because it is generic and load-bearing: the ❌ > ⌛ > ✅ precedence (a failure outranks
anything still running, so the line cannot claim green while CI is in flight), the CircleCI-style
check-name normalization, and unresolved review threads — which `gh pr view` cannot report at all,
so it takes the GraphQL query CNX already had.

## Behaviour

- `git branch --show-current` + `git remote get-url origin`, then
  `gh pr view <branch> --repo <origin>`, then one `gh api graphql` on the PR url for review
  threads, reviewers and checks. No token of its own — `gh` owns auth.
- Silent when there is nothing to say: not a git repo, on `main`/`master`/`trunk`/`develop`, no
  `origin`, no PR for the branch, `gh` missing or unauthenticated. The segment is cleared rather
  than left stale.
- Merged/closed PRs collapse to one word and skip the detail query.
- Redrawn at `session_start` and `turn_end`, fire-and-forget so a turn never blocks on `gh`.
  Cached 60s per directory, every subprocess capped at 8s. An idle session costs nothing.
- No-op when `ctx.hasUI` is false (headless, print, subagent).

## Install

```bash
bun install
ln -s "$PWD/src/main.ts" ~/.omp/agent/extensions/omp-green-gh.ts
```

User-level extensions are auto-discovered from `~/.omp/agent/extensions/` (`.ts`/`.js`, symlinks
included). Requires `gh` on `PATH` and authenticated (`gh auth status`).

Turn it off without uninstalling, in `~/.omp/agent/config.yml`:

```yaml
disabledExtensions:
  - extension-module:omp-green-gh
```

## Develop

```bash
bun test
bun run typecheck
bun run lint
```

`src/pr-status.ts` is the whole thing: the `gh` calls plus four pure, tested functions — the check
fold, the verdict, the blocker ladder and the rendering. `src/main.ts` is only the wiring into
`ctx.ui.setStatus`.
