#!/usr/bin/env node
/**
 * Installs the partyline guard hook for Claude Code.
 *
 *   node hooks/install.mjs [settings.json ...]          install (default: $CLAUDE_CONFIG_DIR or ~/.claude)
 *   node hooks/install.mjs --uninstall [settings.json ...]
 *
 * The hook is copied to <config dir>/partyline/room-guard.mjs and the settings point
 * there, so moving or deleting this clone can't switch the guard off. Rerun it after
 * pulling to update the copy.
 *
 * Weights live in <config dir>/partyline/weights.json. A missing file gets the defaults.
 * A file still equal to defaults this installer shipped before gets the new defaults; a
 * file with the operator's own edits is left alone.
 *
 * Safe to rerun: it replaces its own entries and leaves every other hook alone.
 * A backup of each settings file is written next to it first.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uninstall = process.argv.includes("--uninstall");
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const stateDir = join(configDir, "partyline");
const guard = join(stateDir, "room-guard.mjs");
const command = `node ${JSON.stringify(guard)}`;
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

if (uninstall) {
	rmSync(guard, { force: true });
} else {
	mkdirSync(stateDir, { recursive: true });
	copyFileSync(join(here, "room-guard.mjs"), guard);
	console.log(`Guard copied to ${guard}`);
	installWeights();
}

/** Parses JSON, or returns undefined when it isn't. */
function parse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Every set of defaults this installer has shipped: the one it last installed here, and
 * each version of hooks/weights.json in this clone's git history.
 */
function shippedDefaults() {
	const shipped = [];
	const recorded = join(stateDir, "weights.default.json");
	if (existsSync(recorded)) {
		shipped.push(parse(readFileSync(recorded, "utf8")));
	}
	const history = spawnSync("git", ["log", "--format=%H", "--", "weights.json"], { cwd: here, encoding: "utf8" });
	for (const commit of history.status === 0 ? history.stdout.split("\n").filter(Boolean) : []) {
		const old = spawnSync("git", ["show", `${commit}:./weights.json`], { cwd: here, encoding: "utf8" });
		if (old.status === 0) {
			shipped.push(parse(old.stdout));
		}
	}

	return shipped.filter(Boolean).map((weights) => JSON.stringify(weights));
}

function installWeights() {
	const weights = join(stateDir, "weights.json");
	const defaults = readFileSync(join(here, "weights.json"), "utf8");
	const current = existsSync(weights) ? parse(readFileSync(weights, "utf8")) : undefined;

	if (!existsSync(weights)) {
		writeFileSync(weights, defaults);
		console.log(`Default weights copied to ${weights}; edit that file to change them.`);
	} else if (JSON.stringify(current) === JSON.stringify(parse(defaults))) {
		// Already the current defaults.
	} else if (current && shippedDefaults().includes(JSON.stringify(current))) {
		copyFileSync(weights, `${weights}.bak-partyline`);
		writeFileSync(weights, defaults);
		console.log(`Updated ${weights} to the new defaults (it had no edits of yours; backup next to it).`);
	} else {
		console.log(
			`Kept ${weights}: it has your own edits. Compare it with ${join(here, "weights.json")} for new defaults.`,
		);
	}

	writeFileSync(join(stateDir, "weights.default.json"), defaults);
}
