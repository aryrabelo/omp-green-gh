/**
 * @aryrabelo/omp-green-gh — the current branch's pull request status, under the editor.
 *
 * The PR block of the Claude Code CNX statusline (aryrabelo/cnx-claude,
 * `cnx/statusline/statusline.ts` + `cnx/scripts/lib/pr-status.ts`), cut down to what works in
 * any repository: no hardcoded owner, no CI check groups, no Linear/Jira, no label squares.
 *
 * ponytail: no refresh timer — the widget is redrawn at session start and at the end of every
 * turn, and `prRows` caches for 60s, so an idle session spends no subprocesses.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prRows } from "./pr-status";

const KEY = "green-gh";

async function render(ctx: ExtensionContext): Promise<void> {
	try {
		const rows = await prRows(process.cwd());
		ctx.ui.setWidget(KEY, rows.length > 0 ? rows : undefined, {
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
