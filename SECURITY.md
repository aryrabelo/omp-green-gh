# Security Policy

## Reporting a vulnerability

If you find a security issue in omp-green-gh, please report it privately rather than
opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/aryrabelo/omp-green-gh/security/advisories/new)
  for this repository, or
- Email the maintainer at **aryrabelo@gmail.com** with the details.

Please include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the version or commit you tested.

You can expect an initial response within a few days. Once a fix is available,
we'll coordinate disclosure with you.

## Scope

omp-green-gh is an OMP (Oh My Pi) harness extension written in TypeScript and run on
Bun. It runs inside your OMP session on your local machine, renders two statusline
lines, and registers two slash commands. The relevant security surface is:

- **Five read-only subprocesses for the statusline** — `git branch --show-current`,
  `git remote get-url origin`, `gh pr view <branch> --repo <origin> --json …`,
  `gh api graphql`, and `gh pr list --repo <origin> --state open --limit 20 --json …`.
  The branch name and the `origin` url are passed as separate argv entries to those
  processes, never through a shell.
- **One subprocess with a side effect, only when you run `/gh-open`** —
  `gh pr view --web`, or `gh pr view <number> --web`. Unlike the five above it is not
  read-only in the local sense: `--web` makes `gh` open your default browser at the
  pull request url. It runs only on that command, never on a redraw. The argument is
  validated as digits (`7` or `#7`) before anything is spawned; anything else is
  refused with a notification and no subprocess. No other commands are spawned.
- **`/green` executes nothing** — it sends a prompt into your session asking the agent
  to inspect and fix the current branch's pull request (the prompt tells it not to
  merge and not to force-push). Whatever the agent then runs is the agent's own tool
  use, under your usual approvals, not this extension's.
- **No credentials** — the extension holds none of its own and never sees a token;
  `gh` owns authentication.
- **No writes, no config, no LLM tools** — it writes no files, keeps no configuration
  file, and registers no tools the agent can call.
- **No direct network call** — every GitHub read goes through `gh`.
- **Untrusted remote text rendered to your terminal** — the pull request urls, numbers
  and check names come from GitHub, and the `owner/repo` label on the second line is
  parsed from your `origin` remote. The rendered lines are terminal output built from
  that data. Check names are prefix-normalized (`ci/circleci: unit` -> `unit`). The
  ANSI colors and the OSC 8 hyperlink are emitted by the extension itself, not passed
  through from GitHub.

The extension collects **no telemetry**.

## Dependency advisories

The extension has **zero runtime dependencies** — see `package.json`: only `devDependencies`
and `peerDependencies` exist, and nothing is bundled or redistributed. It ships the
TypeScript in `src/` and nothing else.

CI runs `bun audit` as an advisory (`continue-on-error`) job, so a red audit does not block
a merge. As of `v0.1.0` it reports two high advisories, both reachable only through the
development-time harness package:

- `adm-zip` via `@oh-my-pi/pi-coding-agent > @oh-my-pi/pi-mnemopi > onnxruntime-node`
- `sharp` via `@oh-my-pi/pi-coding-agent > @huggingface/transformers`

Neither is in any path this extension executes or distributes, and neither can be fixed
from this repository — the harness owns those trees. They are listed here rather than
silenced so the audit output is not mistaken for a clean bill of health.

## Supported versions

The latest release is `0.2.0`. Security fixes target the latest release and
`main`. Older versions are not maintained.
