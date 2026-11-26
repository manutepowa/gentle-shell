import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { isWsl, runClipboardCommand, type ClipboardCommandRunner } from "./clipboard-image.ts";

const READ_TIMEOUT_MS = 1500;
const LINUX_COMMAND_TIMEOUT_MS = 250;
const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command",
	"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $text = Get-Clipboard -Raw -ErrorAction Stop; if ($null -eq $text) { exit 1 }; [Console]::Write($text)"];

type TextReader = () => Promise<string | null>;
type TextWriter = (text: string) => Promise<void>;

/** Bound the wait even when an injected backend never settles. */
export async function readClipboardTextWithTimeout(read: TextReader): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
		const text = await Promise.race([read(), timeout]);
		return text?.replace(/\r\n/g, "\n") ?? null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Best-effort write; the Vim register stays available even if the system write fails. */
export async function writeClipboardText(text: string, write: TextWriter = copyToClipboard): Promise<void> {
	try { await write(text); } catch { /* No clipboard backend available. */ }
}

interface ClipboardTextOptions {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	run?: ClipboardCommandRunner;
	procVersion?: () => string | undefined;
}

/** Read plain text without trimming whitespace or adding a newline. */
export async function readClipboardText(options: ClipboardTextOptions = {}): Promise<string | null> {
	const { env = process.env, platform = process.platform, run = runClipboardCommand, procVersion } = options;
	const deadline = performance.now() + READ_TIMEOUT_MS;
	const read = async (command: string, args: readonly string[], limit = READ_TIMEOUT_MS): Promise<string | undefined> => {
		const timeoutMs = Math.min(limit, Math.floor(deadline - performance.now()));
		if (timeoutMs <= 0) return undefined;
		try { return (await run(command, args, { timeoutMs }))?.toString("utf8"); }
		catch { return undefined; }
	};
	if (platform === "darwin") return (await read("pbpaste", [])) ?? null;
	if (platform === "win32") return (await read("powershell.exe", POWERSHELL_ARGS)) ?? null;
	if (platform !== "linux" || env.TERMUX_VERSION) return null;
	const wsl = isWsl(env, procVersion);
	let text: string | undefined;
	if (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland" || wsl) {
		text = await read("wl-paste", ["--no-newline", "--type", "text"], LINUX_COMMAND_TIMEOUT_MS);
	}
	text ??= await read("xclip", ["-selection", "clipboard", "-out"], LINUX_COMMAND_TIMEOUT_MS);
	text ??= await read("xsel", ["--clipboard", "--output"], LINUX_COMMAND_TIMEOUT_MS);
	if (wsl) text ??= await read("powershell.exe", POWERSHELL_ARGS);
	return text ?? null;
}
