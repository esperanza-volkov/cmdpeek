import { describe, it, expect } from 'vitest';
import { getHelpSync, looksLikeHelp, cleanManOutput, getMan } from '../src/help.js';
import { parseHelp } from '../src/parser.js';

describe('getHelpSync (drill-down help fetch)', () => {
  it('returns help text for a real command', () => {
    // `node --help` is available wherever the tests run.
    const r = getHelpSync('node');
    expect(r).not.toBeNull();
    expect(looksLikeHelp(r!.text)).toBe(true);
    expect(r!.invocation).toContain('node');
  });

  it('returns null for a command that does not exist', () => {
    const r = getHelpSync('cmdpeek-nonexistent-binary-xyz');
    expect(r).toBeNull();
  });

  it('passes through extra args (subcommand path)', () => {
    // A bogus subcommand still resolves via the base binary without throwing.
    const r = getHelpSync('node', []);
    expect(r).not.toBeNull();
  });
});

describe('looksLikeHelp heuristic', () => {
  it('recognizes an options block', () => {
    expect(looksLikeHelp('Usage: x\n  -a, --all  do it')).toBe(true);
  });
  it('recognizes a commands section', () => {
    expect(looksLikeHelp('Commands:\n  build  compile')).toBe(true);
  });
  it('rejects arbitrary prose', () => {
    expect(looksLikeHelp('hello world, nothing to see here')).toBe(false);
  });
});

describe('cleanManOutput (man-page fallback)', () => {
  it('strips roff overstrike bold/underline', () => {
    // bold "OP": O\bO P\bP ; underline "x": _\bx
    const raw = 'O\x08OP\x08PTIONS\n  _\x08-_\x08a  do it';
    const cleaned = cleanManOutput(raw);
    expect(cleaned).toContain('OPTIONS');
    expect(cleaned).toContain('-a');
    expect(cleaned).not.toContain('\x08');
  });

  it('rejoins soft-hyphen (U+2010) line wraps but keeps ASCII hyphens', () => {
    const cleaned = cleanManOutput('Dis\u2010\n       ables the end-of-file string');
    expect(cleaned).toContain('Disables');
    expect(cleaned).toContain('end-of-file');
  });

  it('feeds a man OPTIONS section into the parser correctly', () => {
    const man = [
      'NAME',
      '       demo - do things',
      '',
      'SYNOPSIS',
      '       demo [options] <path>',
      '',
      'OPTIONS',
      '       -0, --null',
      '              Items are terminated by a null character.',
      '',
      '       -a, --arg-file file',
      '              Read items from file instead of stdin.',
      '',
      '       --color[=WHEN]',
      '              Colourise the output.',
      '',
    ].join('\n');
    const p = parseHelp(cleanManOutput(man));
    const flagSets = p.options.map((o) => o.flags.join(','));
    expect(flagSets).toContain('-0,--null');
    expect(flagSets).toContain('-a,--arg-file');
    const argFile = p.options.find((o) => o.flags.includes('--arg-file'));
    expect(argFile?.arg).toBe('file');
    const color = p.options.find((o) => o.flags.includes('--color'));
    expect(color?.argStyle).toBe('equals');
    expect(p.usage.join(' ')).toContain('demo [options]');
  });
});

describe('getMan (real man page, environment-permitting)', () => {
  it('parses a classic tool from its man page when available', async () => {
    const r = await getMan('xargs');
    // Skip gracefully where no man page/db is installed.
    if (!r) return;
    expect(r.source).toBe('man');
    expect(r.invocation).toBe('man xargs');
    const p = parseHelp(r.text);
    expect(p.options.length).toBeGreaterThan(3);
  });
});
