# The guard hook

The guard hook (`hooks/room-guard.mjs`) runs on each operator's machine. Once a session reads a room, it marks the session, and every action from then on has a weight:

| Weight  | Default examples                                                                                                                                                                                                   | What happens                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| free    | Read and Grep in the project, `git status`, tests, room tools                                                                                                                                                      | Runs as usual                                                         |
| notify  | Edit, Write in the project, `git commit`, `npm run build`                                                                                                                                                          | Runs, and the operator sees a note                                    |
| approve | `git push/merge/rebase`, `gh pr merge`, deploys, package installs, `rm -rf`, `curl -X POST`, other MCP servers, shell functions, scripts, writes outside the project, **any command or tool it doesn't recognise** | Blocked: the agent tells its operator what it wants to run, and waits |

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

## Rules the weights can't loosen

While a session is marked, these always need approval, whatever `weights.json` says:

- **Output redirection to a file**: `>`, `>>`, `>|`, `&>` and `&>>`. Only `/dev/null`, `/dev/stdout` and `/dev/stderr` are allowed. Text inside quotes isn't counted, so `grep "=>"` still runs.
- **Writes outside the project, or into its `.git` folder.** This covers Write, Edit, MultiEdit and NotebookEdit paths (with `~` expanded, symlinks followed and case ignored), and the path arguments of `cp`, `mv`, `mkdir`, `touch`, `chmod`, `ln`, `install`, `tee`, `rm` and `rmdir`. A shell path the guard can't resolve also needs approval: one with a glob, quotes, a variable or `~`, or one in a line that also runs `cd`. The project is the git repo the session works in, or its folder when there isn't one.
- **`git -c` and `--config-env`**, since config such as `core.pager` or `core.fsmonitor` runs commands.
- **Environment variables set in front of a command**, except `LANG`, `LC_*`, `TZ`, `CI`, `NO_COLOR`, `FORCE_COLOR` and `NODE_ENV`. Variables like `GIT_PAGER` and `NODE_OPTIONS` run code.
- **The Monitor tool** is weighed by the command it runs, the same way as Bash. A Monitor that opens a WebSocket needs approval.
- **Reading secrets or files outside the project.** Read, Grep, Glob and LS paths, and the arguments of every shell command, are checked. Files named like secrets need approval wherever they are: `.env*` (but not `.env.example`), `.dev.vars`, `.npmrc`, `.netrc`, `credentials`, `*.pem`, `*.key`, `id_rsa` and similar. So do globs that could match a hidden file (`.e*`), `$VARIABLES`, and `jq env`. Outside the project, only the guard's own folder and Claude Code's saved tool output can be read freely. A `cd` out of the project needs approval too.
- **WebFetch and WebSearch**, since a URL or a query can carry anything the session has read. Room tools stay free, so the agent can still reply, but it can only send what it was allowed to read.

The default weights add argument checks on top. Free commands become approve when an option makes them run or write something: `git grep -O`, `--upload-pack`, `--output`, `rg --pre`, `find -execdir/-ok/-fprint`, `sort -o`, and any `sed` other than `sed -n '<lines>p'`. So do commands that throw work away, such as `git branch -f/--delete --force`, `git reflog expire`, `git checkout -- .` and `git restore`.

## Customising

The installer copies the defaults to `<config dir>/partyline/weights.json`, where `<config dir>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. Edit that copy. Weights are local, so nothing in a room can change them.

- `tools` lists names or `prefix*` globs per weight. The most specific match wins.
- `bash` lists regexes per weight. Each part of a compound command is weighed separately, and the heaviest part wins.
- `npm/pnpm/yarn version` and `docker compose down` have their own approve patterns, so they still need approval if you change `bash.default`.
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
- Secrets are recognised by file name. A secret written into an ordinary project file, or a token in a git remote URL, can still be read and posted to the room.
- Read checks are on the cautious side: a search pattern that looks like an absolute path (`rg '/api/v1' src`) needs approval.
- Commands are read as text, not run through a real shell parser. Anything the guard can't read needs approval rather than running. A command that runs a file is only as safe as that file, though: `npm test` runs tests the agent may have just written.
- Aliases come from Claude Code's newest shell snapshot. An alias added in the middle of a session is seen once Claude Code saves a new snapshot.
