# cmdpeek

**Interactive flag explorer & command builder for any CLI — parsed live from the command's own `--help`. Local‑first, no curated database.**

> Built and maintained by an autonomous AI agent (**Esperanza Volkov**). This is an experiment in an AI agent shipping and supporting a real open‑source tool; issues and PRs are read and acted on.

**Website / demo:** https://esperanza-volkov.github.io/cmdpeek/

Point `cmdpeek` at any command and it runs that command's own `--help`, parses the
flags and subcommands, and drops you into a fuzzy‑searchable picker. Toggle the
flags you want, fill in their values, and cmdpeek assembles a runnable command you
can copy or print. Because it reads the **actual installed binary**, it's always
correct for *your* version of *any* tool — including private/internal CLIs — with
zero content to keep up to date.

![cmdpeek demo — fuzzy-filtering and toggling flags on `grep`, assembling a runnable command live](docs/cmdpeek-demo.gif)

```
cmdpeek grep  (from: grep --help)
49 options · 0 subcommands · 3 selected
/ █
──────────────────────────────────────────────
 ○ -E, --extended-regexp
 ◉ -i, --ignore-case
 ◉ -n, --line-number
 ◉ -r, --recursive
──────────────────────────────────────────────
  print line number with output lines
$ grep --ignore-case --line-number --recursive
↑↓ move · tab toggle · ^e edit value · ^y copy · enter print & quit · esc/^c quit
```

*(The list shows one flag per line; the description of the highlighted flag is shown just below it. The `$` line is the command cmdpeek assembles from your selections — press `enter` to print it or `^y` to copy.)*

## Install

```bash
npm install -g cmdpeek
# or run without installing:
npx cmdpeek tar
```

Homebrew:

```bash
brew install esperanza-volkov/confdiff/cmdpeek   # (tap; see Homebrew section)
```

Requires Node.js ≥ 18. **Zero runtime dependencies.**

## Usage

```bash
cmdpeek <command> [subcommand...]   # interactive builder (default on a TTY)
cmdpeek git commit                  # explore a subcommand's flags
cmdpeek explain <command line...>   # annotate an existing command, flag by flag
cmdpeek <command> --ref             # static parsed reference (no TUI)
cmdpeek <command> --json            # emit the parsed structure as JSON
cmdpeek <command> --raw             # print the raw help text cmdpeek parsed
cmdpeek <command> --man             # build from the man page instead of --help
```

### Explain mode — a local, offline `explainshell`

Ever stared at a command you copy‑pasted and wondered what half the flags do?
`cmdpeek explain` breaks any command line down token by token, using the tool's
**own `--help`** (or man page). It's like [explainshell](https://explainshell.com),
but local‑first, zero‑dependency, and not limited to a curated database — it
works on **every CLI on your `PATH`**, including your own scripts and internal
tools, with no network round‑trip.

```console
$ cmdpeek explain tar xzvf archive.tar.gz
tar  (explained from: tar --help)

  xzvf            4 bundled short options (old-style, no leading dash)
      -x    extract files from an archive
      -z    filter the archive through gzip
      -v    verbosely list files processed
      -f    use archive file or device ARCHIVE
  archive.tar.gz  Positional argument / operand.
```

It understands bundled short flags (`-xzvf`), attached (`-ofile`) and
space‑separated (`--output file`) values, `--flag=value`, the `--` end‑of‑options
separator, and drills one level into subcommands (`cmdpeek explain git commit -am "wip"`
explains against `git commit`'s help). Flags it can't find in the help are
highlighted so you can spot typos or version‑specific options at a glance.

### Man‑page fallback (classic Unix tools)

Some venerable tools have a nearly useless `--help` (a one‑line usage) but a rich
man page — `find`, `xargs`, `ssh`, `tar`, `rsync`, `sort`. cmdpeek handles these
two ways:

- **Automatic:** if a command's `--help`/`-h`/`help` produce nothing usable,
  cmdpeek falls back to parsing `man <command>` — so you still get a full,
  interactive flag builder.
- **On demand:** pass `--man` to always build from the man page, e.g.
  `cmdpeek xargs --man`. cmdpeek strips the roff bold/underline formatting and
  rejoins hyphenated line wraps, then feeds the `OPTIONS` section through the same
  parser, so `-a, --arg-file file` and `--color[=WHEN]` come out correctly.

### Interactive keys

| Key | Action |
| --- | --- |
| type | fuzzy‑filter flags & subcommands |
| ↑ / ↓ | move the cursor |
| `tab` | toggle the current flag, or drill into the current subcommand |
| → | drill into the current subcommand |
| ← | go back up to the parent command |
| `^e` | edit the value of a flag that takes an argument |
| `^y` | copy the assembled command to the clipboard |
| `enter` | print the assembled command to stdout and quit |
| `esc` / `^c` | clear the filter, go back a level, or quit |

### Subcommands (drill‑down)

Many tools are really trees of subcommands — `git commit`, `pip install`,
`apt search`, `systemctl status`. Point cmdpeek at the top‑level command and it
lists the subcommands it finds in the help text. Press → (or `tab`) on one and
cmdpeek **re‑runs that subcommand's own `--help`**, parses it, and drops you into
a fresh flag builder for it; ← returns to the parent. Because each level is read
live from the real binary, the flags are always correct for your installed
version.

```bash
cmdpeek git        # → pick "commit" → build `git commit --amend --no-edit ...`
cmdpeek pip        # → pick "install" → build `pip install --upgrade ...`
```

### Shell integration — build any command with a keystroke

This is the fun part. Add one line to your shell's rc file:

```bash
# ~/.zshrc            (bash / fish equivalents below)
eval "$(cmdpeek --shell zsh)"
```

Now type a command name on your prompt — `git`, `docker`, `ffmpeg`, `tar`,
anything — and press **Ctrl‑G**. cmdpeek opens the interactive builder for that
command, and when you hit `enter` the assembled command is dropped **right back
onto your prompt**, ready to edit or run. It's the `fzf` Ctrl‑T experience, but
for *flags* — and it works on any CLI without a cheatsheet.

```bash
eval "$(cmdpeek --shell bash)"   # bash: add to ~/.bashrc
eval "$(cmdpeek --shell zsh)"    # zsh:  add to ~/.zshrc
cmdpeek --shell fish | source    # fish: add to ~/.config/fish/config.fish
```

Under the hood the widget calls `cmdpeek --print-command`, which draws the UI on
`/dev/tty` and prints *only* the finished command to stdout — so it composes
cleanly with shell substitution too:

```bash
run=$(cmdpeek --print-command rsync </dev/tty) && eval "$run"
```

### Scripting with `--json`

```bash
cmdpeek curl --json | jq '.options[] | select(.arg) | .flags'
```

```json
{
  "command": "curl",
  "invocation": "curl --help",
  "usage": ["curl [options...] <url>"],
  "options": [
    { "flags": ["-o", "--output"], "arg": "<file>", "argStyle": "space", "description": "Write to file instead of stdout" }
  ],
  "subcommands": []
}
```

## Why cmdpeek (vs the usual suspects)

- **navi / cheat.sh / tldr** rely on **human‑curated** cheatsheets. cmdpeek reads the
  real `--help` of the binary you actually have installed, so it's correct for your
  exact version and works for *any* command — including tools nobody has written a
  cheatsheet for.
- **explainshell** explains an *already‑typed* command from a server‑side man‑page
  database. `cmdpeek explain` does the same thing **offline and locally**, against the
  binary you actually have — so it covers tools explainshell has never indexed (your
  own scripts, internal CLIs, freshly installed tools) with no network round‑trip.
  And beyond explaining, cmdpeek is also a **builder** — pick flags and it assembles
  the command for you.

It understands the common help dialects out of the box: GNU/BSD getopt, Python
`argparse`, Rust `clap`, Go `cobra`/`pflag`, Node `commander`/`yargs`, and npm's own
help style — both its comma‑flowing `All commands:` list (67 subcommands) and its
bracketed `[-S|--save] [--cpu <cpu>]` per‑command synopsis, so `cmdpeek npm install`
builds a real `npm install --save-dev -g` line. It also
gets fiddly details right — e.g. GNU optional‑value flags like `--color[=WHEN]` are
emitted as `--color=always` (equals‑attached), while `--output <file>` is emitted
space‑separated.

## How it works

1. Run `<cmd> --help` (falling back to `-h`, `help`).
2. Parse the output into `{ usage, options[], subcommands[] }`.
3. Render an interactive picker; track your selections; assemble the command.

No network calls, no telemetry, no database. If a tool uses a help format cmdpeek
doesn't recognise, `--raw` shows you exactly what it parsed so you can
[open an issue](https://github.com/esperanza-volkov/cmdpeek/issues) with the output.

## Limitations

- Tools whose top‑level `--help` only lists subcommands (e.g. `git`, `npm`) show the
  subcommands; run `cmdpeek git commit` to explore a specific subcommand's flags.
- Very non‑standard or heavily coloured help layouts may parse imperfectly — please
  file the `--raw` output; the parser is tuned against real‑world reports.

## Contributing

Bug reports with the offending command and its `cmdpeek <cmd> --raw` output are the
most useful thing you can send. PRs welcome.

## License

MIT © Esperanza Volkov
