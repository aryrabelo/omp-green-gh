import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import greenGhExtension from "../src/main";

type Handler = (event: unknown, ctx: unknown) => unknown;

interface FakePi {
	label: string;
	handlers: Map<string, Handler>;
	setLabel(label: string): void;
	on(event: string, handler: Handler): void;
}

/**
 * Minimal stand-in for ExtensionAPI: keeps whatever the factory registers. The cast is the
 * library boundary — ExtensionAPI declares dozens of members this test never exercises.
 */
function fakePi(): { pi: FakePi; api: ExtensionAPI } {
	const handlers = new Map<string, Handler>();
	const pi: FakePi = {
		label: "",
		handlers,
		setLabel(label) {
			pi.label = label;
		},
		on(event, handler) {
			handlers.set(event, handler);
		},
	};
	return { pi, api: pi as unknown as ExtensionAPI };
}

interface FakeCtx {
	ctx: ExtensionContext;
	calls: Array<[string, string]>;
	/** Resolves on the first `setStatus`, so the test awaits the real effect, not a duration. */
	firstCall: Promise<[string, string]>;
}

/** `cwd` outside any git repo, so no `gh` is ever reached and the result is deterministic. */
function fakeCtx(hasUI: boolean): FakeCtx {
	const calls: Array<[string, string]> = [];
	let announce: (call: [string, string]) => void = () => {};
	const firstCall = new Promise<[string, string]>((resolve) => {
		announce = resolve;
	});
	const ctx = {
		hasUI,
		cwd: "/",
		ui: {
			setStatus: (key: string, text: string) => {
				calls.push([key, text]);
				announce([key, text]);
			},
		},
	};
	// Same boundary as above: the real context carries the whole session surface.
	return { ctx: ctx as unknown as ExtensionContext, calls, firstCall };
}

describe("extension wiring", () => {
	test("registers a label and redraws on session_start and turn_end", () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		expect(pi.label).toBe("PR status of the current branch");
		expect([...pi.handlers.keys()].sort()).toEqual([
			"session_start",
			"turn_end",
		]);
	});

	test("a directory with no PR clears the segment instead of leaving a stale one", async () => {
		const { pi, api } = fakePi();
		greenGhExtension(api);
		const { ctx, firstCall } = fakeCtx(true);
		// The handler fire-and-forgets on purpose: the harness must not block the end of a turn
		// on a `gh` round trip. So await the effect the extension produces, not the handler.
		pi.handlers.get("session_start")?.({}, ctx);
		expect(await firstCall).toEqual(["z-pr", ""]);
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
