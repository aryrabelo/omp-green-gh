/**
 * PR status for the current branch, read from `gh`. Repo-agnostic: owner/name always come from
 * the `origin` remote, never from configuration.
 *
 * Port of cnx-claude `cnx/scripts/lib/pr-status.ts` plus the `getNextAction` ladder of
 * `cnx/statusline/statusline.ts`, with everything installation-specific dropped: the hardcoded
 * `entrc/entrc-backend`, the CircleCI check groups, the `preview-app`/`canix-UAT` label squares,
 * the Linear/Jira gates and the `/cnx:` command suffixes.
 *
 * Three cheap subprocesses behind one 60s cache:
 *   1. `git branch --show-current` + `git remote get-url origin` — which branch, which repo.
 *   2. `gh pr view <branch> --repo <origin>` — is there a PR, and its url.
 *   3. `gh api graphql` on that url — unresolved review threads, which `gh pr view` cannot
 *      report at all, plus reviewers and the check rollup in the same round trip.
 */

/** How long an answer is reused before asking `gh` again. */
const TTL_MS = 60_000;
/** Each subprocess is capped, so a hung `gh` cannot stall a redraw. */
const CMD_TIMEOUT_MS = 8_000;

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

export interface CheckInfo {
	name: string;
	/** COMPLETED, IN_PROGRESS, QUEUED */
	status: string;
	/** SUCCESS, FAILURE, NEUTRAL, SKIPPED, TIMED_OUT, … */
	conclusion: string;
}

export interface CheckCounts {
	pass: number;
	fail: number;
	pending: number;
	total: number;
}

export interface PrStatus {
	number: number;
	url: string;
	/** OPEN, MERGED, CLOSED */
	state: string;
	isDraft: boolean;
	/** MERGEABLE, CONFLICTING, UNKNOWN */
	mergeable: string;
	/** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, "" */
	reviewDecision: string;
	unresolvedComments: number;
	humanReviewers: number;
	checks: CheckInfo[];
}

/**
 * Drop the provider prefix CI systems put in front of a job name, so the check reads the same
 * whatever runs it: `ci/circleci: unit_tests` and `some-app/unit_tests` both become `unit_tests`.
 */
export function normalizeCheckName(name: string): string {
	return name.replace(/^[\w.-]+\/[\w.-]*:\s*/, "").replace(/^[\w.-]+\//, "");
}

/**
 * Fold checks into pass/fail/pending, with the CNX precedence: a failure outranks anything still
 * running, and anything not COMPLETED counts as pending — so a green verdict can never be shown
 * while CI is in flight.
 */
export function countChecks(checks: CheckInfo[]): CheckCounts {
	const counts: CheckCounts = {
		pass: 0,
		fail: 0,
		pending: 0,
		total: checks.length,
	};
	for (const check of checks) {
		const verdict = check.conclusion.toUpperCase();
		const done = check.status.toUpperCase() === "COMPLETED";
		if (
			verdict === "FAILURE" ||
			verdict === "ERROR" ||
			verdict === "TIMED_OUT"
		) {
			counts.fail++;
		} else if (!done || verdict === "" || verdict === "PENDING") {
			counts.pending++;
		} else {
			counts.pass++;
		}
	}
	return counts;
}

/** CNX's group verdict, over every check: ❌ beats ⌛ beats ✅; "" when there are no checks. */
export function checksEmoji(counts: CheckCounts): string {
	if (counts.total === 0) return "";
	if (counts.fail > 0) return "❌";
	if (counts.pending > 0) return "⌛";
	return "✅";
}

/**
 * What to do now, in blocker order. Generic port of CNX `getNextAction`: same ladder, minus the
 * Linear and label gates and the `/cnx:` command suffixes.
 */
export function nextAction(pr: PrStatus): string {
	if (pr.state !== "OPEN") return "";
	const emoji = checksEmoji(countChecks(pr.checks));

	if (emoji === "❌") return "Corrigir CI";
	if (pr.mergeable === "CONFLICTING") return "Resolver conflitos com a base";
	if (pr.isDraft) return "Publicar draft";
	if (pr.unresolvedComments > 0) {
		const n = pr.unresolvedComments;
		return `Resolver ${n} review comment${n > 1 ? "s" : ""}`;
	}
	if (pr.humanReviewers === 0) return "Setar reviewers";
	if (pr.reviewDecision === "CHANGES_REQUESTED")
		return "Ajustar changes requested";
	if (pr.reviewDecision !== "APPROVED") return "Aguardar aprovação";
	if (emoji === "⌛") return "CI rodando...";
	return "Merge PR";
}

/**
 * The widget rows: status on the first, the next action on the second.
 *
 * `PR #64 ✅ 12/12 · approved · 💬 2`
 * `→ Resolver 2 review comments`
 */
export function renderStatus(pr: PrStatus | undefined): string[] {
	if (!pr) return [];
	// OSC8 hyperlink, so `#64` is clickable in terminals that support it.
	const label = pr.url
		? `\x1b]8;;${pr.url}\x1b\\${CYAN}#${pr.number}${RESET}\x1b]8;;\x1b\\`
		: `#${pr.number}`;
	const head = `PR ${label}`;

	if (pr.state === "MERGED") return [`${head} ${GREEN}merged${RESET}`];
	if (pr.state === "CLOSED") return [`${head} ${RED}closed${RESET}`];

	const counts = countChecks(pr.checks);
	const emoji = checksEmoji(counts);
	const parts: string[] = [];
	if (pr.isDraft) parts.push(`${DIM}draft${RESET}`);
	if (emoji === "") {
		parts.push(`${DIM}no checks${RESET}`);
	} else {
		// The number worth reading is the one that explains the emoji.
		const shown =
			counts.fail > 0
				? counts.fail
				: counts.pending > 0
					? counts.pending
					: counts.pass;
		const color = counts.fail > 0 ? RED : counts.pending > 0 ? YELLOW : GREEN;
		parts.push(`${emoji} ${color}${shown}/${counts.total}${RESET}`);
	}
	if (pr.reviewDecision === "APPROVED") parts.push(`${GREEN}approved${RESET}`);
	if (pr.reviewDecision === "CHANGES_REQUESTED")
		parts.push(`${RED}changes requested${RESET}`);
	if (pr.reviewDecision === "REVIEW_REQUIRED")
		parts.push(`${DIM}review required${RESET}`);
	if (pr.unresolvedComments > 0)
		parts.push(`${YELLOW}💬 ${pr.unresolvedComments}${RESET}`);
	if (pr.mergeable === "CONFLICTING") parts.push(`${RED}conflicts${RESET}`);

	const rows = [`${head} ${parts.join(` ${DIM}·${RESET} `)}`];
	const action = nextAction(pr);
	if (action) rows.push(`${DIM}→ ${action}${RESET}`);
	return rows;
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

interface PrView {
	number?: number;
	url?: string;
	state?: string;
	isDraft?: boolean;
	mergeable?: string;
	reviewDecision?: string;
}

/** GraphQL node of `statusCheckRollup.contexts`: a check run, or a legacy commit status. */
interface RollupNode {
	__typename?: string;
	name?: string;
	status?: string;
	conclusion?: string;
	context?: string;
	state?: string;
}

/**
 * Same shape as the CNX query, addressed by PR url instead of a hardcoded `repository(owner:,
 * name:)` — that is what makes it work in any repo without knowing its owner.
 */
const GRAPHQL = `query($url: URI!) { resource(url: $url) { ... on PullRequest {
  reviewThreads(last: 100) { nodes { isResolved } }
  reviews(last: 20) { nodes { author { login } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion }
    ... on StatusContext { context state }
  } } } } } }
} } }`;

/** Flatten a rollup node: commit statuses carry only `state`, check runs carry status+conclusion. */
export function toCheckInfo(node: RollupNode): CheckInfo {
	if (node.__typename === "CheckRun") {
		return {
			name: normalizeCheckName(node.name ?? ""),
			status: node.status ?? "",
			conclusion: node.conclusion ?? "",
		};
	}
	const state = node.state ?? "";
	const settled =
		state === "SUCCESS" || state === "FAILURE" || state === "ERROR";
	return {
		name: normalizeCheckName(node.context ?? ""),
		status: settled ? "COMPLETED" : "IN_PROGRESS",
		conclusion: settled ? state : "",
	};
}

type PrDetail = Pick<
	PrStatus,
	"unresolvedComments" | "humanReviewers" | "checks"
>;

/** Second round trip: the parts `gh pr view --json` cannot answer. Degrades to zeroes. */
async function fetchDetail(url: string, cwd: string): Promise<PrDetail> {
	const empty: PrDetail = {
		unresolvedComments: 0,
		humanReviewers: 0,
		checks: [],
	};
	const out = await run(
		["gh", "api", "graphql", "-f", `query=${GRAPHQL}`, "-F", `url=${url}`],
		cwd,
	);
	if (!out) return empty;
	try {
		// Trusted shape: GitHub's own GraphQL contract.
		const pr = JSON.parse(out)?.data?.resource;
		if (!pr) return empty;
		const threads: Array<{ isResolved?: boolean }> =
			pr.reviewThreads?.nodes ?? [];
		const reviewers = new Set<string>();
		for (const review of (pr.reviews?.nodes ?? []) as Array<{
			author?: { login?: string };
		}>) {
			const login = review.author?.login;
			// A bot review does not mean somebody is looking at this.
			if (login && !login.includes("bot")) reviewers.add(login);
		}
		const nodes: RollupNode[] =
			pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
		return {
			unresolvedComments: threads.filter((t) => !t.isResolved).length,
			humanReviewers: reviewers.size,
			checks: nodes.map(toCheckInfo),
		};
	} catch {
		return empty;
	}
}

async function load(cwd: string): Promise<string[]> {
	const branch = await run(["git", "branch", "--show-current"], cwd);
	if (!branch || TRUNK[branch]) return [];

	// The repo is whatever `origin` points at — never configured, never guessed from the path.
	const origin = await run(["git", "remote", "get-url", "origin"], cwd);
	if (!origin) return [];

	const fields = "number,url,state,isDraft,mergeable,reviewDecision";
	const out = await run(
		["gh", "pr", "view", branch, "--repo", origin, "--json", fields],
		cwd,
	);
	if (!out) return [];
	let view: PrView;
	try {
		// Trusted shape: `gh`'s own --json contract.
		view = JSON.parse(out) as PrView;
	} catch {
		return [];
	}
	if (!view.number) return [];

	const base: PrStatus = {
		number: view.number,
		url: view.url ?? "",
		state: (view.state ?? "OPEN").toUpperCase(),
		isDraft: view.isDraft ?? false,
		mergeable: view.mergeable ?? "UNKNOWN",
		reviewDecision: view.reviewDecision ?? "",
		unresolvedComments: 0,
		humanReviewers: 0,
		checks: [],
	};
	// A merged/closed PR renders as one word — no point paying for the detail query.
	if (base.state !== "OPEN") return renderStatus(base);
	return renderStatus({ ...base, ...(await fetchDetail(base.url, cwd)) });
}

/** cwd -> last answer, so a redraw between turns costs nothing. */
const cache = new Map<string, { at: number; rows: string[] }>();

/**
 * The widget rows for `cwd`'s branch, empty when there is nothing to show (not a repo, on trunk,
 * no `origin`, no PR, no `gh`). Cached for a minute per directory.
 */
export async function prRows(cwd: string, now = Date.now()): Promise<string[]> {
	const hit = cache.get(cwd);
	if (hit && now - hit.at < TTL_MS) return hit.rows;

	const rows = await load(cwd);
	cache.set(cwd, { at: now, rows });
	return rows;
}
