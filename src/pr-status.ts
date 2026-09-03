/**
 * PR status for the current branch, read straight from `gh`.
 *
 * ponytail: shell out to `gh pr view` instead of talking to the GitHub API — `gh` already owns
 * auth, host resolution and the branch -> PR lookup, so there is nothing to reimplement.
 */

/** How long a `gh` answer is reused before asking again. */
const TTL_MS = 60_000;
/** `gh`/`git` are allowed this long before the widget gives up for this round. */
const CMD_TIMEOUT_MS = 5_000;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Branches that never have "their own" PR — `gh pr view` there answers with a merged one. */
const TRUNK: Record<string, true> = {
	main: true,
	master: true,
	trunk: true,
	develop: true,
};

/** One entry of `statusCheckRollup`: a check run, or a legacy commit status. */
export interface CheckNode {
	__typename?: string;
	status?: string;
	conclusion?: string;
	state?: string;
}

export interface CheckCounts {
	pass: number;
	fail: number;
	pending: number;
	total: number;
}

export interface PrView {
	number?: number;
	url?: string;
	state?: string;
	isDraft?: boolean;
	mergeable?: string;
	reviewDecision?: string;
	statusCheckRollup?: CheckNode[] | null;
}

/**
 * Fold a rollup into pass/fail/pending counts.
 *
 * Check runs report `status` (QUEUED/IN_PROGRESS/COMPLETED) plus a `conclusion`; commit statuses
 * report only `state`. Anything not yet conclusive counts as pending, so a green line can never
 * be shown while work is still running.
 */
export function countChecks(
	nodes: CheckNode[] | null | undefined,
): CheckCounts {
	const counts: CheckCounts = { pass: 0, fail: 0, pending: 0, total: 0 };
	for (const node of nodes ?? []) {
		counts.total++;
		const verdict = (node.conclusion || node.state || "").toUpperCase();
		const running =
			node.status !== undefined && node.status.toUpperCase() !== "COMPLETED";
		if (
			running ||
			verdict === "" ||
			verdict === "PENDING" ||
			verdict === "EXPECTED"
		) {
			counts.pending++;
		} else if (
			verdict === "SUCCESS" ||
			verdict === "NEUTRAL" ||
			verdict === "SKIPPED"
		) {
			counts.pass++;
		} else {
			// FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE, ERROR
			counts.fail++;
		}
	}
	return counts;
}

/** `✓ 12/12` style check summary, worst news first. */
function checksPart(c: CheckCounts): string {
	if (c.total === 0) return `${DIM}no checks${RESET}`;
	if (c.fail > 0) return `${RED}✗ ${c.fail}/${c.total}${RESET}`;
	if (c.pending > 0) return `${YELLOW}● ${c.pending}/${c.total}${RESET}`;
	return `${GREEN}✓ ${c.pass}/${c.total}${RESET}`;
}

/** Short review verdict, or "" when nobody has been asked yet. */
function reviewPart(decision: string | undefined): string {
	switch (decision) {
		case "APPROVED":
			return `${GREEN}approved${RESET}`;
		case "CHANGES_REQUESTED":
			return `${RED}changes requested${RESET}`;
		case "REVIEW_REQUIRED":
			return `${DIM}review required${RESET}`;
		default:
			return "";
	}
}

/**
 * `PR #64 ✓ 12/12 · approved · conflicts` — one line, or undefined when there is no PR.
 * Exported for tests: rendering is the part worth pinning down.
 */
export function renderPr(pr: PrView | undefined): string | undefined {
	if (!pr?.number) return undefined;
	// OSC8 hyperlink, so `#64` is clickable in terminals that support it.
	const label = pr.url
		? `\x1b]8;;${pr.url}\x1b\\${CYAN}#${pr.number}${RESET}\x1b]8;;\x1b\\`
		: `#${pr.number}`;
	const head = `PR ${label}`;

	const state = (pr.state || "OPEN").toUpperCase();
	if (state === "MERGED") return `${head} ${GREEN}merged${RESET}`;
	if (state === "CLOSED") return `${head} ${RED}closed${RESET}`;

	const parts = [checksPart(countChecks(pr.statusCheckRollup))];
	if (pr.isDraft) parts.unshift(`${DIM}draft${RESET}`);
	const review = reviewPart(pr.reviewDecision);
	if (review) parts.push(review);
	if (pr.mergeable === "CONFLICTING") parts.push(`${RED}conflicts${RESET}`);
	return `${head} ${parts.join(` ${DIM}·${RESET} `)}`;
}

/** Run a command, returning its stdout, or "" for any failure (missing binary, non-zero, hang). */
async function run(cmd: string[], cwd: string): Promise<string> {
	try {
		const proc = Bun.spawn(cmd, {
			cwd,
			stdout: "pipe",
			stderr: "ignore",
			signal: AbortSignal.timeout(CMD_TIMEOUT_MS),
		});
		const stdout = await new Response(proc.stdout).text();
		return (await proc.exited) === 0 ? stdout.trim() : "";
	} catch {
		return "";
	}
}

const JSON_FIELDS =
	"number,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup";

/** cwd -> last answer, so a redraw between turns costs nothing. */
const cache = new Map<string, { at: number; line?: string }>();

/**
 * The status line for `cwd`'s branch, or undefined when there is nothing to show (not a repo,
 * on trunk, no PR, no `gh`). Cached for a minute per directory.
 */
export async function prLine(
	cwd: string,
	now = Date.now(),
): Promise<string | undefined> {
	const hit = cache.get(cwd);
	if (hit && now - hit.at < TTL_MS) return hit.line;

	const branch = await run(["git", "branch", "--show-current"], cwd);
	let line: string | undefined;
	if (branch && !TRUNK[branch]) {
		const out = await run(
			["gh", "pr", "view", branch, "--json", JSON_FIELDS],
			cwd,
		);
		try {
			// Trusted shape: this is `gh`'s own --json contract.
			line = out ? renderPr(JSON.parse(out) as PrView) : undefined;
		} catch {
			line = undefined;
		}
	}
	cache.set(cwd, { at: now, line });
	return line;
}
