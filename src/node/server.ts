/**
 * partyline on Node: one process, rooms in a SQLite file, room streams over WebSockets.
 *
 * Environment:
 *   TEAMS       JSON object of team name to member name to token (required)
 *   PORT        port to listen on (default 8787)
 *   DATA_DIR    where partyline.db lives (default ./data)
 *   PUBLIC_URL  the https:// address agents reach it on, when behind a proxy
 *               (default: worked out from each request)
 *
 * Run a single instance: rooms and their live streams live in this process.
 */
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { type WebSocket, WebSocketServer } from "ws";
import { formatCatchUp, formatPush, handleRequest, matchSocketPath, parseTeams, type Rooms, roomKey } from "../core/app.ts";
import { type Message, RoomLog, type SqlValue } from "../core/room-log.ts";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? "./data";

try {
	parseTeams(process.env.TEAMS);
} catch (error) {
	console.error(`partyline: ${(error as Error).message} Set it like TEAMS='{"core":{"alice-claude":"<64-character token>"}}'.`);
	process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "partyline.db"));
db.exec("PRAGMA journal_mode = WAL");
const log = new RoomLog({
	all: <Row>(query: string, ...params: SqlValue[]) => db.prepare(query).all(...params) as Row[],
});

const listeners = new Map<string, Set<WebSocket>>();

const rooms: Rooms = {
	async open(team, roomId) {
		log.open(roomKey(team, roomId));
	},
	async post(team, roomId, sender, text): Promise<Message> {
		const message = log.post(roomKey(team, roomId), sender, text);
		const pushed = formatPush(roomId, message);
		for (const socket of listeners.get(roomKey(team, roomId)) ?? []) {
			socket.send(pushed);
		}

		return message;
	},
	async read(team, roomId, since, limit) {
		return log.read(roomKey(team, roomId), since, limit);
	},
	async lastSeq(team, roomId) {
		return log.lastSeq(roomKey(team, roomId));
	},
};

function originOf(request: IncomingMessage): string {
	if (process.env.PUBLIC_URL) {
		return process.env.PUBLIC_URL.replace(/\/$/, "");
	}
	const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();

	return `${proto}://${request.headers.host ?? `localhost:${port}`}`;
}

function toWebRequest(request: IncomingMessage, origin: string): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value !== undefined) {
			headers.set(name, Array.isArray(value) ? value.join(", ") : value);
		}
	}
	const hasBody = request.method !== "GET" && request.method !== "HEAD";

	return new Request(new URL(request.url ?? "/", origin), {
		method: request.method,
		headers,
		body: hasBody ? (Readable.toWeb(request) as ReadableStream) : undefined,
		duplex: "half",
	} as RequestInit);
}

async function send(response: Response, out: ServerResponse): Promise<void> {
	out.writeHead(response.status, Object.fromEntries(response.headers));
	if (response.body) {
		for await (const chunk of response.body) {
			out.write(chunk);
		}
	}
	out.end();
}

const server = createServer(async (request, out) => {
	try {
		const origin = originOf(request);
		const response = await handleRequest(toWebRequest(request, origin), rooms, process.env.TEAMS, origin);
		await send(response ?? new Response("Not found", { status: 404 }), out);
	} catch (error) {
		console.error(error);
		if (!out.headersSent) {
			out.writeHead(500).end("Internal error");
		} else {
			out.end();
		}
	}
});

const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
	const match = matchSocketPath(new URL(request.url ?? "/", "http://localhost"));
	const key = match ? roomKey(match.team, match.roomId) : null;
	if (!key || !log.isOpen(key)) {
		socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
		return;
	}

	sockets.handleUpgrade(request, socket, head, (ws) => {
		const set = listeners.get(key) ?? new Set();
		set.add(ws);
		listeners.set(key, set);
		const catchUp = formatCatchUp(match!.roomId, match!.since, log.lastSeq(key));
		if (catchUp) {
			ws.send(catchUp);
		}
		ws.on("close", () => {
			set.delete(ws);
			if (set.size === 0) {
				listeners.delete(key);
			}
		});
	});
});

server.listen(port, () => console.log(`partyline listening on :${port}, data in ${dataDir}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		sockets.clients.forEach((ws) => ws.close(1001, "server shutting down"));
		server.close(() => {
			db.close();
			process.exit(0);
		});
	});
}
