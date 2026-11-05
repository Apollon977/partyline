import { DurableObject } from "cloudflare:workers";

export type Message = { seq: number; at: string; sender: string; text: string };

const MAX_MESSAGES_PER_MINUTE = 30;
const KEPT_MESSAGES = 1000;

/**
 * One chat room. Cloudflare runs a single instance per room ID, so every
 * message lands here in order and is pushed to every open WebSocket.
 */
export class Room extends DurableObject<Env> {
	private sql = this.ctx.storage.sql;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS messages (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				at TEXT NOT NULL,
				sender TEXT NOT NULL,
				text TEXT NOT NULL
			);
		`);
	}

	async open(): Promise<void> {
		this.sql.exec(
			"INSERT OR IGNORE INTO meta (key, value) VALUES ('opened_at', ?)",
			new Date().toISOString(),
		);
	}

	private isOpen(): boolean {
		return this.sql.exec("SELECT 1 FROM meta WHERE key = 'opened_at'").toArray().length > 0;
	}

	async post(sender: string, text: string): Promise<Message> {
		if (!this.isOpen()) {
			throw new Error("No such room.");
		}

		const minuteAgo = new Date(Date.now() - 60_000).toISOString();
		const recent = this.sql
			.exec<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE at > ?", minuteAgo)
			.one().n;
		if (recent >= MAX_MESSAGES_PER_MINUTE) {
			throw new Error(
				`Room limit reached: ${MAX_MESSAGES_PER_MINUTE} messages a minute. Wait, and check with your operator before continuing.`,
			);
		}

		const message = this.sql
			.exec<Message>(
				"INSERT INTO messages (at, sender, text) VALUES (?, ?, ?) RETURNING seq, at, sender, text",
				new Date().toISOString(),
				sender,
				text,
			)
			.one();
		this.sql.exec(
			"DELETE FROM messages WHERE seq <= (SELECT MAX(seq) FROM messages) - ?",
			KEPT_MESSAGES,
		);

		const pushed = formatForPush((this.ctx.id.name ?? "").split(":").at(-1) ?? "", message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(pushed);
			} catch {
				// A socket that has gone away is cleaned up by the runtime.
			}
		}

		return message;
	}

	async read(since: number, limit: number): Promise<Message[]> {
		if (!this.isOpen()) {
			throw new Error("No such room.");
		}

		return this.sql
			.exec<Message>(
				"SELECT seq, at, sender, text FROM messages WHERE seq > ? ORDER BY seq LIMIT ?",
				since,
				limit,
			)
			.toArray();
	}

	/** Accepts a read-only WebSocket that receives every new message. */
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected a WebSocket upgrade.", { status: 426 });
		}
		if (!this.isOpen()) {
			return new Response("No such room.", { status: 404 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(): Promise<void> {
		// The stream is read-only: agents post through the MCP tools.
	}

	async webSocketClose(socket: WebSocket, code: number): Promise<void> {
		socket.close(code === 1005 ? 1000 : code, "closed");
	}
}

/**
 * The pushed frame carries no message text, only who posted. The agent has to call
 * read_messages to see what was said, which is the moment the local guard hook marks
 * the session as instructed by a room.
 */
function formatForPush(roomId: string, message: Message): string {
	return `[agent-room ${roomId}] new message #${message.seq} from ${message.sender}. Call read_messages with room ${roomId} and since ${message.seq - 1} to read it.`;
}
