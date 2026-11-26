import assert from "node:assert/strict";
import test from "node:test";
import { flush, inspectorPick, loadCanvas } from "./support/design-canvas-dom.ts";

type Canvas = Awaited<ReturnType<typeof loadCanvas>>;
const $ = (canvas: Canvas, id: string) => canvas.document.getElementById(id)!;
const commentPosts = (canvas: Canvas) => canvas.posts.filter((post) => post.url === "/t/api/comments").map((post) => post.body as Record<string, unknown>);

async function openBox(canvas: Canvas, text: string) {
	$(canvas, "gd-comment").dispatch("click");
	const frame = canvas.frames()[0];
	canvas.message(frame.contentWindow, inspectorPick(frame, { type: "gd:pick", selector: "nav.side", excerpt: "Home", rect: { x: 1, y: 1, width: 10, height: 10 } }));
	$(canvas, "gd-popover-text").value = text;
}

for (const [label, init] of [["Ctrl+Enter", { ctrlKey: true }], ["Cmd+Enter", { metaKey: true }]] as const) {
	test(`${label} in the comment box sends it in Send now mode`, async () => {
		const canvas = await loadCanvas();
		await openBox(canvas, "Make it blue");
		const event = $(canvas, "gd-popover-text").dispatch("keydown", { key: "Enter", ...init });
		await flush();
		assert.equal(event.defaultPrevented, true);
		assert.deepEqual(commentPosts(canvas).map((body) => [body.comment, body.mode]), [["Make it blue", "send"]]);
	});
}

test("Ctrl+Enter in the comment box saves it in Collect mode", async () => {
	const canvas = await loadCanvas();
	const collect = $(canvas, "gd-mode-collect");
	collect.checked = true;
	collect.dispatch("change");
	await openBox(canvas, "Later");
	$(canvas, "gd-popover-text").dispatch("keydown", { key: "Enter", ctrlKey: true });
	await flush();
	assert.deepEqual(commentPosts(canvas).map((body) => [body.comment, body.mode]), [["Later", "collect"]]);
});

test("Enter alone, Shift+Enter and an IME composition keep typing instead of submitting", async () => {
	const canvas = await loadCanvas();
	await openBox(canvas, "Line one");
	const text = $(canvas, "gd-popover-text");
	for (const init of [{}, { shiftKey: true }, { ctrlKey: true, isComposing: true }]) {
		const event = text.dispatch("keydown", { key: "Enter", ...init });
		assert.equal(event.defaultPrevented, false);
	}
	await flush();
	assert.deepEqual(commentPosts(canvas), []);
});

test("Ctrl+Enter while a comment is already sending does not send it twice", async () => {
	const canvas = await loadCanvas();
	await openBox(canvas, "Once");
	$(canvas, "gd-popover-send").disabled = true;
	$(canvas, "gd-popover-text").dispatch("keydown", { key: "Enter", ctrlKey: true });
	await flush();
	assert.deepEqual(commentPosts(canvas), []);
});
