# omp-green-gh

OMP harness extension. One line under the editor: **is the current branch's pull request green?**

```
PR #64 ✓ 12/12 · approved
PR #64 ● 3/12
PR #64 ✗ 2/12 · changes requested · conflicts
PR #64 draft · no checks
```

`#64` is an OSC8 hyperlink to the PR.

Descendant of the Claude Code `statusline.ts` PR block (dotfiles-2025, `dot_claude/statusline.ts`),
which only showed the PR number. This one answers the part that mattered: the status.

## Behaviour

- Reads `git branch --show-current`, then `gh pr view <branch> --json …`. No GitHub token of its
  own — `gh` owns auth.
- Silent when there is nothing to say: not a git repo, on `main`/`master`/`trunk`/`develop`, no PR
  for the branch, `gh` missing or unauthenticated.
- A check that is still running counts as pending, never as a pass — the line cannot claim green
  while CI is in flight.
- Redrawn at session start and after every turn; each answer is cached 60s per directory, and every
  subprocess is capped at 5s. An idle session costs nothing.

## Install

```bash
bun install
omp ext add /Users/aryrabelo/Sites/personal-team/omp-green-gh   # or symlink into ~/.omp/agent/extensions
```

Requires `gh` on `PATH` and authenticated (`gh auth status`).

## Develop

```bash
bun test
bun run typecheck
bun run lint
```

`src/pr-status.ts` holds the whole thing: the `gh` call, the rollup fold and the rendering.
`src/main.ts` is only the wiring into `ctx.ui.setWidget`.
