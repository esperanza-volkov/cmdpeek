import { describe, it, expect } from 'vitest';
import { shellWidget } from '../src/shell.js';

describe('shellWidget', () => {
  it('returns null for unknown / missing shells', () => {
    expect(shellWidget(undefined)).toBeNull();
    expect(shellWidget('tcsh')).toBeNull();
    expect(shellWidget('')).toBeNull();
  });

  it('bash widget binds Ctrl-G and captures via --print-command on /dev/tty', () => {
    const w = shellWidget('bash')!;
    expect(w).toContain('bind -x');
    expect(w).toContain('\\C-g');
    expect(w).toContain('cmdpeek --print-command');
    expect(w).toContain('</dev/tty');
    expect(w).toContain('READLINE_LINE');
  });

  it('zsh widget registers a zle widget bound to ^g', () => {
    const w = shellWidget('zsh')!;
    expect(w).toContain('zle -N _cmdpeek_widget');
    expect(w).toContain("bindkey '^g'");
    expect(w).toContain('cmdpeek --print-command');
    expect(w).toContain('BUFFER');
  });

  it('fish widget defines a function bound to ctrl-g', () => {
    const w = shellWidget('fish')!;
    expect(w).toContain('function _cmdpeek_widget');
    expect(w).toContain('bind \\cg');
    expect(w).toContain('commandline');
    expect(w).toContain('cmdpeek --print-command');
  });

  it('all widgets read the current prompt and are self-contained', () => {
    for (const s of ['bash', 'zsh', 'fish'] as const) {
      const w = shellWidget(s)!;
      expect(w.startsWith('# cmdpeek shell widget')).toBe(true);
      expect(w.endsWith('\n')).toBe(true);
    }
  });
});
