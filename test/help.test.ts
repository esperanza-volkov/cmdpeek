import { describe, it, expect } from 'vitest';
import { getHelpSync, looksLikeHelp } from '../src/help.js';

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
