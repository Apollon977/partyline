import { DurableObject } from "cloudflare:workers";
import { formatCatchUp, formatPush, matchSocketPath } from "../core/app.ts";
import { type Message, RoomLog } from "../core/room-log.ts";

/**
 * One room on Cloudflare. A single instance runs per team and room ID, so every message
 * lands here in order and is pushed to every open WebSocket.
 */
export class Room extends DurableObject<Env> {
	private readonly log: RoomLog;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.log = new RoomLog({
			all: (query, ...params) => ctx.storage.sql.exec(query, ...params).toArray() as never,
		});
	}

	/** The object's name is the room key, "<team>:<room id>". */
	private get key(): string {
		return this.ctx.id.name ?? "";
	}

	async open(): Promise<void> {
		this.log.open(this.key);
	}

	async post(sender: string, text: string): Promise<Message> {
		const message = this.log.post(this.key, sender, text);
		const pushed = formatPush(this.key.split(":").at(-1) ?? "", message);
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
		return this.log.read(this.key, since, limit);
	}

	async lastSeq(): Promise<number> {
		return this.log.lastSeq(this.key);
	}

	/** Accepts a read-only WebSocket that receives every new message, after a catch-up notice for any it missed. */
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected a WebSocket upgrade.", { status: 426 });
		}
		if (!this.log.isOpen(this.key)) {
			return new Response("No such room.", { status: 404 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		const since = matchSocketPath(new URL(request.url))?.since ?? null;
		const catchUp = formatCatchUp(this.key.split(":").at(-1) ?? "", since, this.log.lastSeq(this.key));
		if (catchUp) {
			server.send(catchUp);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(): Promise<void> {
		// The stream is read-only: agents post through the MCP tools.
	}

	async webSocketClose(socket: WebSocket, code: number): Promise<void> {
		socket.close(code === 1005 ? 1000 : code, "closed");
	}
}
