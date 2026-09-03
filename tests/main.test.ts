import { describe, expect, test } from "bun:test";
import type {
	ExecResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import greenGhExtension, { render } from "../src/main";

type Handler = (event: unknown, ctx: unknown) => unknown;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

interface FakePi {
	label: string;
	handlers: Map<string, Handler>;
	commands: Map<string, { description?: string; handler: CommandHandler }>;
	/** Every `exec`, as `[command, argv]` — the shape the argv assertions read. */
	execCalls: Array<[string, string[]]>;
	execCwds: Array<string | undefined>;
	/** What `exec` answers; a test overwrites it to make `gh` fail. */
	execResult: ExecResult;
	userMessages: string[];
}

/**
 * Minimal stand-in for ExtensionAPI: keeps whatever the factory registers. The cast is the
 * library boundary — ExtensionAPI declares dozens of members this test never exercises.
 */
function fakePi(): { pi: FakePi; api: ExtensionAPI } {
	const pi: FakePi = {
		label: "",
		handlers: new Map(),
		commands: new Map(),
		execCalls: [],
		execCwds: [],
		execResult: { stdout: "", stderr: "", code: 0, killed: false },
		userMessages: [],
		setLabel(label: string) {
			pi.label = label;
		},
		on(event: string, handler: Handler) {
			pi.handlers.set(event, handler);
		},
		registerCommand(
			name: string,
			options: { description?: string; handler: CommandHandler },
		) {
			pi.commands.set(name, options);
		},
		exec(command: string, args: string[], options?: { cwd?: string }) {
			pi.execCalls.push([command, args]);
			pi.execCwds.push(options?.cwd);
			return Promise.resolve(pi.execResult);
		},
		sendUserMessage(content: string) {
			pi.userMessages.push(content);
		},
	} as unknown as FakePi;
	return { pi, api: pi as unknown as ExtensionAPI };
}

type StatusCall = [string, string | undefined];

interface FakeCtx {
	ctx: ExtensionContext & ExtensionCommandContext;
	calls: StatusCall[];
	notices: Array<[string, string | undefined]>;
	/** Resolves once a render has written both keys, so a test awaits the effect, not a duration. */
	rendered: Promise<void>;
}

/** `cwd` outside any git repo, so no `gh` is ever reached and the result is deterministic. */
function fakeCtx(hasUI: boolean): FakeCtx {
	const calls: StatusCall[] = [];
	const notices: Array<[string, string | undefined]> = [];
	let announce: () => void = () => {};
	const rendered = new Promise<void>((resolve) => {
		announce = resolve;
	});
	const ctx = {
		hasUI,
		cwd: "/",
		ui: {
			setStatus: (key: string, text: string | undefined) => {
				calls.push([key, text]);
				// A render writes both keys; the second one is the whole effect.
				if (calls.length >= 2) announce();
			},
			notify: (message: string, type?: string) => {
				notices.push([message, type]);
			},
		},
	};
	// Same boundary as above: the real context carries the whole session surface.
	return {
		ctx: ctx as unknown as ExtensionContext & ExtensionCommandContext,
		calls,
		notices,
		rendered,
	};
}

describe("extension wiring", () => {
	test("registers a label, both redraw handlers and both commands", () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		expect(pi.label).toBe("PR status of the current branch");
		expect([...pi.handlers.keys()].sort()).toEqual([
			"session_start",
			"turn_end",
		]);
		expect([...pi.commands.keys()].sort()).toEqual(["gh-open", "green"]);
		for (const [name, options] of pi.commands) {
			expect(options.description, `${name} needs a description`).toBeTruthy();
		}
	});

	test("both lines land on their own statusline key", async () => {
		const { ctx, calls } = fakeCtx(true);
		await render(ctx, async () => ({
			current: "PR #7 ✅",
			others: "owner/repo#9 ⌛",
		}));
		expect(calls).toEqual([
			["gh-pr", "PR #7 ✅"],
			["gh-pr-others", "owner/repo#9 ⌛"],
		]);
	});

	test("a missing line clears its key instead of leaving a stale one", async () => {
		const { ctx, calls } = fakeCtx(true);
		// No other open PR: the second key must be cleared, and "" does not clear a segment.
		await render(ctx, async () => ({ current: "PR #7 ✅" }));
		expect(calls).toEqual([
			["gh-pr", "PR #7 ✅"],
			["gh-pr-others", undefined],
		]);
	});

	test("no PR at all clears both keys", async () => {
		const { ctx, calls } = fakeCtx(true);
		await render(ctx, async () => ({}));
		expect(calls).toEqual([
			["gh-pr", undefined],
			["gh-pr-others", undefined],
		]);
	});

	test("the redraw counter advances, so the second line cycles", async () => {
		const ticks: Array<number | undefined> = [];
		const load = async (_cwd: string, opts?: { tick?: number }) => {
			ticks.push(opts?.tick);
			return {};
		};
		const { ctx } = fakeCtx(true);
		await render(ctx, load);
		await render(ctx, load);
		expect(ticks).toHaveLength(2);
		expect(ticks[1]).toBe((ticks[0] as number) + 1);
	});

	test("a directory with no PR clears both segments through the real handler", async () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		const { ctx, calls, rendered } = fakeCtx(true);
		// The handler fire-and-forgets on purpose: the harness must not block the end of a turn
		// on a `gh` round trip. So await the effect the extension produces, not the handler.
		pi.handlers.get("session_start")?.({}, ctx);
		await rendered;
		expect(calls).toEqual([
			["gh-pr", undefined],
			["gh-pr-others", undefined],
		]);
	});

	test("no UI (headless, print, subagent) means no statusline call at all", () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		const { ctx, calls } = fakeCtx(false);
		pi.handlers.get("turn_end")?.({}, ctx);
		// The `hasUI` guard runs before the first await, so nothing can arrive later.
		expect(calls).toEqual([]);
	});
});

describe("/gh-open", () => {
	async function run(argument: string) {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		const { ctx, notices } = fakeCtx(true);
		await pi.commands.get("gh-open")?.handler(argument, ctx);
		return { pi, notices };
	}

	test("no argument opens the current branch's PR", async () => {
		const { pi } = await run("");
		expect(pi.execCalls).toEqual([["gh", ["pr", "view", "--web"]]]);
		expect(pi.execCwds).toEqual(["/"]);
	});

	test("a bare number opens that PR, as its own argv entry", async () => {
		const { pi } = await run("7");
		expect(pi.execCalls).toEqual([["gh", ["pr", "view", "7", "--web"]]]);
	});

	test("a #-prefixed number opens that PR", async () => {
		const { pi } = await run("#7");
		expect(pi.execCalls).toEqual([["gh", ["pr", "view", "7", "--web"]]]);
	});

	test("a non-numeric argument never reaches a subprocess", async () => {
		const { pi, notices } = await run("; rm -rf /");
		expect(pi.execCalls).toEqual([]);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.[0]).toContain("not a PR number");
		expect(notices[0]?.[1]).toBe("error");
	});

	test("a failing gh is reported, not thrown", async () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		pi.execResult = {
			stdout: "",
			stderr: "no pull requests found",
			code: 1,
			killed: false,
		};
		const { ctx, notices } = fakeCtx(true);
		await pi.commands.get("gh-open")?.handler("", ctx);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.[0]).toContain("no pull requests found");
	});
});

describe("/green", () => {
	test("hands the agent a concrete instruction instead of doing the work", async () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		const { ctx } = fakeCtx(true);
		await pi.commands.get("green")?.handler("", ctx);
		expect(pi.userMessages).toHaveLength(1);
		const prompt = pi.userMessages[0] ?? "";
		// Each of these is a thing the agent would otherwise have to guess at.
		for (const mention of [
			"gh",
			"failing checks",
			"review",
			"behind",
			"conflict",
			"Do not merge",
			"force-push",
		]) {
			expect(prompt, `prompt must mention ${mention}`).toContain(mention);
		}
	});
});
