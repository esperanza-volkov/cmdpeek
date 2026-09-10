import { describe, it, expect } from 'vitest';
import {
  primaryFlag,
  optionKey,
  buildRows,
  fuzzyScore,
  filterRows,
  assembleCommand,
  shellQuote,
  selectedCount,
  type BuildState,
} from '../src/builder.js';
import type { CmdOption, ParsedHelp } from '../src/parser.js';

const opt = (flags: string[], arg: string | null = null, description = ''): CmdOption => ({
  flags,
  arg,
  description,
});

describe('primaryFlag', () => {
  it('prefers the longest long flag', () => {
    expect(primaryFlag(opt(['-a', '--all']))).toBe('--all');
    expect(primaryFlag(opt(['--color', '--colour']))).toBe('--colour');
  });
  it('falls back to first flag when no long flag', () => {
    expect(primaryFlag(opt(['-h']))).toBe('-h');
  });
});

describe('shellQuote', () => {
  it('leaves safe tokens alone', () => {
    expect(shellQuote('file.txt')).toBe('file.txt');
    expect(shellQuote('/etc/hosts')).toBe('/etc/hosts');
  });
  it('quotes tokens with spaces and specials', () => {
    expect(shellQuote('two words')).toBe("'two words'");
    expect(shellQuote('a$b')).toBe("'a$b'");
    expect(shellQuote('')).toBe("''");
  });
  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('fuzzyScore / filterRows', () => {
  const p: ParsedHelp = {
    usage: [],
    options: [
      opt(['-a', '--all'], null, 'do not ignore entries starting with .'),
      opt(['-l'], null, 'use a long listing format'),
      opt(['--color'], 'WHEN', 'colorize the output'),
    ],
    subcommands: [{ name: 'status', description: 'show status' }],
  };
  const rows = buildRows(p);

  it('empty query keeps order', () => {
    expect(filterRows(rows, '').length).toBe(rows.length);
  });
  it('finds by flag', () => {
    const r = filterRows(rows, 'all');
    expect(r[0].kind).toBe('option');
    expect((r[0] as any).option.flags).toContain('--all');
  });
  it('finds by description word', () => {
    const r = filterRows(rows, 'coloriz');
    expect(r.length).toBeGreaterThan(0);
    expect((r[0] as any).option.flags).toContain('--color');
  });
  it('non-matching query returns nothing', () => {
    expect(filterRows(rows, 'zzzzzz').length).toBe(0);
  });
  it('scores contiguous matches higher', () => {
    expect(fuzzyScore('all', 'all entries')).toBeGreaterThan(fuzzyScore('all', 'a l l'));
  });
});

describe('assembleCommand', () => {
  const options: CmdOption[] = [
    opt(['-a', '--all']),
    opt(['-l']),
    opt(['--color'], 'WHEN'),
  ];
  const p: ParsedHelp = { usage: [], options, subcommands: [] };

  it('base only when nothing selected', () => {
    const st: BuildState = { base: ['ls'], selected: new Map() };
    expect(assembleCommand(st, options)).toBe('ls');
    expect(selectedCount(st)).toBe(0);
  });

  it('emits selected boolean flags in option order', () => {
    const st: BuildState = { base: ['ls'], selected: new Map() };
    st.selected.set(optionKey(options[1]), { on: true, value: '' });
    st.selected.set(optionKey(options[0]), { on: true, value: '' });
    expect(assembleCommand(st, options)).toBe('ls --all -l');
    expect(selectedCount(st)).toBe(2);
  });

  it('emits value for options that take an arg, quoting as needed', () => {
    const st: BuildState = { base: ['ls'], selected: new Map() };
    st.selected.set(optionKey(options[2]), { on: true, value: 'always' });
    expect(assembleCommand(st, options)).toBe('ls --color always');
  });

  it('uses the placeholder when an arg option has no value yet', () => {
    const st: BuildState = { base: ['ls'], selected: new Map() };
    st.selected.set(optionKey(options[2]), { on: true, value: '' });
    expect(assembleCommand(st, options)).toBe('ls --color WHEN');
  });

  it('emits equals-attached values for argStyle=equals', () => {
    const eqOpt: CmdOption = { flags: ['--color'], arg: 'WHEN', argStyle: 'equals', description: '' };
    const opts = [eqOpt];
    const st: BuildState = { base: ['ls'], selected: new Map() };
    st.selected.set(optionKey(eqOpt), { on: true, value: 'always' });
    expect(assembleCommand(st, opts)).toBe('ls --color=always');
  });

  it('appends a chosen subcommand after base', () => {
    const st: BuildState = { base: ['git'], selected: new Map(), chosenSub: 'commit' };
    expect(assembleCommand(st, options)).toBe('git commit');
  });

  it('ignores toggled-off options', () => {
    const st: BuildState = { base: ['ls'], selected: new Map() };
    st.selected.set(optionKey(options[0]), { on: false, value: '' });
    expect(assembleCommand(st, options)).toBe('ls');
  });
});
