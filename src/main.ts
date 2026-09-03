/**
 * @aryrabelo/omp-green-gh — the current branch's pull request status, in the OMP statusline.
 *
 * The PR block of the Claude Code CNX statusline (aryrabelo/cnx-claude,
 * `cnx/statusline/statusline.ts` + `cnx/scripts/lib/pr-status.ts`), cut down to what works in any
 * repository: no hardcoded owner, no CI check groups, no Linear/Jira, no label squares.
 *
 * ponytail: no refresh timer — the segment is rewritten at session start and at the end of every
 * turn, and `prLine` caches for 60s, so an idle session spends no subprocesses.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prLine } from "./pr-status";

/** Statusline segments are ordered by key; `z-` keeps the PR at the end of the line. */
const KEY = "z-pr";

async function render(ctx: ExtensionContext): Promise<void> {
	// Headless/print/subagent runs have no status line at all.
	if (!ctx.hasUI) return;
	try {
		// "" clears the segment, so a branch without a PR leaves nothing behind.
		ctx.ui.setStatus(KEY, (await prLine(ctx.cwd)) ?? "");
	} catch {
		// A statusline hiccup is not worth killing a session over.
	}
}

export default function greenGhExtension(pi: ExtensionAPI): void {
	pi.setLabel("PR status of the current branch");
	pi.on("session_start", (_event, ctx) => {
		void render(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		void render(ctx);
	});
}
