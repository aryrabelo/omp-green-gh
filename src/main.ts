/**
 * @aryrabelo/omp-green-gh — the repository's pull requests, in the OMP statusline.
 *
 * The PR block of the Claude Code CNX statusline (aryrabelo/cnx-claude,
 * `cnx/statusline/statusline.ts` + `cnx/scripts/lib/pr-status.ts`), cut down to what works in any
 * repository: no hardcoded owner, no CI check groups, no Linear/Jira, no label squares.
 *
 * Two lines: the current branch's PR, and one of the repository's other open PRs — a different
 * one on every redraw, so a long session cycles through all of them.
 *
 * ponytail: no refresh timer — the segments are rewritten at session start and at the end of
 * every turn, and `prLines` caches, so an idle session spends no subprocesses.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prLines } from "./pr-status";

/** Statusline segments are ordered by key; both PR lines sit together. */
const CURRENT_KEY = "gh-pr";
const OTHERS_KEY = "gh-pr-others";

/** Redraws so far. Feeds `prLines` as `tick`, which is what steps the second line to the next PR. */
let redraws = 0;

/** The loader `render` reads from — a parameter only so a test can watch the `tick` it receives. */
export type PrLinesLoader = typeof prLines;

export async function render(
	ctx: ExtensionContext,
	load: PrLinesLoader = prLines,
): Promise<void> {
	// Headless/print/subagent runs have no status line at all.
	if (!ctx.hasUI) return;
	const tick = redraws++;
	try {
		const { current, others } = await load(ctx.cwd, { tick });
		// `undefined` is what clears a segment — "" leaves an empty one on the line.
		ctx.ui.setStatus(CURRENT_KEY, current);
		ctx.ui.setStatus(OTHERS_KEY, others);
	} catch {
		// A statusline hiccup is not worth killing a session over.
	}
}

/**
 * `gh pr view` arguments for a `/gh-open` argument: nothing means the current branch's PR, `7`
 * and `#7` both mean PR 7. Anything else is undefined — it must never reach a subprocess.
 */
function ghOpenArgs(argument: string): string[] | undefined {
	const trimmed = argument.trim();
	if (trimmed === "") return ["pr", "view", "--web"];
	const number = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
	if (!/^\d+$/.test(number)) return undefined;
	return ["pr", "view", number, "--web"];
}

/** What `/green` hands the agent. Concrete enough that the agent does not have to guess. */
const GREEN_PROMPT = `Get the current branch's pull request green.

1. Inspect it with \`gh\`: its failing checks (and their logs), its unresolved review threads including the body of every review comment, whether the branch is behind its base branch, and any merge conflict.
2. Fix what is fixable in the working tree: the failing tests and lint, and the review comments you agree with. Update the branch from its base when it is behind or conflicted.
3. Report what you changed, and what you left alone and why.

Do not merge the pull request and do not force-push.`;

export default function greenGhExtension(pi: ExtensionAPI): void {
	pi.setLabel("PR status of the current branch");
	pi.on("session_start", (_event, ctx) => {
		void render(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		void render(ctx);
	});
	pi.registerCommand("gh-open", {
		description:
			"Open a pull request in the browser — no argument: the current branch's, or a PR number",
		handler: async (args, ctx) => {
			const argv = ghOpenArgs(args);
			if (!argv) {
				ctx.ui.notify(
					`/gh-open: "${args.trim()}" is not a PR number — pass 7, #7, or no argument.`,
					"error",
				);
				return;
			}
			try {
				const { code, stderr } = await pi.exec("gh", argv, { cwd: ctx.cwd });
				if (code !== 0) {
					ctx.ui.notify(
						`/gh-open: gh exited ${code}${stderr.trim() ? ` — ${stderr.trim()}` : ""}`,
						"error",
					);
				}
			} catch (error) {
				// A failed command must not escape a slash command handler.
				ctx.ui.notify(
					`/gh-open: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
	pi.registerCommand("green", {
		description:
			"Ask the agent to inspect the current branch's pull request and fix what blocks it",
		handler: async () => {
			pi.sendUserMessage(GREEN_PROMPT);
		},
	});
}
