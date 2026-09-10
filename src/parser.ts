// cmdpeek — help-text parser.
// Turns a command's --help output into a structured model of options and
// subcommands. Empirically tuned against GNU/BSD getopt, Python argparse,
// Rust clap, Go cobra/pflag, and Node commander/yargs help formats.

export interface CmdOption {
  /** Every flag alias for this option, e.g. ["-a", "--all"]. */
  flags: string[];
  /** Argument placeholder if the option takes a value, e.g. "<file>" or "N". */
  arg: string | null;
  /** How the value attaches: "space" → `--flag val`; "equals" → `--flag=val`. */
  argStyle?: 'space' | 'equals';
  /** Human description (may be joined from continuation lines). */
  description: string;
}

export interface Subcommand {
  name: string;
  description: string;
}

export interface ParsedHelp {
  usage: string[];
  options: CmdOption[];
  subcommands: Subcommand[];
}

// An option line begins with 1..10 leading spaces then a dash-flag.
// Handles:  "-x, --xxx  desc" | "--xxx=VAL  desc" | "-x VAL  desc" | "--xxx <val>  desc"
const OPT_RE =
  /^(\s{1,10})(-[-A-Za-z0-9][^\s,]*(?:(?:,\s*|\s+)-[-A-Za-z0-9][^\s,]*)*)(.*)$/;
// Same but allows column-0 flags (used only inside a detected options section,
// e.g. Python argparse-less tools that print "-b     : desc" at column 0).
const OPT_RE0 =
  /^(\s{0,10})(-[-A-Za-z0-9][^\s,]*(?:(?:,\s*|\s+)-[-A-Za-z0-9][^\s,]*)*)(.*)$/;

const SECTION_OPTIONS =
  /^(options|flags|optional arguments|positional arguments|arguments|global flags|general options)\b/i;
const SECTION_COMMANDS =
  /^(commands|subcommands|available commands|management commands|core commands)\b/i;
const SECTION_USAGE = /^(usage|synopsis)\b/i;

function splitFlagsAndDesc(rest: string): { flagPart: string; desc: string } {
  // `rest` is the flags blob + arg hint + description mixed together.
  // Separate on the first run of >=2 spaces (the classic help column gap).
  const gap = rest.search(/\s{2,}/);
  let flagPart: string;
  let desc: string;
  if (gap !== -1) {
    flagPart = rest.slice(0, gap).trim();
    desc = rest.slice(gap).trim();
  } else {
    // No column gap. Some tools (Python) use "-c cmd : description" with only
    // single spaces — fall back to splitting on a " : " separator.
    const colon = rest.search(/\s:\s/);
    if (colon !== -1) { flagPart = rest.slice(0, colon).trim(); desc = rest.slice(colon + 2).trim(); }
    else { flagPart = rest.trim(); desc = ''; }
  }
  // Strip a leading colon left over from "-b     : description" style.
  desc = desc.replace(/^:\s*/, '');
  return { flagPart, desc };
}

function extractFlags(flagBlob: string): {
  flags: string[];
  arg: string | null;
  argStyle: 'space' | 'equals';
} {
  const flags: string[] = [];
  let arg: string | null = null;
  let argStyle: 'space' | 'equals' = 'space';
  // Tokenise on commas and whitespace but keep <..> and [..] together.
  const tokens = flagBlob.match(/<[^>]+>|\[[^\]]+\]|[^\s,]+/g) || [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;
    if (/^[-]{1,2}/.test(tok)) {
      // Forms: "--name", "-n", "--name=VALUE", "--name[=VALUE]", "--name[=WHEN]".
      const eq = tok.match(
        /^(-{1,2}[A-Za-z0-9?][A-Za-z0-9?-]*)(\[=[^\]]*\]|=\S*|[=\s].*)?$/,
      );
      if (eq) {
        flags.push(eq[1]);
        if (eq[2]) {
          const rawArg = eq[2];
          // "=VAL" or "[=VAL]" → equals-attached; " VAL" → space-attached.
          if (/^\[?=/.test(rawArg)) argStyle = 'equals';
          const a = rawArg
            .replace(/^\[?=?\s*/, '')
            .replace(/\]$/, '')
            .trim();
          if (a) arg = a;
        }
      }
    } else if (!tok.startsWith(':')) {
      // Any non-flag token left in the flags column is the value placeholder
      // (e.g. <file>, [DIR], FILE, cmd, mod). Description was already split off.
      arg = tok;
    }
  }
  return { flags, arg, argStyle };
}

export function parseHelp(text: string): ParsedHelp {
  const lines = text.split(/\r?\n/);
  const options: CmdOption[] = [];
  const usage: string[] = [];
  const subcommands: Subcommand[] = [];
  let section: 'usage' | 'options' | 'commands' | null = null;
  let last: CmdOption | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // --- Section headers -------------------------------------------------
    if (SECTION_USAGE.test(trimmed)) {
      section = 'usage';
      last = null;
      const rest = trimmed.replace(/^(usage|synopsis):?/i, '').trim();
      if (rest) usage.push(rest);
      continue;
    }
    const headerish = trimmed.length < 60 && (trimmed.endsWith(':') || trimmed.length < 40);
    if (headerish && SECTION_OPTIONS.test(trimmed)) {
      section = 'options';
      last = null;
      continue;
    }
    if (headerish && SECTION_COMMANDS.test(trimmed)) {
      section = 'commands';
      last = null;
      continue;
    }

    // --- Usage block continuation ---------------------------------------
    if (section === 'usage') {
      if (trimmed === '') { section = null; continue; }
      // Usage lines are typically indented; a non-indented line ends the block.
      // But an option line (starts with dash after indent) also ends it so we
      // don't swallow the OPTIONS list that follows without a blank line (curl).
      if (/^\S/.test(line) || OPT_RE.test(line)) {
        section = null;
        // fall through to option handling below
      } else {
        usage.push(trimmed);
        continue;
      }
    }

    // --- Option lines ----------------------------------------------------
    // Inside a detected options section, also accept column-0 flags (Python).
    const m = line.match(OPT_RE) || (section === 'options' ? line.match(OPT_RE0) : null);
    if (m) {
      const combined = m[2] + m[3];
      const { flagPart, desc } = splitFlagsAndDesc(combined);
      const { flags, arg, argStyle } = extractFlags(flagPart);
      if (flags.length) {
        last = { flags, arg, argStyle, description: desc };
        options.push(last);
        continue;
      }
    }

    // --- Continuation of previous option description --------------------
    if (last && /^\s{4,}\S/.test(line) && trimmed && !OPT_RE.test(line)) {
      last.description = (last.description + ' ' + trimmed).trim();
      continue;
    }

    // --- Subcommand rows -------------------------------------------------
    if (section === 'commands') {
      const cm = line.match(/^\s{1,6}([A-Za-z][A-Za-z0-9:_-]*)\s{2,}(.+)$/);
      if (cm) { subcommands.push({ name: cm[1], description: cm[2].trim() }); continue; }
    }
  }

  // De-dupe options that share the exact same flag set (some tools repeat).
  const seen = new Set<string>();
  const deduped = options.filter((o) => {
    const k = o.flags.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { usage, options: deduped, subcommands };
}
