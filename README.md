# omp-green-gh

OMP harness extension. Two lines under the editor: **is the current branch's pull request green,
and what is blocking it?**

```
PR #64 ✅ 12/12 · approved
→ Merge PR

PR #64 ⌛ 3/12 · review required · 💬 2
→ Resolver 2 review comments

PR #64 draft · ❌ 2/12 · conflicts
→ Corrigir CI
```

`#64` is an OSC8 hyperlink to the PR.

## Origin

Port of the PR block of the CNX Claude Code statusline
([aryrabelo/cnx-claude](https://github.com/aryrabelo/cnx-claude)): `cnx/scripts/lib/pr-status.ts`
for the data and the `getNextAction` ladder of `cnx/statusline/statusline.ts` for the second line.

Everything installation-specific was cut, so this runs in any repository:

| CNX | here |
|---|---|
| hardcoded `entrc/entrc-backend` | owner/repo from the `origin` remote |
| `CI_MAIN_CHECKS` / `CI_E2E_CHECKS` / `CI_DEPLOY_PREVIEW_CHECKS` name lists | every check, one verdict |
| `preview-app` / `canix-UAT` label squares | dropped |
| Linear + Jira gates, `/cnx:` command suffixes | dropped |
| statusline stdin protocol, `/tmp` cache files | OMP widget, in-process cache |

Kept because it is generic and load-bearing: the ❌ > ⌛ > ✅ precedence (a failure outranks
anything still running, so the line cannot claim green while CI is in flight), the CircleCI-style
check-name normalization, and unresolved review threads — which `gh pr view` cannot report, so it
takes the GraphQL query CNX already had.

## Behaviour

- `git branch --show-current` + `git remote get-url origin`, then `gh pr view <branch> --repo
  <origin>`, then one `gh api graphql` on the PR url for review threads, reviewers and checks.
  No token of its own — `gh` owns auth.
- Silent when there is nothing to say: not a git repo, on `main`/`master`/`trunk`/`develop`, no
  `origin`, no PR for the branch, `gh` missing or unauthenticated.
- Merged/closed PRs collapse to one word and skip the detail query.
- Redrawn at session start and after every turn; cached 60s per directory, every subprocess capped
  at 8s. An idle session costs nothing.

## Install

```bash
bun install
ln -s "$PWD" ~/.omp/agent/extensions/omp-green-gh
```

Requires `gh` on `PATH` and authenticated (`gh auth status`).

## Develop

```bash
bun test
bun run typecheck
bun run lint
```

`src/pr-status.ts` is the whole thing: the `gh` calls, the check fold, the blocker ladder and the
rendering (all four pure and tested). `src/main.ts` is only the wiring into `ctx.ui.setWidget`.
