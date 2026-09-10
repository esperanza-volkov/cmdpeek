// cmdpeek — pure command-builder logic (no I/O, fully unit-testable).
// The interactive TUI (src/tui.ts) is a thin renderer over this state.

import type { CmdOption, Subcommand, ParsedHelp } from './parser.js';

/** A selectable row in the picker: either an option or a subcommand. */
export type Row =
  | { kind: 'option'; option: CmdOption; label: string; haystack: string }
  | { kind: 'subcommand'; sub: Subcommand; label: string; haystack: string };

/** Preferred flag to emit for an option: longest long-flag, else first flag. */
export function primaryFlag(o: CmdOption): string {
  const longs = o.flags.filter((f) => f.startsWith('--'));
  if (longs.length) return longs.sort((a, b) => b.length - a.length)[0];
  return o.flags[0];
}

/** Stable identity for an option (used as a selection key). */
export function optionKey(o: CmdOption): string {
  return o.flags.join('|');
}

/** Build the flat list of rows from a parsed help model. */
export function buildRows(p: ParsedHelp): Row[] {
  const rows: Row[] = [];
  for (const s of p.subcommands) {
    rows.push({
      kind: 'subcommand',
      sub: s,
      label: s.name,
      haystack: (s.name + ' ' + s.description).toLowerCase(),
    });
  }
  for (const o of p.options) {
    const label = o.flags.join(', ') + (o.arg ? ' ' + o.arg : '');
    rows.push({
      kind: 'option',
      option: o,
      label,
      haystack: (o.flags.join(' ') + ' ' + (o.arg || '') + ' ' + o.description).toLowerCase(),
    });
  }
  return rows;
}

/**
 * Subsequence fuzzy match. Returns a score (higher = better) or -1 for no match.
 * Rewards contiguous runs and early matches; matches against the row haystack.
 */
export function fuzzyScore(query: string, haystack: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  let hi = 0;
  let score = 0;
  let run = 0;
  let firstIdx = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') { run = 0; continue; }
    let found = -1;
    for (let i = hi; i < haystack.length; i++) {
      if (haystack[i] === ch) { found = i; break; }
    }
    if (found === -1) return -1;
    if (firstIdx === -1) firstIdx = found;
    run = found === hi ? run + 1 : 1;
    score += run * 2; // contiguous chars worth more
    hi = found + 1;
  }
  // Prefer matches that start earlier in the haystack.
  score += Math.max(0, 20 - firstIdx);
  return score;
}

/** Filter + rank rows against a query. Empty query keeps original order. */
export function filterRows(rows: Row[], query: string): Row[] {
  if (!query.trim()) return rows;
  const scored: { row: Row; score: number }[] = [];
  for (const row of rows) {
    const s = fuzzyScore(query, row.haystack);
    if (s >= 0) scored.push({ row, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.row);
}

/** Selection state for one option: whether it's on and (if it takes an arg) its value. */
export interface Selection {
  on: boolean;
  value: string; // only meaningful when the option takes an arg
}

export interface BuildState {
  base: string[]; // e.g. ["git", "commit"]
  selected: Map<string, Selection>; // optionKey -> selection
  chosenSub?: string; // a subcommand the user drilled into (appended to base)
}

/** Shell-quote a token if it contains characters that need quoting. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/**
 * Assemble the runnable command string from the current selection.
 * Options are emitted in the order they appear in `order` (the row list),
 * so output is stable and predictable.
 */
export function assembleCommand(
  state: BuildState,
  options: CmdOption[],
): string {
  const parts: string[] = [...state.base];
  if (state.chosenSub) parts.push(state.chosenSub);
  for (const o of options) {
    const key = optionKey(o);
    const sel = state.selected.get(key);
    if (!sel || !sel.on) continue;
    const flag = primaryFlag(o);
    if (o.arg) {
      const v = sel.value.trim();
      const val = v ? shellQuote(v) : o.arg; // placeholder if user left it blank
      if (o.argStyle === 'equals') parts.push(`${flag}=${val}`);
      else { parts.push(flag); parts.push(val); }
    } else {
      parts.push(flag);
    }
  }
  return parts.join(' ');
}

/** Count of currently-enabled options. */
export function selectedCount(state: BuildState): number {
  let n = 0;
  for (const s of state.selected.values()) if (s.on) n++;
  return n;
}
