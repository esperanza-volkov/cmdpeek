#!/usr/bin/env node
import { getHelp, getMan } from './help.js';
import { parseHelp, type ParsedHelp } from './parser.js';
import { runTui } from './tui.js';
import { shellWidget } from './shell.js';
import { explainCommand, type Annotation } from './explain.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const cyan = (s: string) => c('36', s);
const green = (s: string) => c('32', s);
const dim = (s: string) => c('2', s);

const VERSION = '0.6.0';

function printReference(cmd: string, invocation: string, p: ParsedHelp) {
  const out: string[] = [];
  out.push(bold(cmd) + dim(`  (parsed from: ${invocation})`));
  if (p.usage.length) {
    out.push('');
    out.push(bold('Usage'));
    for (const u of p.usage) out.push('  ' + u);
  }
  if (p.subcommands.length) {
    out.push('');
    out.push(bold(`Subcommands (${p.subcommands.length})`));
    const w = Math.min(24, Math.max(...p.subcommands.map((s) => s.name.length)));
    for (const s of p.subcommands) out.push('  ' + green(s.name.padEnd(w)) + '  ' + dim(s.description));
  }
  if (p.options.length) {
    out.push('');
    out.push(bold(`Options (${p.options.length})`));
    for (const o of p.options) {
      const head = o.flags.map(cyan).join(', ') + (o.arg ? ' ' + green(o.arg) : '');
      out.push('  ' + head);
      if (o.description) out.push('      ' + dim(o.description));
    }
  }
  if (!p.options.length && !p.subcommands.length) {
    out.push('');
    out.push(dim('No options or subcommands recognised in the help text.'));
    out.push(dim('This tool may use a non-standard help format; try `--raw`.'));
  }
  process.stdout.write(out.join('\n') + '\n');
}

const yellow = (s: string) => c('33', s);
const red = (s: string) => c('31', s);

async function runExplain(tokens: string[]) {
  let res;
  try {
    res = await explainCommand(tokens);
  } catch (e: any) {
    process.stderr.write((e?.message || String(e)) + '\n');
    process.exit(1);
    return;
  }
  const out: string[] = [];
  out.push(bold(res.command.join(' ')) + dim(`  (explained from: ${res.invocation})`));
  out.push('');
  const label = (a: Annotation): string => {
    switch (a.kind) {
      case 'subcommand':
        return green(a.token);
      case 'long-option':
      case 'short-option':
      case 'short-cluster':
        return a.unknown ? red(a.token) : cyan(a.token);
      case 'option-value':
        return yellow(a.token);
      case 'separator':
        return dim(a.token);
      default:
        return a.token;
    }
  };
  const width = Math.min(28, Math.max(4, ...res.annotations.map((a) => a.token.length)));
  for (const a of res.annotations) {
    const head = '  ' + label(a).padEnd(width + (label(a).length - a.token.length));
    if (a.parts && a.parts.length > 1) {
      out.push(head + '  ' + dim(a.detail));
      for (const p of a.parts) {
        const pf = p.known ? cyan(p.flag) : red(p.flag);
        out.push('      ' + pf.padEnd(4 + (pf.length - p.flag.length)) + '  ' + dim(p.description));
      }
    } else {
      out.push(head + '  ' + dim(a.detail));
    }
  }
  if (res.annotations.length === 0) {
    out.push(dim('  (no arguments to explain)'));
  }
  process.stdout.write(out.join('\n') + '\n');
}

const HELP_TEXT = `cmdpeek v${VERSION} — interactive flag explorer & command builder for any CLI.

Reads a command's own --help and turns it into an interactive, fuzzy-searchable
picker where you toggle flags and copy the assembled command. Local-first, no
curated database. Built & maintained by an autonomous AI agent (Esperanza Volkov).

Usage:
  cmdpeek <command> [subcommand...]   Interactive builder for <command> (default on a TTY)
  cmdpeek explain <command line...>   Annotate an existing command line, flag by flag
  cmdpeek <command> --ref             Print a static parsed reference instead
  cmdpeek <command> --json            Emit the parsed structure as JSON
  cmdpeek <command> --raw             Print the raw help text cmdpeek parsed
  cmdpeek <command> --man             Build from the command's man page instead of --help
  cmdpeek --shell <bash|zsh|fish>     Print a Ctrl-G shell widget to source
  cmdpeek --version
  cmdpeek --help

Explain mode:  paste any command line and cmdpeek breaks it down using the
               tool's OWN --help — a local, offline explainshell that works on
               every CLI on your PATH (including your own scripts):
                 cmdpeek explain tar xzvf archive.tar.gz
                 cmdpeek explain git commit -am "wip" --no-verify

Shell widget:  add  eval "$(cmdpeek --shell zsh)"  to your rc file, then type a
               command name and press Ctrl-G to build its flags interactively —
               the assembled command lands right back on your prompt.

Keys (interactive):  type to filter · ↑↓ move · tab toggle · → drill into a
                     subcommand · ← back · ^e edit value · ^y copy
                     enter print & quit · esc/^c quit

Subcommands: point cmdpeek at a tool with subcommands (git, pip, apt,
systemctl, ...) and press → (or tab) on a subcommand to re-parse its own
--help and build that command; ← returns to the parent.

Examples:
  cmdpeek tar
  cmdpeek git            # browse subcommands, drill into one, build it
  cmdpeek git commit     # jump straight to a subcommand
  cmdpeek curl --json | jq '.options[].flags'
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    process.stdout.write(VERSION + '\n');
    return;
  }
  // `cmdpeek explain <command line...>` annotates an existing command line.
  if (argv[0] === 'explain' || argv[0] === '--explain') {
    const tokens = argv.slice(1);
    if (tokens.length === 0) {
      process.stderr.write('Usage: cmdpeek explain <command line...>\n');
      process.exit(1);
    }
    await runExplain(tokens);
    return;
  }
  // `cmdpeek --shell <bash|zsh|fish>` prints a shell keybinding widget.
  if (argv[0] === '--shell') {
    const shell = argv[1];
    const snippet = shellWidget(shell);
    if (!snippet) {
      process.stderr.write('Usage: cmdpeek --shell <bash|zsh|fish>\n');
      process.exit(1);
    }
    process.stdout.write(snippet);
    return;
  }

  const jsonMode = argv.includes('--json');
  const rawMode = argv.includes('--raw');
  const refMode = argv.includes('--ref') || argv.includes('--reference');
  // Capture/shell-widget mode: draw UI on /dev/tty, emit only the built command
  // to stdout so a shell widget can capture it.
  const captureMode = argv.includes('--print-command');
  // Force the man-page source (otherwise man is only a fallback for --help).
  const manMode = argv.includes('--man');
  const FLAGS = new Set(['--json', '--raw', '--ref', '--reference', '--print-command', '--man']);
  const rest = argv.filter((a) => !FLAGS.has(a));
  const cmd = rest[0];
  const subArgs = rest.slice(1);

  let help;
  try {
    if (manMode) {
      const m = subArgs.length === 0 ? await getMan(cmd) : null;
      if (!m) throw new Error(`cmdpeek: no usable man page for "${cmd}".`);
      help = m;
    } else {
      help = await getHelp(cmd, subArgs);
    }
  } catch (e: any) {
    process.stderr.write((e?.message || String(e)) + '\n');
    process.exit(1);
  }
  if (rawMode) {
    process.stdout.write(help.text);
    return;
  }
  const parsed = parseHelp(help.text);
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({ command: cmd, invocation: help.invocation, ...parsed }, null, 2) + '\n',
    );
    return;
  }

  const havePickable = parsed.options.length > 0 || parsed.subcommands.length > 0;

  // Capture (shell-widget) mode: UI on /dev/tty, built command to stdout.
  if (captureMode && !refMode && havePickable) {
    await runTui({ base: [cmd, ...subArgs], invocation: help.invocation, parsed, capture: true });
    return;
  }

  // Interactive by default when we're on a TTY and there's something to pick.
  const interactive = !refMode && process.stdin.isTTY && process.stdout.isTTY && havePickable;
  if (interactive) {
    await runTui({ base: [cmd, ...subArgs], invocation: help.invocation, parsed });
    return;
  }

  printReference([cmd, ...subArgs].join(' '), help.invocation, parsed);
}

main();
