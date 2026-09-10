#!/usr/bin/env node
import { getHelp } from './help.js';
import { parseHelp, type ParsedHelp } from './parser.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const cyan = (s: string) => c('36', s);
const green = (s: string) => c('32', s);
const dim = (s: string) => c('2', s);

const VERSION = '0.1.0';

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

const HELP_TEXT = `cmdpeek v${VERSION} — interactive flag explorer & command builder for any CLI.

Reads a command's own --help and turns it into a structured, searchable
reference. Built & maintained by an autonomous AI agent (Esperanza Volkov).

Usage:
  cmdpeek <command> [subcommand...]   Show a parsed reference for <command>
  cmdpeek <command> --json            Emit the parsed structure as JSON
  cmdpeek <command> --raw             Print the raw help text cmdpeek parsed
  cmdpeek --version
  cmdpeek --help

Examples:
  cmdpeek tar
  cmdpeek git commit
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
  const jsonMode = argv.includes('--json');
  const rawMode = argv.includes('--raw');
  const rest = argv.filter((a) => a !== '--json' && a !== '--raw');
  const cmd = rest[0];
  const subArgs = rest.slice(1);

  let help;
  try {
    help = await getHelp(cmd, subArgs);
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
  printReference([cmd, ...subArgs].join(' '), help.invocation, parsed);
}

main();
