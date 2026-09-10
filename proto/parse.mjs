// cmdpeek help-text parser prototype
// Goal: turn a command's --help output into structured {options, usage, subcommands}
// Empirically tuned against real GNU/BSD/clap/cobra/argparse help formats.
import { execFileSync } from 'node:child_process';

export function getHelp(cmd, args = ['--help']) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 4000 });
  } catch (e) {
    // many tools print help to stderr and exit non-zero
    if (e.stdout || e.stderr) return (e.stdout || '') + (e.stderr || '');
    throw e;
  }
}

// Match an option line. Handles:
//  -x, --xxx        desc
//  --xxx=VALUE      desc
//  -x VALUE         desc
//  --xxx <val>      desc
const OPT_RE = /^\s{1,10}(-[-A-Za-z0-9][^\s]*(?:,?\s+-[-A-Za-z0-9][^\s]*)*)(\s{2,}|\t|$)(.*)$/;
const FLAG_TOKEN_RE = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/;

export function parseHelp(text) {
  const lines = text.split(/\r?\n/);
  const options = [];
  let usage = [];
  const subcommands = [];
  let section = null; // 'usage' | 'options' | 'commands' | null
  let last = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // section headers
    if (/^(usage|synopsis):?$/i.test(trimmed) || /^usage:/i.test(trimmed)) {
      section = 'usage';
      const rest = trimmed.replace(/^usage:?/i, '').trim();
      if (rest) usage.push(rest);
      continue;
    }
    if (/^(options|flags|arguments)\b.*:?$/i.test(trimmed) && trimmed.length < 40) { section = 'options'; last = null; continue; }
    if (/^(commands|subcommands|available commands)\b.*:?$/i.test(trimmed) && trimmed.length < 40) { section = 'commands'; last = null; continue; }

    if (section === 'usage') {
      if (trimmed === '') { section = null; continue; }
      if (/^\S/.test(line)) { section = null; } else { usage.push(trimmed); continue; }
    }

    const m = line.match(OPT_RE);
    if (m) {
      const flagsPart = m[1];
      const desc = (m[3] || '').trim();
      const flags = [];
      let argHint = null;
      for (const tok of flagsPart.split(/,\s*|\s+/)) {
        if (!tok) continue;
        if (FLAG_TOKEN_RE.test(tok.replace(/[=\[].*$/, '')) || /^-{1,2}/.test(tok)) {
          const eq = tok.match(/^(-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)[=\s]?(.*)$/);
          if (eq && /^-{1,2}/.test(eq[1])) { flags.push(eq[1]); if (eq[2]) argHint = eq[2]; }
        } else if (/^[<\[]/.test(tok) || /^[A-Z_]{2,}$/.test(tok)) {
          argHint = tok;
        }
      }
      if (flags.length) {
        last = { flags, arg: argHint, description: desc };
        options.push(last);
        continue;
      }
    }
    // continuation of previous option description (indented, no flag)
    if (last && /^\s{6,}\S/.test(line) && !line.match(OPT_RE) && trimmed) {
      last.description = (last.description + ' ' + trimmed).trim();
      continue;
    }

    // subcommand line:  name   description
    if (section === 'commands') {
      const cm = line.match(/^\s{1,6}([A-Za-z][A-Za-z0-9_-]*)\s{2,}(.+)$/);
      if (cm) { subcommands.push({ name: cm[1], description: cm[2].trim() }); continue; }
    }
  }
  return { usage, options, subcommands };
}

// self-test against installed commands
if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['git','curl','ls','grep','node','tar'];
  for (const t of targets) {
    try {
      const help = getHelp(t);
      const p = parseHelp(help);
      console.log(`\n=== ${t} ===  options=${p.options.length} subcommands=${p.subcommands.length} usage_lines=${p.usage.length}`);
      for (const o of p.options.slice(0, 4)) console.log('   ', o.flags.join(', '), o.arg?('['+o.arg+']'):'', '::', (o.description||'').slice(0,60));
    } catch (e) { console.log(`\n=== ${t} === ERROR ${e.message}`); }
  }
}
