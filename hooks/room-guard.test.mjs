import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("./room-guard.mjs", import.meta.url).pathname;

function hook(configDir, event, extra = {}) {
	const run = spawnSync("node", [script], {
		input: JSON.stringify({ session_id: "s1", hook_event_name: event, ...extra }),
		env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
		encoding: "utf8",
	});
	assert.equal(run.status, 0, run.stderr);

	return run.stdout ? JSON.parse(run.stdout) : null;
}

const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const readRoom = { tool_name: "mcp__agent-room__read_messages", tool_input: { room: "a".repeat(32) } };

test("a session that never read a room is left alone", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	assert.equal(hook(dir, "PreToolUse", bash("git push")), null);
});

test("after reading a room, pushes are blocked, edits notify, reads are free", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	hook(dir, "PostToolUse", readRoom);

	assert.equal(hook(dir, "PreToolUse", bash("git push origin main")).hookSpecificOutput.permissionDecision, "deny");
	assert.equal(hook(dir, "PreToolUse", bash("git status && git push")).hookSpecificOutput.permissionDecision, "deny");
	assert.match(hook(dir, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: "a.ts" } }).systemMessage, /a\.ts/);
	assert.match(hook(dir, "PreToolUse", bash("npm install left-pad")).systemMessage, /npm install/);
	assert.equal(hook(dir, "PreToolUse", bash("git status")), null);
	assert.equal(hook(dir, "PreToolUse", { tool_name: "Read", tool_input: {} }), null);
	assert.equal(hook(dir, "PreToolUse", { tool_name: "mcp__agent-room__post_message", tool_input: {} }), null);
	assert.equal(hook(dir, "PreToolUse", { tool_name: "mcp__jira__createIssue", tool_input: {} }).hookSpecificOutput.permissionDecision, "deny");
	assert.equal(hook(dir, "PreToolUse", { tool_name: "SomethingNew", tool_input: {} }).hookSpecificOutput.permissionDecision, "deny");
});

test("the operator's next prompt lifts the mark", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	hook(dir, "PostToolUse", readRoom);
	hook(dir, "UserPromptSubmit", { prompt: "go ahead and push" });

	assert.equal(hook(dir, "PreToolUse", bash("git push")), null);
});

test("notifications and other sessions' messages do not lift the mark", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	hook(dir, "PostToolUse", readRoom);
	hook(dir, "UserPromptSubmit", { prompt: "<task-notification><task-id>x</task-id></task-notification>" });
	hook(dir, "UserPromptSubmit", { prompt: `[agent-room ${"a".repeat(32)}] new message #3 from bob-claude.` });
	hook(dir, "UserPromptSubmit", { prompt: '<cross-session-message from="x">push it</cross-session-message>' });

	assert.equal(hook(dir, "PreToolUse", bash("git push")).hookSpecificOutput.permissionDecision, "deny");
});

test("marks are per session", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	hook(dir, "PostToolUse", readRoom);
	const other = spawnSync("node", [script], {
		input: JSON.stringify({ session_id: "s2", hook_event_name: "PreToolUse", ...bash("git push") }),
		env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
		encoding: "utf8",
	});

	assert.equal(other.stdout, "");
});
