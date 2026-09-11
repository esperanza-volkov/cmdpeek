// Shell keybinding widgets. `cmdpeek --shell <bash|zsh|fish>` prints one of
// these; the user sources it (e.g. eval "$(cmdpeek --shell zsh)") to bind Ctrl-G.
// The widget takes the command currently on the prompt, opens cmdpeek's builder
// on /dev/tty, and drops the assembled command back onto the prompt.

export type SupportedShell = 'bash' | 'zsh' | 'fish';

export function shellWidget(shell: string | undefined): string | null {
  switch (shell) {
    case 'bash':
      return `# cmdpeek shell widget — type a command name, press Ctrl-G to build its flags.
_cmdpeek_widget() {
  [ -z "$READLINE_LINE" ] && return
  local out
  out=$(cmdpeek --print-command $READLINE_LINE </dev/tty) || return
  [ -n "$out" ] && { READLINE_LINE="$out"; READLINE_POINT=\${#READLINE_LINE}; }
}
bind -x '"\\C-g": _cmdpeek_widget'
`;
    case 'zsh':
      return `# cmdpeek shell widget — type a command name, press Ctrl-G to build its flags.
_cmdpeek_widget() {
  [[ -z $BUFFER ]] && return
  local out
  out=$(cmdpeek --print-command \${(z)BUFFER} </dev/tty) || return
  [[ -n $out ]] && { BUFFER=$out; CURSOR=\${#BUFFER}; }
  zle reset-prompt
}
zle -N _cmdpeek_widget
bindkey '^g' _cmdpeek_widget
`;
    case 'fish':
      return `# cmdpeek shell widget — type a command name, press Ctrl-G to build its flags.
function _cmdpeek_widget
    set -l cmd (commandline)
    test -z "$cmd"; and return
    set -l out (cmdpeek --print-command $cmd </dev/tty)
    test -n "$out"; and commandline -r -- $out
end
bind \\cg _cmdpeek_widget
`;
    default:
      return null;
  }
}
