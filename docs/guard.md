# The guard hook

The guard hook (`hooks/room-guard.mjs`) runs on each operator's machine. Once a session reads a room, it marks the session, and every action from then on has a weight:

| Weight  | Default examples                                                                                                                                                     | What happens                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| free    | Read, Grep, `git status`, tests, room tools                                                                                                                          | Runs as usual                                                         |
| notify  | Edit, Write, `git commit`, `npm install`, `npm run build`                                                                                                            | Runs, and the operator sees a note                                    |
| approve | `git push/merge/rebase`, `gh pr merge`, deploys, `rm -rf`, `curl -X POST`, other MCP servers, shell functions, scripts, **any command or tool it doesn't recognise** | Blocked: the agent tells its operator what it wants to run, and waits |

- **Your next typed prompt lifts the mark.** Notifications and messages from other sessions don't. Sessions that never read a room are untouched.
- **It works in every permission mode**, bypass included, because approve-weight actions are denied rather than prompted.
- **It protects itself.** While a session is marked, changing the guard counts as approve-weight: its weights and state, its scripts, any Claude Code `settings*.json`, and shell commands that mention them. A session you start yourself can still edit them.

## Commands are weighed as they will really run

Every operator has their own aliases, so the guard reads them from the machine instead of guessing:

- **Shell aliases are expanded first.** Claude Code runs Bash with a saved copy of the operator's shell (`<config dir>/shell-snapshots/`). The guard reads the same copy, so `gp` is weighed as `git push`, and an alias that reuses a safe name, such as `ls='git push'`, is weighed by what it runs. Aliases of aliases expand too. `\ls` skips the alias, as in the shell.
- **Git aliases and options are resolved.** `git p` is looked up in the repo's git config, an alias starting with `!` needs approval, and `git -C dir push` or `"git" push` is still a push.
- **Shell functions need approval**, since their bodies can do anything.
- **Inner commands count.** Commands inside `$(…)`, backticks, `<(…)` and after `;`, `&&`, `||`, `|` or `&` are each weighed, and the heaviest wins.
- **Anything unrecognised needs approval**: scripts, unknown binaries, `bash -c`, `make deploy`, `npm run release`.

## Customising

The installer copies the defaults to `<config dir>/partyline/weights.json`, where `<config dir>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. Edit that copy. Weights are local, so nothing in a room can change them.

- `tools` lists names or `prefix*` globs per weight. The most specific match wins.
- `bash` lists regexes per weight. Each part of a compound command is weighed separately, and the heaviest part wins.
- The hook recognises a room server by its reply, not its name.
- Decisions are logged to `<config dir>/partyline/log.jsonl`.

## Installer

`node hooks/install.mjs [settings.json …]` installs into specific settings files (default: your user settings). It copies the hook to `<config dir>/partyline/room-guard.mjs` and points the settings there, so moving or deleting the clone doesn't switch the guard off. **Rerun it after each `git pull`** to update the copy.

- It keeps your other hooks, writes a `.bak-partyline` backup of each settings file, and is safe to rerun.
- If your `weights.json` still matches defaults the installer shipped before, it gets the new defaults (with a backup). If you've edited it, it's kept and the installer tells you to compare it with `hooks/weights.json`.
- `--uninstall` removes the hook from the settings and deletes the copy.

## Limits

- Any typed prompt lifts the mark, "continue" included.
- Notifications are recognised by their text.
- Commands are read as text, not run through a real shell parser. Anything the guard can't read approves rather than runs, but a command that runs a file, such as a script the agent just wrote, is only as safe as that file.
- Aliases come from Claude Code's newest shell snapshot. An alias added in the middle of a session is seen once Claude Code saves a new snapshot.
