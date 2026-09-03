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
Bun. It runs inside your OMP session on your local machine and renders one statusline
segment. The relevant security surface is:

- **Four read-only subprocesses** — `git branch --show-current`,
  `git remote get-url origin`, `gh pr view`, and `gh api graphql`. No other commands
  are spawned. The branch name and the `origin` url are passed as separate argv
  entries to those processes, never through a shell.
- **No credentials** — the extension holds none of its own and never sees a token;
  `gh` owns authentication.
- **No writes, no config, no LLM tools** — it writes no files, keeps no configuration
  file, and registers no tools the agent can call.
- **No direct network call** — every GitHub read goes through `gh`.
- **Untrusted remote text rendered to your terminal** — the PR url and the check names
  come from GitHub. The rendered segment is terminal output built from remote data.
  Check names are prefix-normalized (`ci/circleci: unit` -> `unit`). The ANSI colors
  and the OSC 8 hyperlink are emitted by the extension itself, not passed through from
  GitHub.

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

The latest release is `0.1.0`. Security fixes target the latest release and
`main`. Older versions are not maintained.
