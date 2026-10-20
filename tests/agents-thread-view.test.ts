import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { emptyThread, TASK_EVENT, applyTaskEvent } from "../lib/agents-protocol.ts";
import { renderThreadItem } from "../lib/agents-thread-view.ts";

const plainTheme = { fg: (_color: string, text: string) => text };
const taggedTheme = { fg: (color: string, text: string) => `[${color}]${text}` };
const fits = (lines: string[], width: number) => {
	for (const line of lines) assert.ok(visibleWidth(line) <= width, `"${line}" fits width ${width}`);
};

test("prose renders as Markdown without a card frame, followed by one blank separator", () => {
	const lines = renderThreadItem({ kind: "text", text: "# Title\n\nSome **bold** and `code`.\n\n- one" }, plainTheme, 40);
	assert.deepEqual(lines, ["Title", "", "Some bold and code.", "", "- one", ""]);
	assert.equal(lines.some((line) => line.startsWith("╭")), false, "prose keeps the parent transcript's frameless look");
	fits(lines, 40);
});

test("a tool call is a card carrying its identifying argument, state glyph, and status", () => {
	const lines = renderThreadItem({ kind: "tool", callId: "call", name: "bash", args: { command: "echo hi" }, output: "one\n\n  code", running: true, isError: false }, plainTheme, 44);
	assert.equal(lines[0].startsWith("╭─ ◐ bash · echo hi "), true, `header carries glyph, tool, and argument: "${lines[0]}"`);
	assert.equal(lines.at(-2)?.startsWith("╰─"), true, "the card closes with its bottom rule");
	assert.equal(lines.at(-2)?.endsWith("Running ╯"), true, `bottom rule carries the state: "${lines.at(-2)}"`);
	assert.deepEqual(lines.slice(1, -2), ["│   one                                    │", "│                                          │", "│     code                                 │"],
		"every output line is retained with its own indentation");
	fits(lines, 44);
});

test("a finished call reads Complete and a failed call takes the error tone", () => {
	const done = renderThreadItem({ kind: "tool", callId: "call", name: "read", args: { path: "a.ts" }, output: "ok", running: false, isError: false }, plainTheme, 44);
	assert.equal(done[0].startsWith("╭─ ✓ read · a.ts "), true, `completed calls show the success glyph: "${done[0]}"`);
	assert.equal(done.at(-2)?.endsWith("Complete ╯"), true);
	const failed = renderThreadItem({ kind: "tool", callId: "call", name: "read", args: { path: "a.ts" }, output: "boom", running: false, isError: true }, taggedTheme, 44);
	assert.equal(failed[0].startsWith("[error]╭[error]─ [error]✗ read"), true, `failed calls paint the frame with the error role: "${failed[0]}"`);
	assert.equal(failed.at(-2)?.includes("[dim]Error"), true, `failed calls close with the error status: "${failed.at(-2)}"`);
});

test("a call without output renders just its card head and bottom", () => {
	const lines = renderThreadItem({ kind: "tool", callId: "call", name: "read", args: { path: "a.ts" }, output: "", running: true, isError: false }, plainTheme, 44);
	assert.deepEqual(lines.map((line) => line.slice(0, 2)), ["╭─", "╰─", ""]);
	assert.equal(lines[0].startsWith("╭─ ◐ read · a.ts "), true);
});

test("every retained tool-output line survives across terminal widths", () => {
	const toolOutput = Array.from({ length: 11 }, (_, index) => `output line ${index}`).join("\n");
	for (const width of [20, 30, 40, 60, 80, 120]) {
		const lines = renderThreadItem({ kind: "tool", callId: "call", name: "long-running-command", args: {}, output: toolOutput, running: false, isError: false }, plainTheme, width);
		for (const index of [0, 5, 10]) {
			assert.equal(lines.some((line) => line.includes(`output line ${index}`)), true, `output line ${index} is retained at width ${width}`);
		}
		assert.equal(lines.filter((line) => /output line \d+/.test(line)).length, 11, `no retained line is capped at width ${width}`);
		fits(lines, width);
	}
});

test("the protocol's retention marker reaches the view unchanged and no terminal escape survives", () => {
	let thread = emptyThread({ maxOutputChars: 24 });
	thread = applyTaskEvent(thread, { type: TASK_EVENT.TOOL_START, callId: "call", name: "bash", args: {} });
	thread = applyTaskEvent(thread, { type: TASK_EVENT.TOOL_END, callId: "call", output: "\u001b[31mfirst retained line\nlast retained line", isError: true });
	const item = thread.items[0];
	assert.equal(item?.kind, "tool");
	if (item?.kind !== "tool") throw new Error("expected the actual tool event to create a tool item");
	assert.equal(item.output.includes("\u001b"), false, "applyTaskEvent sanitizes terminal escapes before rendering");
	assert.equal(item.output.startsWith("…"), true, "the existing retention marker reaches the view unchanged");
	const lines = renderThreadItem(item, plainTheme, 60);
	assert.equal(lines.some((line) => line.includes("…")), true, "the renderer keeps the protocol marker rather than inventing one");
	fits(lines, 60);
});

test("thinking reads dim under its label and a note keeps its card", () => {
	assert.deepEqual(renderThreadItem({ kind: "thinking", text: "one\n\ntwo" }, taggedTheme, 30),
		["[customMessageLabel]Thinking", "  [dim]one", "", "  [dim]two", ""]);
	const note = renderThreadItem({ kind: "note", text: "keep this" }, plainTheme, 30);
	assert.equal(note[0].startsWith("╭─ ↳ Note "), true, `notes stay recognizable: "${note[0]}"`);
	assert.equal(note[1], "│ keep this                  │");
});

test("a zero width or an unknown kind renders nothing", () => {
	assert.deepEqual(renderThreadItem({ kind: "text", text: "x" }, plainTheme, 0), []);
	assert.deepEqual(renderThreadItem({ kind: "unknown" } as never, plainTheme, 30), []);
});
