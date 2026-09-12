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
    const [a] = annotateArgs(['xzvf'], parsed);
    expect(a.kind).toBe('short-cluster');
    expect(a.parts).toHaveLength(4);
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
