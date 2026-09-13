import { describe, it, expect } from 'vitest';
import { annotateArgs } from '../src/explain.js';
import type { ParsedHelp } from '../src/parser.js';

function P(over: Partial<ParsedHelp>): ParsedHelp {
  return { usage: [], options: [], subcommands: [], ...over };
}

describe('annotateArgs', () => {
  it('recognises a long option with description', () => {
    const parsed = P({
      options: [{ flags: ['-v', '--verbose'], arg: null, description: 'be verbose' }],
    });
    const [a] = annotateArgs(['--verbose'], parsed);
    expect(a.kind).toBe('long-option');
    expect(a.unknown).toBe(false);
    expect(a.detail).toMatch(/verbose/);
  });

  it('consumes a space-separated value for a long option', () => {
    const parsed = P({
      options: [{ flags: ['-o', '--output'], arg: '<file>', description: 'write output here' }],
    });
    const anns = annotateArgs(['--output', 'out.txt'], parsed);
    expect(anns).toHaveLength(2);
    expect(anns[0].kind).toBe('long-option');
    expect(anns[1].kind).toBe('option-value');
    expect(anns[1].token).toBe('out.txt');
  });

  it('does not consume next token for --flag=value', () => {
    const parsed = P({
      options: [{ flags: ['--color'], arg: '[WHEN]', argStyle: 'equals', description: 'colorize' }],
    });
    const anns = annotateArgs(['--color=always', 'file'], parsed);
    expect(anns[0].kind).toBe('long-option');
    expect(anns[1].kind).toBe('argument');
    expect(anns[1].token).toBe('file');
  });

  it('flags an unknown long option', () => {
    const [a] = annotateArgs(['--nope'], P({}));
    expect(a.unknown).toBe(true);
    expect(a.detail).toMatch(/not found/i);
  });

  it('splits clustered short options into known parts and consumes a value', () => {
    const parsed = P({
      options: [
        { flags: ['-x'], arg: null, description: 'extract' },
        { flags: ['-z'], arg: null, description: 'gzip' },
        { flags: ['-v'], arg: null, description: 'verbose' },
        { flags: ['-f'], arg: '<file>', description: 'use archive file' },
      ],
    });
    const anns = annotateArgs(['-xzvf', 'a.tgz'], parsed);
    expect(anns[0].kind).toBe('short-cluster');
    expect(anns[0].parts?.map((p) => p.flag)).toEqual(['-x', '-z', '-v', '-f']);
    expect(anns[1].kind).toBe('option-value');
    expect(anns[1].token).toBe('a.tgz');
  });

  it('detects bare old-style clustered options (tar xzvf)', () => {
    const parsed = P({
      options: [
        { flags: ['-x'], arg: null, description: 'extract' },
        { flags: ['-z'], arg: null, description: 'gzip' },
        { flags: ['-v'], arg: null, description: 'verbose' },
        { flags: ['-f'], arg: '<file>', description: 'archive' },
      ],
    });
    const [a] = annotateArgs(['xzvf'], parsed, 'tar');
    expect(a.kind).toBe('short-cluster');
    expect(a.parts).toHaveLength(4);
  });

  it('does NOT treat a bare operand as an old-style cluster for non-listed tools', () => {
    // grep's search pattern `foo` — f, o, o are all valid grep short flags,
    // but grep is not an old-style-cluster tool, so `foo` must stay positional.
    const parsed = P({
      options: [
        { flags: ['-f'], arg: '<file>', description: 'obtain patterns from file' },
        { flags: ['-o'], arg: null, description: 'only matching' },
        { flags: ['-r'], arg: null, description: 'recursive' },
        { flags: ['-n'], arg: null, description: 'line number' },
      ],
    });
    const anns = annotateArgs(['-rn', 'foo', '.'], parsed, 'grep');
    expect(anns[0].kind).toBe('short-cluster'); // -rn
    const foo = anns.find((a) => a.token === 'foo')!;
    expect(foo.kind).toBe('argument');
  });

  it('does not treat a post-flag bare token as a cluster even for old-style tools', () => {
    // Once a dash-flag has appeared, tar is being used in modern syntax; a
    // trailing operand whose letters are valid flags must remain positional.
    const parsed = P({
      options: [
        { flags: ['-x'], arg: null, description: 'extract' },
        { flags: ['-f'], arg: '<file>', description: 'archive' },
        { flags: ['-v'], arg: null, description: 'verbose' },
      ],
    });
    // `vf` after `-x` would be a valid cluster by letters, but must be positional.
    const anns = annotateArgs(['-x', 'vf'], parsed, 'tar');
    const vf = anns.find((a) => a.token === 'vf')!;
    expect(vf.kind).toBe('argument');
  });

  it('does not mistake a filename for a bare cluster', () => {
    const parsed = P({ options: [{ flags: ['-f'], arg: null, description: 'file' }] });
    const [a] = annotateArgs(['foo'], parsed);
    expect(a.kind).toBe('argument');
  });

  it('recognises a subcommand token', () => {
    const parsed = P({ subcommands: [{ name: 'commit', description: 'record changes' }] });
    const [a] = annotateArgs(['commit'], parsed);
    expect(a.kind).toBe('subcommand');
    expect(a.detail).toMatch(/record/);
  });

  it('treats everything after -- as positional', () => {
    const parsed = P({ options: [{ flags: ['-v'], arg: null, description: 'v' }] });
    const anns = annotateArgs(['--', '-v'], parsed);
    expect(anns[0].kind).toBe('separator');
    expect(anns[1].kind).toBe('argument');
  });

  it('splits an attached short value -ofile into flag + value', () => {
    const parsed = P({ options: [{ flags: ['-o'], arg: '<file>', description: 'output' }] });
    const anns = annotateArgs(['-oout.txt'], parsed);
    expect(anns[0].kind).toBe('short-option');
    expect(anns[1].kind).toBe('option-value');
    expect(anns[1].token).toBe('out.txt');
  });
});
