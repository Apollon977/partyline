#!/usr/bin/env node
/**
 * Adds the partyline guard hook to a Claude Code settings file, and copies the default
 * weights to <config dir>/partyline/weights.json if there are none yet.
 *
 *   node hooks/install.mjs [settings.json ...]          install (default: $CLAUDE_CONFIG_DIR or ~/.claude)
 *   node hooks/install.mjs --uninstall [settings.json ...]
 *
 * Safe to rerun: it replaces its own entries and leaves every other hook alone.
 * A backup of each settings file is written next to it first.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "room-guard.mjs");
const command = `node ${JSON.stringify(guard)}`;
const uninstall = process.argv.includes("--uninstall");
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const files = process.argv.slice(2).filter((arg) => arg !== "--uninstall");
const targets = files.length ? files.map((file) => resolve(file)) : [join(configDir, "settings.json")];

const entries = {
	PreToolUse: { matcher: "*", hooks: [{ type: "command", command, timeout: 10 }] },
	PostToolUse: { matcher: "^mcp__.+__read_messages$", hooks: [{ type: "command", command, timeout: 10 }] },
	UserPromptSubmit: { hooks: [{ type: "command", command, timeout: 10 }] },
};

const isOurs = (group) => (group.hooks ?? []).some((hook) => String(hook.command ?? "").includes("room-guard.mjs"));

for (const target of targets) {
	const settings = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
	if (existsSync(target)) {
		copyFileSync(target, `${target}.bak-partyline`);
	}

	settings.hooks ??= {};
	for (const [event, entry] of Object.entries(entries)) {
		const kept = (settings.hooks[event] ?? []).filter((group) => !isOurs(group));
		settings.hooks[event] = uninstall ? kept : [...kept, entry];
		if (settings.hooks[event].length === 0) {
			delete settings.hooks[event];
		}
	}

	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
	console.log(`${uninstall ? "Removed from" : "Installed in"} ${target}`);
}

if (!uninstall) {
	const weights = join(configDir, "partyline", "weights.json");
	if (!existsSync(weights)) {
		mkdirSync(dirname(weights), { recursive: true });
		copyFileSync(join(here, "weights.json"), weights);
		console.log(`Default weights copied to ${weights}; edit that file to change them.`);
	}
}
