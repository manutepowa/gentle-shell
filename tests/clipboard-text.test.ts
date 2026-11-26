import assert from "node:assert/strict";
import test from "node:test";
import { readClipboardText } from "../lib/clipboard-text.ts";

test("reads Wayland text without adding or trimming whitespace", async () => {
	const calls: Array<[string, readonly string[]]> = [];
	const text = await readClipboardText({
		platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" }, procVersion: () => undefined,
		async run(command, args) { calls.push([command, args]); return Buffer.from("  first\nsecond\n"); },
	});
	assert.equal(text, "  first\nsecond\n");
	assert.deepEqual(calls, [["wl-paste", ["--no-newline", "--type", "text"]]]);
});

test("tries Wayland, X11 and Windows in order on WSL", async () => {
	const calls: string[] = [];
	const text = await readClipboardText({
		platform: "linux", env: { WSL_INTEROP: "enabled" },
		async run(command, _args, options) {
			calls.push(command);
			assert.ok(typeof options?.timeoutMs === "number" && options.timeoutMs > 0 && options.timeoutMs <= 1500);
			if (command === "xclip") throw new Error("unavailable");
			return command === "powershell.exe" ? Buffer.from("Windows clipboard") : undefined;
		},
	});
	assert.equal(text, "Windows clipboard");
	assert.deepEqual(calls, ["wl-paste", "xclip", "xsel", "powershell.exe"]);
});

test("macOS uses pbpaste and distinguishes an empty response from no response", async () => {
	for (const output of [Buffer.alloc(0), undefined]) {
		const calls: Array<[string, readonly string[]]> = [];
		const text = await readClipboardText({
			platform: "darwin", env: {},
			async run(command, args) { calls.push([command, args]); return output; },
		});
		assert.deepEqual(calls, [["pbpaste", []]]);
		assert.equal(text, output ? "" : null);
	}
});
