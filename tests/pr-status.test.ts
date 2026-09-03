import { describe, expect, test } from "bun:test";
import {
	type CheckInfo,
	checksEmoji,
	countChecks,
	nextAction,
	normalizeCheckName,
	type PrStatus,
	renderStatus,
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
		).toBe("Corrigir CI");
		expect(nextAction(pr({ mergeable: "CONFLICTING", isDraft: true }))).toBe(
			"Resolver conflitos com a base",
		);
		expect(nextAction(pr({ isDraft: true, unresolvedComments: 2 }))).toBe(
			"Publicar draft",
		);
		expect(nextAction(pr({ unresolvedComments: 2, humanReviewers: 0 }))).toBe(
			"Resolver 2 review comments",
		);
		expect(nextAction(pr({ unresolvedComments: 1 }))).toBe(
			"Resolver 1 review comment",
		);
		expect(
			nextAction(
				pr({ humanReviewers: 0, reviewDecision: "CHANGES_REQUESTED" }),
			),
		).toBe("Setar reviewers");
		expect(nextAction(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
			"Ajustar changes requested",
		);
		expect(nextAction(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe(
			"Aguardar aprovação",
		);
		expect(nextAction(pr({ checks: [check({ status: "IN_PROGRESS" })] }))).toBe(
			"CI rodando...",
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
		).toBe("PR #64 ❌ 2/3 · approved → Corrigir CI");
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
			"PR #64 draft · ✅ 1/1 · changes requested · 💬 3 · conflicts → Resolver conflitos com a base",
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
