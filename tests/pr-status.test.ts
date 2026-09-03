import { describe, expect, spyOn, test } from "bun:test";
import {
	type CheckInfo,
	checksEmoji,
	countChecks,
	nextAction,
	normalizeCheckName,
	type PrStatus,
	pickCycle,
	prLines,
	renderStatus,
	repoSlug,
	toCheckInfo,
} from "../src/pr-status";

const ESC = String.fromCharCode(27);
const OSC8 = new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, "g");
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Strip ANSI + OSC8 so assertions read like the visible line. */
const plain = (s: string | undefined) =>
	(s ?? "").replace(OSC8, "").replace(SGR, "");

const check = (over: Partial<CheckInfo> = {}): CheckInfo => ({
	name: "unit",
	status: "COMPLETED",
	conclusion: "SUCCESS",
	...over,
});

const pr = (over: Partial<PrStatus> = {}): PrStatus => ({
	number: 64,
	url: "https://github.com/o/r/pull/64",
	state: "OPEN",
	isDraft: false,
	mergeable: "MERGEABLE",
	reviewDecision: "APPROVED",
	unresolvedComments: 0,
	humanReviewers: 1,
	checks: [check()],
	...over,
});

describe("normalizeCheckName", () => {
	test("provider prefixes are stripped, plain names survive", () => {
		expect(normalizeCheckName("ci/circleci: backend_prepare")).toBe(
			"backend_prepare",
		);
		expect(normalizeCheckName("some-app/approve-e2e-tests")).toBe(
			"approve-e2e-tests",
		);
		expect(normalizeCheckName("check")).toBe("check");
	});
});

describe("countChecks", () => {
	test("conclusions split into pass/fail", () => {
		expect(
			countChecks([
				check({ conclusion: "SUCCESS" }),
				check({ conclusion: "SKIPPED" }),
				check({ conclusion: "FAILURE" }),
				check({ conclusion: "TIMED_OUT" }),
			]),
		).toEqual({ pass: 2, fail: 2, pending: 0, total: 4 });
	});

	test("a running check is pending even with a stale SUCCESS conclusion", () => {
		expect(countChecks([check({ status: "IN_PROGRESS" })])).toEqual({
			pass: 0,
			fail: 0,
			pending: 1,
			total: 1,
		});
	});

	test("a queued check with no conclusion is pending, not a pass", () => {
		expect(
			countChecks([check({ status: "QUEUED", conclusion: "" })]).pending,
		).toBe(1);
	});
});

describe("checksEmoji", () => {
	test("failure outranks running, running outranks green", () => {
		expect(
			checksEmoji(
				countChecks([
					check({ conclusion: "FAILURE" }),
					check({ status: "QUEUED" }),
				]),
			),
		).toBe("❌");
		expect(
			checksEmoji(countChecks([check(), check({ status: "QUEUED" })])),
		).toBe("⌛");
		expect(checksEmoji(countChecks([check()]))).toBe("✅");
	});

	test("no checks is not a verdict", () => {
		expect(checksEmoji(countChecks([]))).toBe("");
	});
});

describe("toCheckInfo", () => {
	test("check runs keep status and conclusion", () => {
		expect(
			toCheckInfo({
				__typename: "CheckRun",
				name: "ci/circleci: unit",
				status: "COMPLETED",
				conclusion: "SUCCESS",
			}),
		).toEqual({ name: "unit", status: "COMPLETED", conclusion: "SUCCESS" });
	});

	test("a legacy commit status maps state onto status+conclusion", () => {
		expect(
			toCheckInfo({
				__typename: "StatusContext",
				context: "canix/lint",
				state: "FAILURE",
			}),
		).toEqual({
			name: "lint",
			status: "COMPLETED",
			conclusion: "FAILURE",
		});
		expect(
			toCheckInfo({
				__typename: "StatusContext",
				context: "lint",
				state: "PENDING",
			}),
		).toEqual({
			name: "lint",
			status: "IN_PROGRESS",
			conclusion: "",
		});
	});
});

describe("nextAction", () => {
	test("blocker order: CI, conflicts, draft, comments, reviewers, review, waiting, merge", () => {
		expect(
			nextAction(
				pr({
					checks: [check({ conclusion: "FAILURE" })],
					mergeable: "CONFLICTING",
				}),
			),
		).toBe("Fix CI");
		expect(nextAction(pr({ mergeable: "CONFLICTING", isDraft: true }))).toBe(
			"Resolve conflicts with base",
		);
		expect(nextAction(pr({ isDraft: true, unresolvedComments: 2 }))).toBe(
			"Publish draft",
		);
		expect(nextAction(pr({ unresolvedComments: 2, humanReviewers: 0 }))).toBe(
			"Resolve 2 review comments",
		);
		expect(nextAction(pr({ unresolvedComments: 1 }))).toBe(
			"Resolve 1 review comment",
		);
		expect(
			nextAction(
				pr({ humanReviewers: 0, reviewDecision: "CHANGES_REQUESTED" }),
			),
		).toBe("Set reviewers");
		expect(nextAction(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
			"Address changes requested",
		);
		expect(nextAction(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe(
			"Waiting for approval",
		);
		expect(nextAction(pr({ checks: [check({ status: "IN_PROGRESS" })] }))).toBe(
			"CI running",
		);
		expect(nextAction(pr())).toBe("Merge PR");
	});

	test("a settled PR has no next action", () => {
		expect(nextAction(pr({ state: "MERGED" }))).toBe("");
		expect(nextAction(pr({ state: "CLOSED" }))).toBe("");
	});
});

describe("renderStatus", () => {
	test("nothing to show without a PR", () => {
		expect(renderStatus(undefined)).toBeUndefined();
	});

	test("green and approved: status plus the next action, one line", () => {
		expect(plain(renderStatus(pr()))).toBe(
			"PR #64 ✅ 1/1 · approved → Merge PR",
		);
	});

	test("the failing count is the number shown", () => {
		expect(
			plain(
				renderStatus(
					pr({
						checks: [
							check(),
							check({ conclusion: "FAILURE" }),
							check({ conclusion: "ERROR" }),
						],
					}),
				),
			),
		).toBe("PR #64 ❌ 2/3 · approved → Fix CI");
	});

	test("draft, review verdict, unresolved threads and conflicts all ride along", () => {
		expect(
			plain(
				renderStatus(
					pr({
						isDraft: true,
						reviewDecision: "CHANGES_REQUESTED",
						unresolvedComments: 3,
						mergeable: "CONFLICTING",
					}),
				),
			),
		).toBe(
			"PR #64 draft · ✅ 1/1 · changes requested · 💬 3 · conflicts → Resolve conflicts with base",
		);
	});

	test("a PR without checks says so instead of claiming green", () => {
		expect(plain(renderStatus(pr({ checks: [] })))).toBe(
			"PR #64 no checks · approved → Merge PR",
		);
	});

	test("terminal states collapse to one word, with no next action", () => {
		expect(plain(renderStatus(pr({ state: "MERGED" })))).toBe("PR #64 merged");
		expect(plain(renderStatus(pr({ state: "CLOSED" })))).toBe("PR #64 closed");
	});

	test("the line never contains a newline", () => {
		// setStatus collapses newlines to spaces; a multi-line render would be silently mangled.
		expect(renderStatus(pr({ unresolvedComments: 2 }))).not.toContain("\n");
	});

	test("the PR number is a hyperlink to the PR", () => {
		expect(renderStatus(pr())).toContain(
			`${ESC}]8;;https://github.com/o/r/pull/64${ESC}\\`,
		);
	});
});

describe("repoSlug", () => {
	test("every origin form GitHub hands out maps to owner/repo", () => {
		expect(repoSlug("git@github.com:o/r.git")).toBe("o/r");
		expect(repoSlug("ssh://git@github.com/o/r.git")).toBe("o/r");
		expect(repoSlug("https://github.com/o/r.git")).toBe("o/r");
		expect(repoSlug("https://github.com/o/r")).toBe("o/r");
		expect(repoSlug("https://github.com/o/r/")).toBe("o/r");
		expect(repoSlug("  https://github.com/o/r\n")).toBe("o/r");
		// Not GitHub-specific: any host works, the slug is the last two path segments.
		expect(repoSlug("git@git.acme.internal:team/tool.git")).toBe("team/tool");
	});

	test("anything it cannot parse is undefined, never a made-up slug", () => {
		expect(repoSlug("")).toBeUndefined();
		expect(repoSlug("origin")).toBeUndefined();
		expect(repoSlug("/Users/me/some/local/path")).toBeUndefined();
		// One segment is not owner/repo — the host must not be mistaken for the owner.
		expect(repoSlug("https://github.com/onlyowner")).toBeUndefined();
	});
});

describe("pickCycle", () => {
	const items = ["a", "b", "c"];

	test("tick 0 shows the first item", () => {
		expect(pickCycle(items, 0)).toBe("a");
	});

	test("a tick past the end wraps instead of falling off", () => {
		expect(pickCycle(items, 3)).toBe("a");
		expect(pickCycle(items, 7)).toBe("b");
		expect(pickCycle(items, 100)).toBe("b");
	});

	test("a negative tick stays in range", () => {
		expect(pickCycle(items, -1)).toBe("c");
		expect(pickCycle(items, -4)).toBe("c");
	});

	test("an empty list has nothing to show", () => {
		expect(pickCycle([], 0)).toBeUndefined();
		expect(pickCycle([], 5)).toBeUndefined();
	});
});

describe("nextAction with an unknown reviewer count", () => {
	test("the reviewer rung is skipped instead of lying about zero reviewers", () => {
		expect(
			nextAction(pr({ humanReviewers: 0, reviewDecision: "" }), true),
		).toBe("Waiting for approval");
		expect(nextAction(pr({ humanReviewers: 0 }), true)).toBe("Merge PR");
	});

	test("without the flag the ladder is unchanged", () => {
		expect(nextAction(pr({ humanReviewers: 0 }))).toBe("Set reviewers");
		expect(nextAction(pr({ humanReviewers: 0 }), false)).toBe("Set reviewers");
	});
});

/** A `gh pr list` row. #10 is green+approved, #9 is the current branch's, #8 awaits review. */
const listRow = (number: number, reviewDecision: string) => ({
	number,
	url: `https://github.com/o/r/pull/${number}`,
	isDraft: false,
	mergeable: "MERGEABLE",
	reviewDecision,
	statusCheckRollup: [
		{
			__typename: "CheckRun",
			name: "check",
			status: "COMPLETED",
			conclusion: "SUCCESS",
		},
	],
});

// Deliberately out of order: the rotation order must come from the sort, not from `gh`.
const LIST = JSON.stringify([
	listRow(9, "APPROVED"),
	listRow(10, "APPROVED"),
	listRow(8, "REVIEW_REQUIRED"),
]);

const reply = (branch: string) => (cmd: string[]) => {
	if (cmd[0] === "git")
		return cmd[1] === "branch" ? branch : "git@github.com:o/r.git";
	if (cmd[2] === "view")
		return JSON.stringify({
			number: 9,
			url: "https://github.com/o/r/pull/9",
			state: "OPEN",
			isDraft: false,
			mergeable: "MERGEABLE",
			reviewDecision: "APPROVED",
		});
	if (cmd[2] === "list") return LIST;
	return ""; // graphql: degrades to zeroes, as in the real no-`gh` path
};

/** Replace every subprocess with canned stdout, recording each argv so calls can be counted. */
function fakeSpawn(stdout: (cmd: string[]) => string) {
	const cmds: string[][] = [];
	// Bun.spawn's overloads are unexpressible here; `run` only touches stdout and exited.
	const impl = (cmd: string[]) => {
		cmds.push(cmd);
		return { stdout: stdout(cmd), exited: Promise.resolve(0) };
	};
	const spy = spyOn(Bun, "spawn").mockImplementation(
		impl as unknown as typeof Bun.spawn,
	);
	return { cmds, restore: () => spy.mockRestore() };
}

describe("prLines", () => {
	test("the others line labels the repo, reuses the verdict and says its position", async () => {
		const spawn = fakeSpawn(reply("feature-x"));
		try {
			const lines = await prLines("/cwd/format", { now: 1_000, tick: 0 });
			// #9 belongs to the current branch and is already on line one.
			expect(plain(lines.others)).toBe(
				"o/r#10 ✅ 1/1 · approved → Merge PR (1/2)",
			);
			expect(lines.current).toBeDefined();
		} finally {
			spawn.restore();
		}
	});

	test("an others-line PR never claims 'Set reviewers' off a count gh pr list cannot give", async () => {
		const spawn = fakeSpawn(reply("feature-x"));
		try {
			const lines = await prLines("/cwd/reviewers", { now: 1_000, tick: 1 });
			expect(plain(lines.others)).toBe(
				"o/r#8 ✅ 1/1 · review required → Waiting for approval (2/2)",
			);
			expect(plain(lines.others)).not.toContain("Set reviewers");
		} finally {
			spawn.restore();
		}
	});

	test("a new tick rotates to a different PR without running gh again", async () => {
		const spawn = fakeSpawn(reply("feature-x"));
		try {
			const first = await prLines("/cwd/rotate", { now: 1_000, tick: 0 });
			const spent = spawn.cmds.length;
			expect(spent).toBeGreaterThan(0);

			const second = await prLines("/cwd/rotate", { now: 1_000, tick: 1 });
			// Cycling is a pure index into the cached list: no subprocess may be spent on it.
			expect(spawn.cmds.length).toBe(spent);
			expect(plain(second.others)).not.toBe(plain(first.others));
			expect(plain(second.others)).toContain("o/r#8");
		} finally {
			spawn.restore();
		}
	});

	test("on trunk there is no first line but the other PRs still show", async () => {
		const spawn = fakeSpawn(reply("main"));
		try {
			const lines = await prLines("/cwd/trunk", { now: 1_000, tick: 0 });
			expect(lines.current).toBeUndefined();
			// Nothing to exclude, so all three are in the rotation.
			expect(plain(lines.others)).toBe(
				"o/r#10 ✅ 1/1 · approved → Merge PR (1/3)",
			);
			expect(spawn.cmds.some((cmd) => cmd[2] === "view")).toBe(false);
		} finally {
			spawn.restore();
		}
	});

	test("outside a git repo both lines are empty", async () => {
		const spawn = fakeSpawn(() => "");
		try {
			expect(await prLines("/cwd/norepo", { now: 1_000 })).toEqual({
				current: undefined,
				others: undefined,
			});
			expect(spawn.cmds.some((cmd) => cmd[0] === "gh")).toBe(false);
		} finally {
			spawn.restore();
		}
	});
});
