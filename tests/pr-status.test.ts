import { describe, expect, test } from "bun:test";
import { countChecks, type PrView, renderPr } from "../src/pr-status";

const ESC = String.fromCharCode(27);
const OSC8 = new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, "g");
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Strip ANSI + OSC8 so assertions read like the visible line. */
const plain = (s: string | undefined) =>
	(s ?? "").replace(OSC8, "").replace(SGR, "");

describe("countChecks", () => {
	test("completed check runs split by conclusion", () => {
		expect(
			countChecks([
				{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
				{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
				{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
				{
					__typename: "CheckRun",
					status: "COMPLETED",
					conclusion: "TIMED_OUT",
				},
			]),
		).toEqual({ pass: 2, fail: 2, pending: 0, total: 4 });
	});

	test("a running check counts pending even with a stale SUCCESS conclusion", () => {
		expect(
			countChecks([
				{
					__typename: "CheckRun",
					status: "IN_PROGRESS",
					conclusion: "SUCCESS",
				},
			]),
		).toEqual({ pass: 0, fail: 0, pending: 1, total: 1 });
	});

	test("legacy commit statuses use state", () => {
		expect(
			countChecks([
				{ __typename: "StatusContext", state: "SUCCESS" },
				{ __typename: "StatusContext", state: "PENDING" },
				{ __typename: "StatusContext", state: "ERROR" },
			]),
		).toEqual({ pass: 1, fail: 1, pending: 1, total: 3 });
	});

	test("no rollup is not a failure", () => {
		expect(countChecks(null)).toEqual({
			pass: 0,
			fail: 0,
			pending: 0,
			total: 0,
		});
	});
});

describe("renderPr", () => {
	const open = (over: PrView = {}): PrView => ({
		number: 64,
		url: "https://github.com/o/r/pull/64",
		state: "OPEN",
		statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
		...over,
	});

	test("nothing to show without a PR", () => {
		expect(renderPr(undefined)).toBeUndefined();
		expect(renderPr({})).toBeUndefined();
	});

	test("green PR", () => {
		expect(plain(renderPr(open()))).toBe("PR #64 ✓ 1/1");
	});

	test("failures win over pending and over passes", () => {
		expect(
			plain(
				renderPr(
					open({
						statusCheckRollup: [
							{ status: "COMPLETED", conclusion: "SUCCESS" },
							{ status: "IN_PROGRESS" },
							{ status: "COMPLETED", conclusion: "FAILURE" },
						],
					}),
				),
			),
		).toBe("PR #64 ✗ 1/3");
	});

	test("pending is not reported as green", () => {
		expect(
			plain(renderPr(open({ statusCheckRollup: [{ status: "QUEUED" }] }))),
		).toBe("PR #64 ● 1/1");
	});

	test("draft, review verdict and conflicts ride along", () => {
		expect(
			plain(
				renderPr(
					open({
						isDraft: true,
						reviewDecision: "CHANGES_REQUESTED",
						mergeable: "CONFLICTING",
					}),
				),
			),
		).toBe("PR #64 draft · ✓ 1/1 · changes requested · conflicts");
	});

	test("terminal states drop the check detail", () => {
		expect(plain(renderPr(open({ state: "MERGED" })))).toBe("PR #64 merged");
		expect(plain(renderPr(open({ state: "CLOSED" })))).toBe("PR #64 closed");
	});

	test("the PR number is a hyperlink to the PR", () => {
		expect(renderPr(open())).toContain(
			`${ESC}]8;;https://github.com/o/r/pull/64${ESC}\\`,
		);
	});
});
