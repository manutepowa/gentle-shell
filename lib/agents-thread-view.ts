import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi, type MarkdownTheme } from "@earendil-works/pi-tui";
import { NOTE_SEVERITY, THREAD_ITEM, type NoteSeverity, type ThreadItem, type ToolItem } from "./agents-protocol.ts";
import {
	CARD_TONE, cardBodyRows, cardBottom, cardInnerWidth, cardTop, floatRows, type CardTheme, type CardTone,
} from "./shell-card.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";

/** The host theme, plus the text attributes Markdown needs when the theme offers them. */
export interface AgentsThreadTheme extends CardTheme {
	bold?(text: string): string;
	italic?(text: string): string;
	underline?(text: string): string;
	strikethrough?(text: string): string;
}

// Prose roles mirror the parent transcript: assistant text reads as text,
// thinking is dim, a note is muted. Tool calls are cards instead, so they use
// the same chrome as every other conversation card.
const PROSE = {
	TEXT: "text",
	THINKING: "dim",
	NOTE: "muted",
	LABEL: "customMessageLabel",
} as const;

const OUTPUT_INDENT = 2;

// Pi's own transcript paints Markdown with these theme tokens.
const MD_TOKEN = {
	heading: "mdHeading",
	link: "mdLink",
	linkUrl: "mdLinkUrl",
	code: "mdCode",
	codeBlock: "mdCodeBlock",
	codeBlockBorder: "mdCodeBlockBorder",
	quote: "mdQuote",
	quoteBorder: "mdQuoteBorder",
	hr: "mdHr",
	listBullet: "mdListBullet",
} as const;

/** Paint with a role, keeping the content when the host theme lacks that token. */
function paint(theme: AgentsThreadTheme, role: string): (text: string) => string {
	return (text: string) => {
		try {
			return theme.fg(role, text);
		} catch {
			return text;
		}
	};
}

/**
 * Markdown theme for one block. Prose uses Pi's transcript tokens; `mono` paints
 * every token and attribute with a single role instead, which is what keeps a
 * thinking block uniformly dim without losing its structure.
 */
function markdownTheme(theme: AgentsThreadTheme, mono?: string): MarkdownTheme {
	const token = (name: string) => paint(theme, mono ?? name);
	const attribute = (name: keyof Pick<AgentsThreadTheme, "bold" | "italic" | "underline" | "strikethrough">) => (text: string) => {
		if (mono !== undefined) return token(mono)(text);
		const apply = theme[name];
		return apply ? apply.call(theme, text) : text;
	};
	return {
		heading: token(MD_TOKEN.heading),
		link: token(MD_TOKEN.link),
		linkUrl: token(MD_TOKEN.linkUrl),
		code: token(MD_TOKEN.code),
		codeBlock: token(MD_TOKEN.codeBlock),
		codeBlockBorder: token(MD_TOKEN.codeBlockBorder),
		quote: token(MD_TOKEN.quote),
		quoteBorder: token(MD_TOKEN.quoteBorder),
		hr: token(MD_TOKEN.hr),
		listBullet: token(MD_TOKEN.listBullet),
		bold: attribute("bold"),
		italic: attribute("italic"),
		underline: attribute("underline"),
		strikethrough: attribute("strikethrough"),
	};
}

// Markdown pads every row to the render width; trailing blanks carry no content
// and would only add noise to the thread cache.
function markdownLines(theme: AgentsThreadTheme, text: string, width: number, role: string, mono = false): string[] {
	const target = Math.max(1, Math.floor(width));
	const rendered = new Markdown(text, 0, 0, markdownTheme(theme, mono ? role : undefined), { color: paint(theme, role) })
		.render(target);
	return rendered.map((row) => row.replace(/[ \t]+$/u, ""));
}

function singleLine(value: string): string {
	return sanitizeTerminalText(value)
		.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

// The one argument that identifies a call, in the order a reader needs it.
const SUMMARY_KEYS = [
	"command", "cmd", "path", "file_path", "filePath", "file", "pattern", "query", "queries",
	"url", "prompt", "description", "label", "subject", "name", "sessionId",
] as const;

/** The call's identifying argument as one sanitized line, never JSON. */
function argSummary(args: Record<string, unknown>): string {
	const text = (value: unknown): string => {
		if (typeof value === "string") return singleLine(value);
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
		if (Array.isArray(value)) {
			const first = value.find((entry) => typeof entry === "string") as string | undefined;
			return first === undefined ? "" : singleLine(first);
		}
		return "";
	};
	for (const key of SUMMARY_KEYS) {
		const shown = text(args[key]);
		if (shown.length > 0) return shown;
	}
	for (const value of Object.values(args)) {
		const shown = text(value);
		if (shown.length > 0) return shown;
	}
	return "";
}

interface ToolState {
	tone: CardTone;
	glyph: string;
	status: string;
}

// The same state glyphs the Agents card uses, so a running call reads the same
// way in the card above the editor and inside the thread.
function toolState(item: ToolItem): ToolState {
	if (item.isError) return { tone: CARD_TONE.ERROR, glyph: "✗", status: "Error" };
	if (item.running) return { tone: CARD_TONE.INFO, glyph: "◐", status: "Running" };
	return { tone: CARD_TONE.INFO, glyph: "✓", status: "Complete" };
}

/** How one thread item is drawn: the host's fold state and the hint that names its binding. */
export interface ThreadRenderOptions {
	/** Show every retained output row instead of the three-row preview. */
	expanded?: boolean;
	/** Border hint naming the host binding; omitted when the host disabled the action. */
	hint?: string;
}

/** Every retained output line, indented and wrapped so nothing is clipped. */
function outputRows(item: ToolItem, cardWidth: number): string[] {
	if (item.output.length === 0) return [];
	const width = Math.max(1, cardInnerWidth(cardWidth) - OUTPUT_INDENT);
	const prefix = " ".repeat(OUTPUT_INDENT);
	return item.output.split("\n").flatMap((source) => {
		if (source.length === 0) return [""];
		const wrapped = wrapTextWithAnsi(source, width);
		return (wrapped.length > 0 ? wrapped : [source]).map((row) => `${prefix}${row}`);
	});
}

function toolLines(item: ToolItem, theme: AgentsThreadTheme, width: number, options: ThreadRenderOptions): string[] {
	const state = toolState(item);
	// A call with nothing to show has nothing to fold, so it never advertises the toggle.
	const hint = item.output.length === 0 ? undefined : options.hint;
	return floatRows(state.tone, theme, width, (cardWidth) => {
		const title = singleLine(item.name) || "tool";
		const summary = argSummary(item.args);
		const room = Math.max(8, cardWidth - visibleWidth(title) - 16);
		const subtitle = summary.length === 0 ? undefined : truncateToWidth(summary, room, "…");
		const body = outputRows(item, cardWidth);
		return {
			head: [cardTop({ title, subtitle, body: [], tone: state.tone, glyph: state.glyph }, theme, cardWidth, hint)],
			...(body.length > 0 ? { body: cardBodyRows(body, state.tone, theme, cardWidth, { expanded: options.expanded === true, previewRows: 3 }) } : {}),
			bottom: cardBottom(state.tone, theme, cardWidth, state.status),
		};
	});
}

function thinkingLines(text: string, theme: AgentsThreadTheme, width: number): string[] {
	const indent = " ".repeat(OUTPUT_INDENT);
	const body = markdownLines(theme, text, width - OUTPUT_INDENT, PROSE.THINKING, true)
		.map((row) => `${indent}${row}`.replace(/[ \t]+$/u, ""));
	return [paint(theme, PROSE.LABEL)("Thinking"), ...body];
}

// A note is a notice, unless the child reported a failure: then it wears the
// error card, so a reader scanning the thread never mistakes it for chatter.
function noteLines(text: string, theme: AgentsThreadTheme, width: number, severity?: NoteSeverity): string[] {
	const failed = severity === NOTE_SEVERITY.ERROR;
	const tone = failed ? CARD_TONE.ERROR : CARD_TONE.INFO;
	const rows = text.split("\n");
	return floatRows(tone, theme, width, (cardWidth) => ({
		head: [cardTop({ title: failed ? "Error" : "Note", body: [], tone, glyph: failed ? "✗" : "↳" }, theme, cardWidth)],
		body: cardBodyRows(rows.map((row) => (row === "" ? "" : paint(theme, failed ? CARD_TONE.ERROR : PROSE.NOTE)(row))), tone, theme, cardWidth,
			{ expanded: true }),
		bottom: cardBottom(tone, theme, cardWidth),
	}));
}

/**
 * Render already-sanitized, bounded protocol items. Prose keeps the parent
 * transcript's Markdown, and a tool call becomes a conversation card with the
 * call's identifying argument and every retained output line. Every item ends
 * with one blank row, so mixed prose and cards keep a single separator.
 */
export function renderThreadItem(item: ThreadItem, theme: AgentsThreadTheme, width: number, options: ThreadRenderOptions = {}): string[] {
	if (width <= 0) return [];
	const rows = ((): string[] => {
		switch (item.kind) {
			case THREAD_ITEM.TEXT:
				return markdownLines(theme, item.text, width, PROSE.TEXT);
			case THREAD_ITEM.THINKING:
				return thinkingLines(item.text, theme, width);
			case THREAD_ITEM.NOTE:
				return noteLines(item.text, theme, width, item.severity);
			case THREAD_ITEM.TOOL:
				return toolLines(item, theme, width, options);
			default:
				return [];
		}
	})();
	return rows.length === 0 ? rows : [...rows, ""];
}
