import { describe, it, expect } from 'vitest';
import { parseHelp } from '../src/parser.js';

const find = (opts: any[], f: string) => opts.find((o) => o.flags.includes(f));

describe('GNU/getopt column format (ls, grep, tar)', () => {
  const help = [
    'Usage: ls [OPTION]... [FILE]...',
    'List information about the FILEs.',
    '',
    '  -a, --all                  do not ignore entries starting with .',
    '  -A, --almost-all           do not list implied . and ..',
    '      --block-size=SIZE      with -l, scale sizes by SIZE',
    '  -w, --width=COLS           set output width to COLS',
  ].join('\n');
  const p = parseHelp(help);
  it('collects usage', () => expect(p.usage.join(' ')).toContain('ls [OPTION]'));
  it('parses short+long aliases', () => {
    const a = find(p.options, '-a');
    expect(a.flags).toEqual(['-a', '--all']);
    expect(a.description).toContain('do not ignore');
  });
  it('captures =VALUE arg', () => {
    const bs = find(p.options, '--block-size');
    expect(bs.arg).toBe('SIZE');
  });
  it('long-only option', () => expect(find(p.options, '--block-size').flags).toEqual(['--block-size']));
});

describe('Python argparse-less column-0 format', () => {
  const help = [
    'usage: python3 [option] ... [-c cmd | file] [arg] ...',
    'Options (and corresponding environment variables):',
    '-b     : issue warnings about bytes',
    '-c cmd : program passed in as string',
    '-h     : print this help message and exit',
  ].join('\n');
  const p = parseHelp(help);
  it('finds column-0 flags', () => expect(find(p.options, '-b')).toBeTruthy());
  it('strips colon, keeps desc', () => expect(find(p.options, '-b').description).toBe('issue warnings about bytes'));
  it('captures value placeholder without a column gap', () => expect(find(p.options, '-c').arg).toBe('cmd'));
});

describe('clap/cobra style (OPTIONS: with <VALUE>)', () => {
  const help = [
    'USAGE:',
    '    mytool [OPTIONS] <input>',
    '',
    'OPTIONS:',
    '    -v, --verbose            Use verbose output',
    '    -o, --output <FILE>      Write output to <FILE>',
    '    -j, --jobs <N>           Number of parallel jobs',
  ].join('\n');
  const p = parseHelp(help);
  it('parses <FILE> arg', () => expect(find(p.options, '-o').arg).toBe('<FILE>'));
  it('parses <N> arg', () => expect(find(p.options, '--jobs').arg).toBe('<N>'));
  it('boolean flag has no arg', () => expect(find(p.options, '-v').arg).toBeNull());
});

describe('subcommand list (cobra Available Commands)', () => {
  const help = [
    'Usage:',
    '  tool [command]',
    '',
    'Available Commands:',
    '  build       Compile the project',
    '  test        Run the test suite',
    '  help        Help about any command',
    '',
    'Flags:',
    '  -h, --help   help for tool',
  ].join('\n');
  const p = parseHelp(help);
  it('collects subcommands', () => {
    expect(p.subcommands.map((s) => s.name)).toEqual(['build', 'test', 'help']);
  });
  it('build subcommand has description', () => {
    expect(p.subcommands[0].description).toBe('Compile the project');
  });
  it('still parses flags after commands', () => expect(find(p.options, '-h')).toBeTruthy());
});

describe('multi-line description continuation', () => {
  const help = [
    'Options:',
    '  -x, --extended    a very long description that wraps onto',
    '                    a second indented line here',
    '  -y                short one',
  ].join('\n');
  const p = parseHelp(help);
  it('joins wrapped lines', () => {
    expect(find(p.options, '-x').description).toBe(
      'a very long description that wraps onto a second indented line here',
    );
  });
  it('does not bleed into next option', () => expect(find(p.options, '-y').description).toBe('short one'));
});

describe('robustness', () => {
  it('empty input yields empty model', () => {
    const p = parseHelp('');
    expect(p.options).toHaveLength(0);
    expect(p.subcommands).toHaveLength(0);
  });
  it('de-dupes repeated flag sets', () => {
    const p = parseHelp('Options:\n  -a, --all  first\n  -a, --all  dup\n');
    expect(p.options.filter((o) => o.flags.includes('-a'))).toHaveLength(1);
  });
});
