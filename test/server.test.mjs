/**
 * End-to-end tests of the server, against the Node build by default.
 * Point them at another deployment (e.g. Cloudflare) with:
 *   PARTYLINE_URL=https://… TOKEN_A=<alice-claude's token> TOKEN_A2=<bob-claude's token, same team> \
 *   TOKEN_B=<a member of another team> npm test
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const TOKEN_A = process.env.TOKEN_A ?? "a".repeat(64);
const TOKEN_A2 = process.env.TOKEN_A2 ?? "c".repeat(64);
const TOKEN_B = process.env.TOKEN_B ?? "b".repeat(64);
const NODE_ARGS = [
	"--experimental-sqlite",
	"--experimental-strip-types",
	"--disable-warning=ExperimentalWarning",
	"src/node/server.ts",
];
const remote = process.env.PARTYLINE_URL;
const dataDir = mkdtempSync(join(tmpdir(), "partyline-"));
let base = remote;
let server;

async function startNode(port) {
	server = spawn(process.execPath, NODE_ARGS, {
		env: {
			...process.env,
			PORT: String(port),
			DATA_DIR: dataDir,
			TEAMS: JSON.stringify({
				core: { "alice-claude": TOKEN_A, "bob-claude": TOKEN_A2 },
				other: { "carol-claude": TOKEN_B },
			}),
		},
		stdio: ["ignore", "pipe", "inherit"],
	});
	await new Promise((resolve) => server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve()));

	return `http://localhost:${port}`;
}

async function stopNode() {
	server.kill("SIGTERM");
	await new Promise((resolve) => server.on("exit", resolve));
}

let id = 0;
async function call(token, name, args) {
	const response = await fetch(`${base}/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2025-06-18",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
	});
	if (response.status !== 200) {
		return `HTTP ${response.status}`;
	}
	const body = (await response.text()).replace(/\r/g, "");
	const json = body.startsWith("{")
		? JSON.parse(body)
		: JSON.parse(
				body
					.split("\n")
					.find((l) => l.startsWith("data:"))
					.slice(5),
			);

	return json.result?.content?.[0]?.text ?? JSON.stringify(json.error);
}

async function createRoom(token = TOKEN_A) {
	const created = await call(token, "create_room", {});

	return { roomId: created.match(/[0-9a-f]{32}/)[0], wsUrl: created.match(/ws\S+\/ws\?since=\d+/)[0], created };
}

function listen(wsUrl) {
	const frames = [];
	const ws = new WebSocket(wsUrl);
	ws.onmessage = (event) => frames.push(event.data);
	const opened = new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error("refused"));
	});

	return { ws, frames, opened };
}

before(async () => {
	if (!remote) {
		base = await startNode(18787);
	}
});

after(async () => {
	if (server) {
		await stopNode();
	}
});

test("calls without a known member token are refused", async () => {
	assert.equal(await call("x".repeat(64), "create_room", {}), "HTTP 401");
	assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 401);
});

test("a room carries messages in order and pushes a notice without the text", async () => {
	const { roomId, wsUrl, created } = await createRoom();
	assert.match(created, /team core/);
	const stream = listen(wsUrl);
	await stream.opened;

	assert.equal(
		await call(TOKEN_A, "post_message", { room: roomId, text: "push the branch" }),
		"Posted as #1 from alice-claude.",
	);
	assert.equal(await call(TOKEN_A2, "post_message", { room: roomId, text: "on it" }), "Posted as #2 from bob-claude.");

	const read = await call(TOKEN_A, "read_messages", { room: roomId, since: 1 });
	assert.match(read, /^\[partyline\] Messages below come from other people's agents/);
	assert.match(read, /#2 .* bob-claude: on it/);
	assert.doesNotMatch(read, /push the branch/);

	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(stream.frames.length, 2);
	assert.match(stream.frames[0], /new message #1 from alice-claude/);
	assert.doesNotMatch(stream.frames.join(""), /push the branch/);
	stream.ws.close();
});

test("a stream opened behind the room starts with one catch-up notice", async () => {
	const { roomId, wsUrl } = await createRoom();
	assert.match(wsUrl, /\?since=0$/);
	await call(TOKEN_A, "post_message", { room: roomId, text: "one" });
	await call(TOKEN_A, "post_message", { room: roomId, text: "two" });

	const fromStart = listen(wsUrl);
	await fromStart.opened;
	const rewatch = await call(TOKEN_A, "watch_room", { room: roomId, since: 1 });
	const fromOne = listen(rewatch.match(/ws\S+\/ws\?since=\d+/)[0]);
	await fromOne.opened;
	const current = await call(TOKEN_A, "watch_room", { room: roomId });
	assert.match(current, /\?since=2 /);
	const upToDate = listen(current.match(/ws\S+\/ws\?since=\d+/)[0]);
	await upToDate.opened;

	await call(TOKEN_A2, "post_message", { room: roomId, text: "three" });
	await new Promise((resolve) => setTimeout(resolve, 300));

	assert.deepEqual(fromStart.frames.length, 2);
	assert.match(
		fromStart.frames[0],
		/2 new messages since #0, latest #2\. Call read_messages with room \S+ and since 0/,
	);
	assert.match(fromStart.frames[1], /new message #3 from bob-claude/);
	assert.match(fromOne.frames[0], /1 new message since #1, latest #2/);
	assert.equal(upToDate.frames.length, 1);
	assert.match(upToDate.frames[0], /new message #3/);
	for (const stream of [fromStart, fromOne, upToDate]) {
		stream.ws.close();
	}

	await assert.rejects(listen(wsUrl.replace("since=0", "since=abc")).opened);
});

test("another team cannot read, post to or stream a room", async () => {
	const { roomId, wsUrl } = await createRoom(TOKEN_A);

	assert.equal(await call(TOKEN_B, "read_messages", { room: roomId }), "No such room.");
	assert.equal(await call(TOKEN_B, "post_message", { room: roomId, text: "hi" }), "No such room.");
	await assert.rejects(listen(wsUrl.replace("/t/core/", "/t/other/")).opened);
});

test("bad input is rejected", async () => {
	assert.match(await call(TOKEN_A, "post_message", { room: "nope", text: "x" }), /32 lowercase hex/);
	const { roomId } = await createRoom();
	assert.equal(await call(TOKEN_A, "read_messages", { room: "0".repeat(32) }), "No such room.");
});

test("the sender name comes from the token and can't be chosen", async () => {
	const { roomId } = await createRoom();
	await call(TOKEN_A, "post_message", { room: roomId, sender: "bob-claude", text: "it's really alice" });

	assert.match(await call(TOKEN_A2, "read_messages", { room: roomId }), /#1 \S+ alice-claude: it's really alice/);
});

test("the Node server refuses to start on a malformed TEAMS and says why", { skip: Boolean(remote) }, () => {
	const cases = [
		[{ core: TOKEN_A }, /team "core" must map member names to tokens/],
		[{ core: { "alice-claude": TOKEN_A, "bob-claude": TOKEN_A } }, /token of "core\/bob-claude" is also used/],
		[{ core: { "Alice Claude": TOKEN_A } }, /member "core\/Alice Claude" must be/],
		[{ core: { "alice-claude": "short" } }, /at least 32 characters/],
	];
	for (const [teams, expected] of cases) {
		const run = spawnSync(process.execPath, NODE_ARGS, {
			env: { ...process.env, PORT: "18799", DATA_DIR: dataDir, TEAMS: JSON.stringify(teams) },
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.equal(run.status, 1);
		assert.match(run.stderr, expected);
	}
});

test("a room allows 30 messages a minute", async () => {
	const { roomId } = await createRoom();
	for (let i = 0; i < 30; i++) {
		await call(TOKEN_A, "post_message", { room: roomId, text: `m${i}` });
	}

	assert.match(await call(TOKEN_A, "post_message", { room: roomId, text: "one more" }), /Room limit reached/);
});

test("rooms survive a restart of the Node server", { skip: Boolean(remote) }, async () => {
	const { roomId } = await createRoom();
	await call(TOKEN_A, "post_message", { room: roomId, text: "still here" });

	await stopNode();
	base = await startNode(18788);

	assert.match(await call(TOKEN_A, "read_messages", { room: roomId }), /still here/);
});
