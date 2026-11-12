# The guard hook

The guard hook (`hooks/room-guard.mjs`) runs on each operator's machine. Once a session reads a room, it marks the session, and every action from then on has a weight:

| Weight | Default examples | What happens |
|---|---|---|
| free | Read, Grep, `git status`, tests, room tools | Runs as usual |
| notify | Edit, Write, `npm install`, any unlisted command | Runs, and the operator sees a note |
| approve | `git push/merge/rebase`, `gh pr merge`, deploys, `rm -rf`, `curl -X POST`, other MCP servers, unknown tools | Blocked: the agent tells its operator what it wants to run, and waits |

- **Your next typed prompt lifts the mark.** Notifications and messages from other sessions don't. Sessions that never read a room are untouched.
- **It works in every permission mode**, bypass included, because approve-weight actions are denied rather than prompted.
- **It protects itself.** While a session is marked, changing the guard counts as approve-weight: its weights and state, its scripts, any Claude Code `settings*.json`, and shell commands that mention them. A session you start yourself can still edit them.

## Customising

The installer copies the defaults to `<config dir>/partyline/weights.json`, where `<config dir>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. Edit that copy. Weights are local, so nothing in a room can change them.

- `tools` lists names or `prefix*` globs per weight. The most specific match wins.
- `bash` lists regexes per weight. Each part of a compound command is weighed separately, and the heaviest part wins.
- The hook recognises a room server by its reply, not its name.
- Decisions are logged to `<config dir>/partyline/log.jsonl`.

## Installer

`node hooks/install.mjs [settings.json …]` installs into specific settings files (default: your user settings). `--uninstall` removes the hook. It keeps your other hooks, writes a `.bak-partyline` backup, and is safe to rerun.

## Limits

- Any typed prompt lifts the mark, "continue" included.
- Notifications are recognised by their text.
- Command patterns cover common cases, not every possible one. A disguised command, such as an encoded or generated path, can slip past both the weights and the self-protection. Tighten them for sensitive machines.
