import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

/** Candidate help invocations, tried in order until one yields option-looking text. */
const HELP_ARGS: string[][] = [['--help'], ['-h'], ['help']];

export interface HelpResult {
  text: string;
  invocation: string;
}

function looksLikeHelp(t: string): boolean {
  return /(^|\n)\s*-{1,2}[A-Za-z]/.test(t) || /usage:/i.test(t) || /commands?:/i.test(t);
}

/** Run `<cmd> <helpflag>` and return the best help text we can obtain. */
export async function getHelp(cmd: string, extra: string[] = []): Promise<HelpResult> {
  let firstErr: unknown = null;
  for (const args of HELP_ARGS) {
    const full = [...extra, ...args];
    try {
      const { stdout, stderr } = await pexec(cmd, full, {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = (stdout || '') + (stderr || '');
      if (looksLikeHelp(text)) return { text, invocation: `${cmd} ${full.join(' ')}`.trim() };
    } catch (e: any) {
      // Many CLIs print help to stderr and exit non-zero.
      const text = (e?.stdout || '') + (e?.stderr || '');
      if (looksLikeHelp(text)) return { text, invocation: `${cmd} ${full.join(' ')}`.trim() };
      firstErr = firstErr ?? e;
    }
  }
  throw new Error(
    `cmdpeek: could not get help text from "${cmd}". ` +
      `Tried --help, -h, help. ${firstErr instanceof Error ? '(' + firstErr.message + ')' : ''}`,
  );
}
