// cmdpeek — interactive TUI. Zero-dependency: raw-mode stdin + ANSI escapes.
// Thin renderer over the pure logic in builder.ts.

import * as readline from 'node:readline';
import * as tty from 'node:tty';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { ParsedHelp, CmdOption } from './parser.js';
import { parseHelp } from './parser.js';
import { getHelpSync } from './help.js';
import {
  buildRows,
  filterRows,
  assembleCommand,
  optionKey,
  primaryFlag,
  selectedCount,
  type Row,
  type BuildState,
  type Selection,
} from './builder.js';

const ESC = '\x1b[';
const useColor = !process.env.NO_COLOR;
const col = (c: string, s: string) => (useColor ? `${ESC}${c}m${s}${ESC}0m` : s);
const bold = (s: string) => col('1', s);
const dim = (s: string) => col('2', s);
const cyan = (s: string) => col('36', s);
const green = (s: string) => col('32', s);
const yellow = (s: string) => col('33', s);
const inverse = (s: string) => col('7', s);

interface TuiOptions {
  base: string[];
  invocation: string;
  parsed: ParsedHelp;
  /**
   * "Capture" (shell-widget) mode: draw the UI to the controlling terminal
   * (/dev/tty) and read keys from it, while the final assembled command is
   * written to real stdout so a shell widget can capture it via
   * `cmd=$(cmdpeek --print-command ...)`.
   */
  capture?: boolean;
}

/** Try to copy text to the system clipboard. Returns the tool used, or null. */
function copyToClipboard(text: string): string | null {
  const candidates: [string, string[]][] = [
    ['pbcopy', []],
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
  for (const [bin, args] of candidates) {
    try {
      const r = spawnSync(bin, args, { input: text });
      if (r.status === 0 || r.status === null) {
        if (!r.error) return bin;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export function runTui(opts: TuiOptions): Promise<void> {
  return new Promise((resolve) => {
    // These change as the user drills into / out of subcommands.
    let parsed: ParsedHelp = opts.parsed;
    let base: string[] = opts.base;
    let invocation: string = opts.invocation;
    let options: CmdOption[] = parsed.options;
    let allRows = buildRows(parsed);
    let state: BuildState = { base, selected: new Map(), chosenSub: undefined };

    let query = '';
    let cursor = 0; // index into the currently-filtered rows
    let scroll = 0;
    let status = '';
    let promptMode: { key: string; label: string; buf: string } | null = null;

    // Navigation stack: each drilled subcommand pushes the frame it came from,
    // so `left`/back restores the parent view with its selections intact.
    interface Frame {
      parsed: ParsedHelp;
      base: string[];
      invocation: string;
      options: CmdOption[];
      allRows: Row[];
      state: BuildState;
      query: string;
      cursor: number;
      scroll: number;
    }
    const stack: Frame[] = [];

    /** Re-run help for `<base> <sub>` and swap the view into that subcommand. */
    function drillInto(subName: string) {
      const newBase = [...base, subName];
      const help = getHelpSync(newBase[0], newBase.slice(1));
      if (!help) {
        status = `no help for ${newBase.join(' ')}`;
        return;
      }
      const np = parseHelp(help.text);
      if (np.options.length === 0 && np.subcommands.length === 0) {
        status = `no flags/subcommands under ${subName}`;
        return;
      }
      stack.push({ parsed, base, invocation, options, allRows, state, query, cursor, scroll });
      parsed = np;
      base = newBase;
      invocation = help.invocation;
      options = np.options;
      allRows = buildRows(np);
      state = { base, selected: new Map(), chosenSub: undefined };
      query = '';
      cursor = 0;
      scroll = 0;
      status = `▸ ${subName}`;
    }

    /** Pop back to the parent view (restoring its selections). */
    function goBack() {
      const f = stack.pop();
      if (!f) {
        status = 'at top level';
        return;
      }
      parsed = f.parsed;
      base = f.base;
      invocation = f.invocation;
      options = f.options;
      allRows = f.allRows;
      state = f.state;
      query = f.query;
      cursor = f.cursor;
      scroll = f.scroll;
      status = 'back';
    }

    // I/O streams. In normal mode the UI and the final command share stdout.
    // In capture (shell-widget) mode the UI is drawn to /dev/tty and only the
    // assembled command goes to real stdout.
    const capture = !!opts.capture;
    let inFd = -1;
    let outFd = -1;
    let keyIn: NodeJS.ReadStream;
    let out: tty.WriteStream;
    if (capture) {
      inFd = fs.openSync('/dev/tty', 'r');
      outFd = fs.openSync('/dev/tty', 'w');
      keyIn = new tty.ReadStream(inFd) as unknown as NodeJS.ReadStream;
      out = new tty.WriteStream(outFd);
    } else {
      keyIn = process.stdin;
      out = process.stdout as tty.WriteStream;
    }
    const emit = (s: string) => process.stdout.write(s);
    const rows = () => filterRows(allRows, query);

    function render() {
      const width = out.columns || 80;
      const height = out.rows || 24;
      const filtered = rows();
      if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);

      const lines: string[] = [];
      // Header
      lines.push(
        bold('cmdpeek ') + cyan(base.join(' ')) + dim(`  (from: ${invocation})`),
      );
      lines.push(
        dim(
          `${parsed.options.length} options · ${parsed.subcommands.length} subcommands · ` +
            `${selectedCount(state)} selected`,
        ),
      );
      // Filter line
      lines.push(bold('/') + ' ' + (query ? query : dim('type to filter')) + '\u2588');
      lines.push(dim('─'.repeat(Math.min(width, 78))));

      // List area
      const reserved = lines.length + 6; // header+filter + footer/preview
      const listH = Math.max(3, height - reserved);
      if (cursor < scroll) scroll = cursor;
      if (cursor >= scroll + listH) scroll = cursor - listH + 1;
      const view = filtered.slice(scroll, scroll + listH);

      if (filtered.length === 0) {
        lines.push(dim('  (no matches)'));
      }
      view.forEach((row, i) => {
        const idx = scroll + i;
        const active = idx === cursor;
        let mark = '  ';
        let label = row.label;
        if (row.kind === 'option') {
          const sel = state.selected.get(optionKey(row.option));
          mark = sel?.on ? green('◉ ') : '○ ';
        } else {
          mark = cyan('▸ ');
        }
        let text = mark + label;
        if (active) text = inverse(text.padEnd(Math.min(width - 1, 76)));
        lines.push(' ' + text);
      });

      // Description of the active row
      lines.push(dim('─'.repeat(Math.min(width, 78))));
      const active = filtered[cursor];
      if (active) {
        const desc =
          active.kind === 'option' ? active.option.description : active.sub.description;
        lines.push('  ' + (desc ? dim(clip(desc, width - 4)) : dim('(no description)')));
      } else {
        lines.push('');
      }

      // Live command preview
      const cmd = assembleCommand(state, options);
      lines.push(bold('$ ') + green(clip(cmd, width - 3)));

      // Footer / status
      if (promptMode) {
        lines.push(
          yellow(`value for ${promptMode.label}: `) + promptMode.buf + '\u2588  ' + dim('(enter=ok, esc=cancel)'),
        );
      } else {
        const hint = stack.length
          ? '↑↓ move · tab toggle/drill · ← back · ^e value · ^y copy · enter print · esc quit'
          : '↑↓ move · tab toggle · → drill subcommand · ^e value · ^y copy · enter print · esc quit';
        lines.push(dim(hint) + (status ? '   ' + yellow(status) : ''));
      }

      // Paint: clear screen, home, write.
      out.write(ESC + '2J' + ESC + 'H' + lines.join('\n'));
    }

    function clip(s: string, n: number): string {
      if (n <= 1) return '';
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function toggleActive() {
      const filtered = rows();
      const row = filtered[cursor];
      if (!row) return;
      if (row.kind === 'subcommand') {
        // Re-run `<base> <sub> --help`, parse it, and drill into that view.
        drillInto(row.sub.name);
        return;
      }
      const key = optionKey(row.option);
      const cur = state.selected.get(key) || { on: false, value: '' };
      const next: Selection = { on: !cur.on, value: cur.value };
      state.selected.set(key, next);
      // If turning on an option that needs a value and none set, prompt for it.
      if (next.on && row.option.arg && !next.value) {
        promptMode = { key, label: primaryFlag(row.option) + ' ' + row.option.arg, buf: '' };
      }
    }

    function editActive() {
      const filtered = rows();
      const row = filtered[cursor];
      if (!row || row.kind !== 'option' || !row.option.arg) {
        status = 'that row takes no value';
        return;
      }
      const key = optionKey(row.option);
      const cur = state.selected.get(key) || { on: true, value: '' };
      state.selected.set(key, { on: true, value: cur.value });
      promptMode = { key, label: primaryFlag(row.option) + ' ' + row.option.arg, buf: cur.value };
    }

    function cleanup() {
      if (keyIn.isTTY) keyIn.setRawMode(false);
      keyIn.pause();
      keyIn.removeListener('keypress', onKey);
      out.write(ESC + '2J' + ESC + 'H');
      out.write(ESC + '?25h'); // restore cursor
      if (capture) {
        try {
          (keyIn as unknown as tty.ReadStream).destroy();
        } catch {
          /* ignore */
        }
        try {
          fs.closeSync(inFd);
        } catch {
          /* ignore */
        }
        try {
          out.end();
        } catch {
          /* ignore */
        }
      }
    }

    function finishPrint() {
      cleanup();
      const cmd = assembleCommand(state, options);
      emit(cmd + '\n');
      resolve();
    }

    function onKey(str: string | undefined, k: readline.Key) {
      const filtered = rows();
      if (promptMode) {
        if (k.name === 'return') {
          const sel = state.selected.get(promptMode.key) || { on: true, value: '' };
          state.selected.set(promptMode.key, { on: true, value: promptMode.buf });
          promptMode = null;
        } else if (k.name === 'escape') {
          promptMode = null;
        } else if (k.name === 'backspace') {
          promptMode.buf = promptMode.buf.slice(0, -1);
        } else if (str && !k.ctrl && !k.meta && str.length === 1 && str >= ' ') {
          promptMode.buf += str;
        }
        render();
        return;
      }

      // Ctrl chords (checked first so letters stay free for filtering).
      if (k.ctrl) {
        switch (k.name) {
          case 'c':
            cleanup();
            resolve();
            return;
          case 'y': {
            const cmd = assembleCommand(state, options);
            const tool = copyToClipboard(cmd);
            status = tool ? `copied (${tool})` : 'no clipboard tool found';
            render();
            return;
          }
          case 'e':
            status = '';
            editActive();
            render();
            return;
          case 'u': // clear query (readline convention)
            query = '';
            cursor = 0;
            render();
            return;
          default:
            return; // ignore other ctrl chords
        }
      }

      switch (k.name) {
        case 'up':
          cursor = Math.max(0, cursor - 1);
          break;
        case 'down':
          cursor = Math.min(filtered.length - 1, cursor + 1);
          break;
        case 'pageup':
          cursor = Math.max(0, cursor - 10);
          break;
        case 'pagedown':
          cursor = Math.min(filtered.length - 1, cursor + 10);
          break;
        case 'tab':
          status = '';
          toggleActive();
          break;
        case 'right': {
          // Drill into a subcommand row (leaves option rows unchanged).
          const row = filtered[cursor];
          if (row && row.kind === 'subcommand') {
            status = '';
            drillInto(row.sub.name);
          }
          break;
        }
        case 'left':
          status = '';
          goBack();
          break;
        case 'return':
          finishPrint();
          return;
        case 'backspace':
          query = query.slice(0, -1);
          cursor = 0;
          break;
        case 'escape':
          if (query) { query = ''; cursor = 0; }
          else if (stack.length) { status = ''; goBack(); }
          else { cleanup(); resolve(); return; }
          break;
        default:
          // Any printable char (incl. space) filters.
          if (str && str.length === 1 && str >= ' ' && !k.meta) {
            query += str;
            cursor = 0;
          }
      }
      render();
    }

    readline.emitKeypressEvents(keyIn);
    if (keyIn.isTTY) keyIn.setRawMode(true);
    keyIn.resume();
    keyIn.on('keypress', onKey);
    out.write(ESC + '?25l'); // hide cursor
    render();

    // restore cursor on exit
    const restore = () => out.write(ESC + '?25h');
    process.once('exit', restore);
  });
}
