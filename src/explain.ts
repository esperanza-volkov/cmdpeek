// cmdpeek — `explain` mode.
// Annotates an existing command line token-by-token using the invoked tool's
// OWN `--help` (or man page). Think explainshell, but local-first, zero-dep,
// and not limited to a curated man-page database — it works on any CLI on your
// PATH, including your own scripts and internal tools.

import { getHelp } from './help.js';
import { parseHelp, type CmdOption, type ParsedHelp } from './parser.js';

export type AnnotationKind =
  | 'command'
  | 'subcommand'
  | 'long-option'
  | 'short-option'
  | 'short-cluster'
  | 'option-value'
  | 'argument'
  | 'separator'
  | 'unknown';

export interface ClusterPart {
  flag: string;
  description: string;
  known: boolean;
}

export interface Annotation {
  token: string;
  kind: AnnotationKind;
  /** One-line human explanation. */
  detail: string;
  /** For clustered short options (e.g. `-xzf` or bare `xzvf`). */
  parts?: ClusterPart[];
  /** True when the option/subcommand was not found in the parsed help. */
  unknown?: boolean;
}

function firstDescLine(s: string): string {
  const line = (s || '').split('\n')[0].trim();
  return line;
}

/** Build fast lookup maps of every flag alias → its option. */
function indexOptions(opts: CmdOption[]) {
  const long = new Map<string, CmdOption>();
  const short = new Map<string, CmdOption>();
  for (const o of opts) {
    for (const f of o.flags) {
      if (f.startsWith('--')) long.set(f, o);
      else if (f.startsWith('-') && f.length === 2) short.set(f, o);
    }
  }
  return { long, short };
}

const optTakesArg = (o: CmdOption | undefined) => !!(o && o.arg);

/**
 * Classic tools that accept an old-style bundled first argument with NO leading
 * dash (e.g. `tar xzvf`, `ps aux`, `ar rcs`). Bare-cluster detection is limited
 * to these so ordinary operands are never misread as bundled flags.
 */
const OLD_STYLE_CLUSTER_COMMANDS = new Set(['tar', 'ps', 'ar']);

/**
 * Pure, testable core: annotate the argument tokens that follow the resolved
 * command (+ optional subcommand), using the parsed help of that command.
 */
export function annotateArgs(
  args: string[],
  parsed: ParsedHelp,
  command?: string,
): Annotation[] {
  const { long, short } = indexOptions(parsed.options);
  const out: Annotation[] = [];
  let optionsEnded = false;
  // Old-style bundled syntax (tar `xzvf`, ps `aux`) is exclusive to a small set
  // of classic tools and only ever appears as the very first argument. We track
  // whether a dash-flag or any prior positional has appeared so a bare operand
  // that merely happens to consist of valid short-flag letters (e.g. grep's
  // `foo`) is never mislabeled as a cluster.
  const base = command ? command.split('/').pop() : undefined;
  const oldStyleTool = base !== undefined && OLD_STYLE_CLUSTER_COMMANDS.has(base);
  let sawDashOption = false;
  let sawPositional = false;

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];

    if (!optionsEnded && tok === '--') {
      optionsEnded = true;
      out.push({
        token: tok,
        kind: 'separator',
        detail: 'End of options — every following token is a positional argument.',
      });
      continue;
    }

    // --- long option: --flag or --flag=value ---------------------------
    if (!optionsEnded && tok.startsWith('--') && tok.length > 2) {
      sawDashOption = true;
      const eq = tok.indexOf('=');
      const name = eq === -1 ? tok : tok.slice(0, eq);
      const inlineVal = eq === -1 ? null : tok.slice(eq + 1);
      const opt = long.get(name);
      out.push({
        token: tok,
        kind: 'long-option',
        unknown: !opt,
        detail: opt
          ? firstDescLine(opt.description) || '(no description in help)'
          : 'Not found in this command’s --help (unknown or version-specific flag).',
      });
      // Space-separated value: `--output file`
      if (opt && optTakesArg(opt) && inlineVal === null) {
        const nxt = args[i + 1];
        if (nxt !== undefined && !(nxt.startsWith('-') && nxt.length > 1)) {
          out.push({
            token: nxt,
            kind: 'option-value',
            detail: `Value for ${name} ${opt.arg ? opt.arg : ''}`.trim(),
          });
          i++;
        }
      }
      continue;
    }

    // --- short option(s): -x, -xzf, -o value, -ofile -------------------
    if (!optionsEnded && tok.startsWith('-') && tok.length > 1 && tok !== '--') {
      sawDashOption = true;
      const chars = tok.slice(1);
      const parts: ClusterPart[] = [];
      let consumedValueFrom = -1; // index within chars where an arg-taking flag grabbed the rest
      for (let j = 0; j < chars.length; j++) {
        const flag = '-' + chars[j];
        const opt = short.get(flag);
        parts.push({
          flag,
          known: !!opt,
          description: opt ? firstDescLine(opt.description) : '(unknown short flag)',
        });
        if (optTakesArg(opt)) {
          consumedValueFrom = j;
          break; // remaining chars are this flag's value
        }
      }
      const singular = parts.length === 1;
      const attachedVal =
        consumedValueFrom !== -1 ? chars.slice(consumedValueFrom + 1) : '';
      out.push({
        token: tok,
        kind: singular ? 'short-option' : 'short-cluster',
        parts,
        unknown: parts.every((p) => !p.known),
        detail: singular
          ? parts[0].description
          : `${parts.length} bundled short options`,
      });
      // Value handling for the arg-taking flag in the cluster.
      if (consumedValueFrom !== -1) {
        const lastFlag = parts[parts.length - 1].flag;
        const lastOpt = short.get(lastFlag);
        if (attachedVal) {
          out.push({
            token: attachedVal,
            kind: 'option-value',
            detail: `Value for ${lastFlag} ${lastOpt?.arg ?? ''}`.trim(),
          });
        } else {
          const nxt = args[i + 1];
          if (nxt !== undefined && !(nxt.startsWith('-') && nxt.length > 1)) {
            out.push({
              token: nxt,
              kind: 'option-value',
              detail: `Value for ${lastFlag} ${lastOpt?.arg ?? ''}`.trim(),
            });
            i++;
          }
        }
      }
      continue;
    }

    // --- bare token (no leading dash) ----------------------------------
    // Could be a subcommand, a classic clustered option group (tar's `xzvf`),
    // or a positional argument/operand.
    const sub = parsed.subcommands.find((s) => s.name === tok);
    if (!optionsEnded && sub) {
      sawPositional = true;
      out.push({
        token: tok,
        kind: 'subcommand',
        detail: firstDescLine(sub.description) || 'subcommand',
      });
      continue;
    }

    // Bare clustered short options (old-style, e.g. tar `xzvf` / ps `aux`).
    // These are restricted to a curated set of classic tools AND to the very
    // first argument (before any dash-flag or positional). This prevents an
    // ordinary operand whose letters happen to be valid short flags — such as
    // grep's search pattern `foo` (f, o, o are all grep flags) — from being
    // mislabeled as a bundle.
    if (
      !optionsEnded &&
      oldStyleTool &&
      !sawDashOption &&
      !sawPositional &&
      tok.length >= 1 &&
      short.size > 0 &&
      /^[A-Za-z0-9]+$/.test(tok) &&
      [...tok].every((ch) => short.has('-' + ch))
    ) {
      const parts: ClusterPart[] = [...tok].map((ch) => {
        const opt = short.get('-' + ch)!;
        return { flag: '-' + ch, known: true, description: firstDescLine(opt.description) };
      });
      out.push({
        token: tok,
        kind: 'short-cluster',
        parts,
        detail: `${parts.length} bundled short options (old-style, no leading dash)`,
      });
      continue;
    }

    sawPositional = true;
    out.push({
      token: tok,
      kind: 'argument',
      detail: 'Positional argument / operand.',
    });
  }

  return out;
}

export interface ExplainResult {
  /** The resolved command words, e.g. ["git", "commit"]. */
  command: string[];
  invocation: string;
  annotations: Annotation[];
}

/**
 * Resolve a full command line: fetch the tool's help (drilling one level into a
 * subcommand when present), then annotate the remaining tokens.
 */
export async function explainCommand(tokens: string[]): Promise<ExplainResult> {
  if (tokens.length === 0) throw new Error('cmdpeek explain: no command given.');
  const cmd = tokens[0];
  const top = await getHelp(cmd, []);
  const topParsed = parseHelp(top.text);

  // Does the next non-flag token name a subcommand? If so, drill one level.
  const maybeSub = tokens[1];
  const isSub =
    maybeSub !== undefined &&
    !maybeSub.startsWith('-') &&
    topParsed.subcommands.some((s) => s.name === maybeSub);

  if (isSub) {
    try {
      const subHelp = await getHelp(cmd, [maybeSub]);
      const subParsed = parseHelp(subHelp.text);
      return {
        command: [cmd, maybeSub],
        invocation: subHelp.invocation,
        annotations: annotateArgs(tokens.slice(2), subParsed, maybeSub),
      };
    } catch {
      // Subcommand help unavailable — fall back to top-level parse.
    }
  }

  return {
    command: [cmd],
    invocation: top.invocation,
    annotations: annotateArgs(tokens.slice(1), topParsed, cmd),
  };
}
