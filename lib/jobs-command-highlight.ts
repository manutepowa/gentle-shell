// Display-only lexer for simple shell chains. Quoted/escaped operators are
// part of words; redirections do not start a new command. No shell evaluation.
const TOKEN = /(?<redirect>(?:[0-9]+)?(?:<<<|<<-?|<>|<&|>>|>&|>\||[<>])|&>>?)|(?<separator>&&|\|\||\|&|[;&|])|(?<word>(?:\\.|"(?:\\.|[^"\\])*(?:"|$)|'[^']*(?:'|$)|[^\s\\'";&|<>])+)/gu;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z_0-9]*\+?=/;
const EXECUTABLE = /^[\p{L}\p{N}_./][\p{L}\p{N}_./+-]*$/u;

/** Receives the already-cleaned text and adds color without changing any of its cells. */
export function highlightJobsCommand(command: string, paintExecutable: (word: string) => string): string {
	let expectsCommand = true;
	let expectsRedirectTarget = false;
	let result = "";
	let paintedThrough = 0;
	for (const { groups, index } of command.matchAll(TOKEN)) {
		const { separator, redirect, word } = groups!;
		if (separator) {
			expectsCommand = true;
			expectsRedirectTarget = false;
		} else if (redirect) {
			expectsRedirectTarget = true;
		} else if (word?.startsWith("#")) {
			break;
		} else if (expectsRedirectTarget) {
			expectsRedirectTarget = false;
		} else if (expectsCommand && word && !ASSIGNMENT.test(word)) {
			expectsCommand = false;
			if (!EXECUTABLE.test(word)) continue;
			result += command.slice(paintedThrough, index) + paintExecutable(word);
			paintedThrough = index + word.length;
		}
	}
	return result + command.slice(paintedThrough);
}
