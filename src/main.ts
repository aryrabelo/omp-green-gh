/**
 * @aryrabelo/omp-green-gh — the current branch's pull request status, under the editor.
 *
 * Descendant of the Claude Code `statusline.ts` PR block (dotfiles-2025 `dot_claude/statusline.ts`),
 * which only showed `PR #64`. This one answers the question that actually mattered: is it green.
 *
 * ponytail: no refresh timer — the widget is redrawn at session start and at the end of every
 * turn, and `prLine` caches for 60s, so an idle session spends no subprocesses.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prLine } from "./pr-status";

const KEY = "green-gh";

async function render(ctx: ExtensionContext): Promise<void> {
	try {
		const line = await prLine(process.cwd());
		ctx.ui.setWidget(KEY, line ? [line] : undefined, {
			placement: "belowEditor",
		});
	} catch {
		// A status widget hiccup is not worth killing a session over.
	}
}

export default function greenGhExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		void render(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		void render(ctx);
	});
}
