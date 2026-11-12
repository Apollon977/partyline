import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const hooks = new URL(".", import.meta.url).pathname;

/** A copy of the hooks folder outside git, so tests control which defaults count as shipped. */
function clone() {
	const dir = mkdtempSync(join(tmpdir(), "partyline-clone-"));
	for (const file of ["install.mjs", "room-guard.mjs", "weights.json"]) {
		cpSync(join(hooks, file), join(dir, file));
	}

	return dir;
}

function install(source, configDir, ...args) {
	const run = spawnSync("node", [join(source, "install.mjs"), ...args], {
		env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
		encoding: "utf8",
	});
	assert.equal(run.status, 0, run.stderr);

	return run.stdout;
}

function runHook(command, configDir, input) {
	const run = spawnSync("sh", ["-c", command], {
		input: JSON.stringify({ session_id: "s1", ...input }),
		env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
		encoding: "utf8",
	});

	return { status: run.status, out: run.stdout ? JSON.parse(run.stdout) : null };
}

test("the guard keeps running after the clone it was installed from is deleted", () => {
	const source = clone();
	const configDir = mkdtempSync(join(tmpdir(), "guard-config-"));
	install(source, configDir);
	rmSync(source, { recursive: true });

	const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
	const command = settings.hooks.PreToolUse[0].hooks[0].command;
	assert.ok(command.includes(join(configDir, "partyline", "room-guard.mjs")));

	runHook(command, configDir, {
		hook_event_name: "PostToolUse",
		tool_name: "mcp__core__read_messages",
		tool_input: { room: "a".repeat(32) },
		tool_response: { content: [{ type: "text", text: "[partyline] hi" }] },
	});
	const pushed = runHook(command, configDir, {
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command: "git push" },
	});
	assert.equal(pushed.status, 0);
	assert.equal(pushed.out.hookSpecificOutput.permissionDecision, "deny");
});

test("uninstalling removes the hook and its copy", () => {
	const configDir = mkdtempSync(join(tmpdir(), "guard-config-"));
	install(hooks, configDir);
	install(hooks, configDir, "--uninstall");

	assert.deepEqual(JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8")).hooks, {});
	assert.equal(existsSync(join(configDir, "partyline", "room-guard.mjs")), false);
});

test("weights: unedited old defaults are updated, edited weights are kept", () => {
	const source = clone();
	const current = readFileSync(join(source, "weights.json"), "utf8");
	const old = JSON.stringify({ ...JSON.parse(current), bash: { ...JSON.parse(current).bash, default: "notify" } });

	const fresh = mkdtempSync(join(tmpdir(), "guard-config-"));
	install(source, fresh);
	assert.equal(readFileSync(join(fresh, "partyline", "weights.json"), "utf8"), current);

	const unedited = mkdtempSync(join(tmpdir(), "guard-config-"));
	mkdirSync(join(unedited, "partyline"));
	writeFileSync(join(unedited, "partyline", "weights.json"), old);
	writeFileSync(join(unedited, "partyline", "weights.default.json"), old);
	assert.match(install(source, unedited), /Updated .* to the new defaults/);
	assert.equal(readFileSync(join(unedited, "partyline", "weights.json"), "utf8"), current);
	assert.equal(readFileSync(join(unedited, "partyline", "weights.json.bak-partyline"), "utf8"), old);

	const edited = mkdtempSync(join(tmpdir(), "guard-config-"));
	mkdirSync(join(edited, "partyline"));
	const mine = JSON.stringify({ ...JSON.parse(old), mine: true });
	writeFileSync(join(edited, "partyline", "weights.json"), mine);
	writeFileSync(join(edited, "partyline", "weights.default.json"), old);
	assert.match(install(source, edited), /Kept .*: it has your own edits/);
	assert.equal(readFileSync(join(edited, "partyline", "weights.json"), "utf8"), mine);
});
