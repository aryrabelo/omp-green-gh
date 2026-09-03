/**
 * PR status for the current branch, read from `gh`. Repo-agnostic: owner/name always come from
 * the `origin` remote, never from configuration.
 *
 * Port of cnx-claude `cnx/scripts/lib/pr-status.ts` plus the `getNextAction` ladder of
 * `cnx/statusline/statusline.ts`, with everything installation-specific dropped: the hardcoded
 * `entrc/entrc-backend`, the CircleCI check groups, the `preview-app`/`canix-UAT` label squares,
 * the Linear/Jira gates and the `/cnx:` command suffixes.
 *
 * Five cheap subprocesses behind one 60s cache:
 *   1. `git branch --show-current` and `git remote get-url origin` — which branch, which repo.
 *   2. `gh pr view <branch> --repo <origin>` — is there a PR, and its url.
 *   3. `gh api graphql` on that url — unresolved review threads, which `gh pr view` cannot
 *      report at all, plus reviewers and the check rollup in the same round trip.
 *   4. `gh pr list --repo <origin>` — the repo's other open PRs, for the second line, in one
 *      round trip for all of them.
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
export function nextAction(pr: PrStatus, reviewersUnknown = false): string {
	if (pr.state !== "OPEN") return "";
	const emoji = checksEmoji(countChecks(pr.checks));

	if (emoji === "❌") return "Fix CI";
	if (pr.mergeable === "CONFLICTING") return "Resolve conflicts with base";
	if (pr.isDraft) return "Publish draft";
	if (pr.unresolvedComments > 0) {
		const n = pr.unresolvedComments;
		return `Resolve ${n} review comment${n > 1 ? "s" : ""}`;
	}
	// Never claim "Set reviewers" off a reviewer count we did not fetch.
	if (!reviewersUnknown && pr.humanReviewers === 0) return "Set reviewers";
	if (pr.reviewDecision === "CHANGES_REQUESTED")
		return "Address changes requested";
	if (pr.reviewDecision !== "APPROVED") return "Waiting for approval";
	if (emoji === "⌛") return "CI running";
	return "Merge PR";
}

/**
 * The statusline segment: `PR #64 ✅ 12/12 · approved → Merge PR`, or undefined when there is no
 * PR. One line on purpose — `ctx.ui.setStatus` sanitizes newlines and truncates to the terminal
 * width, so the next action rides inline after the arrow.
 */
export function renderStatus(
	pr: PrStatus | undefined,
	opts: { label?: string; reviewersUnknown?: boolean } = {},
): string | undefined {
	if (!pr) return undefined;
	// OSC8 hyperlink, so `#64` is clickable in terminals that support it.
	const text = opts.label ?? `#${pr.number}`;
	const label = pr.url
		? `\x1b]8;;${pr.url}\x1b\\${CYAN}${text}${RESET}\x1b]8;;\x1b\\`
		: text;
	const head = opts.label ? label : `PR ${label}`;

	if (pr.state === "MERGED") return `${head} ${GREEN}merged${RESET}`;
	if (pr.state === "CLOSED") return `${head} ${RED}closed${RESET}`;

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

	const line = `${head} ${parts.join(` ${DIM}·${RESET} `)}`;
	const action = nextAction(pr, opts.reviewersUnknown);
	return action ? `${line} ${DIM}→ ${action}${RESET}` : line;
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

/** `git@github.com:o/r.git` | `https://github.com/o/r.git` | `https://github.com/o/r` -> `o/r` */
export function repoSlug(originUrl: string): string | undefined {
	const m = originUrl
		.trim()
		.match(
			/^(?:git@|ssh:\/\/git@|https?:\/\/)[^/:]+[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/,
		);
	return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Deterministic rotation: which item a redraw shows. Empty list -> undefined. */
export function pickCycle<T>(items: T[], tick: number): T | undefined {
	if (items.length === 0) return undefined;
	// The double modulo keeps a negative tick in range instead of reading off the front.
	return items[((tick % items.length) + items.length) % items.length];
}

/** A `gh pr list --json` row: `statusCheckRollup` is a flat array, not the GraphQL nesting. */
interface PrListItem extends PrView {
	statusCheckRollup?: RollupNode[];
}

const LIST_FIELDS =
	"number,url,isDraft,mergeable,reviewDecision,statusCheckRollup";

/**
 * The repo's other open PRs, pre-rendered with their `(i/n)` position so a redraw only has to
 * pick one. One subprocess for all of them: `gh pr list` can answer neither unresolved threads
 * nor reviewers, and a GraphQL round trip per PR would cost 20 subprocesses for those two
 * numbers. Sorted by number descending, so the rotation order is stable between redraws.
 */
async function loadOthers(
	origin: string,
	cwd: string,
	exclude: number | undefined,
): Promise<string[]> {
	const slug = repoSlug(origin);
	if (!slug) return [];
	const out = await run(
		[
			"gh",
			"pr",
			"list",
			"--repo",
			origin,
			"--state",
			"open",
			"--limit",
			"20",
			"--json",
			LIST_FIELDS,
		],
		cwd,
	);
	if (!out) return [];
	let list: PrListItem[];
	try {
		// Trusted shape: `gh`'s own --json contract.
		list = JSON.parse(out) as PrListItem[];
	} catch {
		return [];
	}
	const open = list
		.filter(
			(p): p is PrListItem & { number: number } =>
				typeof p.number === "number" && p.number !== exclude,
		)
		.sort((a, b) => b.number - a.number);
	return open.map((p, i) => {
		const line =
			renderStatus(
				{
					number: p.number,
					url: p.url ?? "",
					state: "OPEN",
					isDraft: p.isDraft ?? false,
					mergeable: p.mergeable ?? "UNKNOWN",
					reviewDecision: p.reviewDecision ?? "",
					unresolvedComments: 0,
					// Not fetched — `reviewersUnknown` stops the ladder claiming "Set reviewers".
					humanReviewers: 0,
					checks: (p.statusCheckRollup ?? []).map(toCheckInfo),
				},
				{ label: `${slug}#${p.number}`, reviewersUnknown: true },
			) ?? "";
		return `${line} ${DIM}(${i + 1}/${open.length})${RESET}`;
	});
}

/** The first line, plus the PR number so the others line can leave it out. */
async function loadCurrent(
	branch: string,
	origin: string,
	cwd: string,
): Promise<{ line?: string; number?: number }> {
	const fields = "number,url,state,isDraft,mergeable,reviewDecision";
	const out = await run(
		["gh", "pr", "view", branch, "--repo", origin, "--json", fields],
		cwd,
	);
	if (!out) return {};
	let view: PrView;
	try {
		// Trusted shape: `gh`'s own --json contract.
		view = JSON.parse(out) as PrView;
	} catch {
		return {};
	}
	if (!view.number) return {};

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
	const line =
		base.state === "OPEN"
			? renderStatus({ ...base, ...(await fetchDetail(base.url, cwd)) })
			: renderStatus(base);
	return { line, number: base.number };
}

interface Snapshot {
	current?: string;
	/** Pre-rendered and ordered; `tick` only indexes into this. */
	others: string[];
}

async function load(cwd: string): Promise<Snapshot> {
	const branch = await run(["git", "branch", "--show-current"], cwd);
	// The repo is whatever `origin` points at — never configured, never guessed from the path.
	const origin = await run(["git", "remote", "get-url", "origin"], cwd);
	// Not a git repo, or nothing to ask about: neither line has anything to say.
	if (!origin) return { others: [] };

	// Trunk never has a PR of its own (`gh pr view` there answers with a merged one), but the
	// repo's other open PRs still do — so this must not skip the list query.
	const current =
		branch && !TRUNK[branch]
			? await loadCurrent(branch, origin, cwd)
			: undefined;
	return {
		current: current?.line,
		others: await loadOthers(origin, cwd, current?.number),
	};
}

/** cwd -> last answer, so a redraw between turns costs nothing. */
const cache = new Map<string, { at: number; snap: Snapshot }>();

/**
 * Both statusline lines for `cwd`. `current` is the branch's own PR, undefined when there is
 * nothing to show (not a repo, on trunk, no `origin`, no PR, no `gh`); `others` is one of the
 * repo's other open PRs, undefined when there are none. Cached for a minute per directory —
 * `tick` only rotates which other PR is shown, so cycling never costs a subprocess.
 */
export async function prLines(
	cwd: string,
	opts: { now?: number; tick?: number } = {},
): Promise<{ current?: string; others?: string }> {
	const now = opts.now ?? Date.now();
	let hit = cache.get(cwd);
	if (!hit || now - hit.at >= TTL_MS) {
		hit = { at: now, snap: await load(cwd) };
		cache.set(cwd, hit);
	}
	return {
		current: hit.snap.current,
		others: pickCycle(hit.snap.others, opts.tick ?? 0),
	};
}
