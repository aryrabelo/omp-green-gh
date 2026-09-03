# Contributing

Thanks for your interest in improving omp-green-gh.

## Prerequisites

- [Bun](https://bun.sh) (>= 1.0.0).
- [`gh`](https://cli.github.com) on your `PATH` and authenticated (`gh auth status`) —
  the extension shells out to it for every PR lookup.

## Setup

```sh
bun install
```

## Verify

Run the full gate before opening a pull request:

```sh
bun run lint && bun run typecheck && bun test
```

`bun run format` applies the Biome formatter/auto-fixes; CI runs `bun run lint`,
`bun run typecheck`, and `bun test` on every push and pull request.

## Conventions

- TypeScript runs in strict mode — keep it type-clean (`bun run typecheck` must pass).
- Keep the pure functions in `src/pr-status.ts` (the check fold, the verdict, the
  blocker ladder, the rendering, the rotation, the `origin` parse) free of OMP host
  imports so they stay unit-testable; all OMP wiring — the session events and the
  `/gh-open` and `/green` commands — lives in `src/main.ts`.
- New pure logic ships with a test in `tests/`.
- A test must be able to fail for the reason its name claims. Before you commit one,
  ask what you would break to make it go red — if the answer is "nothing", the test
  is not defending anything.
- Style is enforced by [Biome](https://biomejs.dev) (`biome.json`) — it is the single
  source of truth for style; run `bun run format` before committing.
- Use [Conventional Commits](https://www.conventionalcommits.org/) in English.

## Dev install

Clone the repo and symlink the entry point into your OMP user extensions directory:

```sh
ln -s "$PWD/src/main.ts" ~/.omp/agent/extensions/omp-green-gh.ts
```

Restart your OMP session afterwards — extensions are discovered at boot.

## Code of Conduct

Be respectful and constructive. Assume good faith, keep discussion focused on the
work, and welcome newcomers. Harassment or personal attacks are not tolerated. To
report a concern, email the maintainer at **aryrabelo@gmail.com**.
