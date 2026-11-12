/**
 * A room's message log, written once against a minimal SQL interface so the same
 * logic runs on a Durable Object's SQLite and on Node's built-in SQLite.
 */

export type Message = { seq: number; at: string; sender: string; text: string };

export type SqlValue = string | number | null;

export interface Sql {
	/** Runs one statement and returns its rows (an empty array when it returns none). */
	all<Row>(query: string, ...params: SqlValue[]): Row[];
}

export const MAX_MESSAGES_PER_MINUTE = 30;
export const KEPT_MESSAGES = 1000;

export class RoomError extends Error {}

export class RoomLog {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		this.sql.all("CREATE TABLE IF NOT EXISTS rooms (room TEXT PRIMARY KEY, opened_at TEXT NOT NULL)");
		this.sql.all(
			`CREATE TABLE IF NOT EXISTS room_messages (
				room TEXT NOT NULL,
				seq INTEGER NOT NULL,
				at TEXT NOT NULL,
				sender TEXT NOT NULL,
				text TEXT NOT NULL,
				PRIMARY KEY (room, seq)
			)`,
		);
	}

	open(room: string): void {
		this.sql.all("INSERT OR IGNORE INTO rooms (room, opened_at) VALUES (?, ?)", room, new Date().toISOString());
	}

	isOpen(room: string): boolean {
		return this.sql.all("SELECT 1 FROM rooms WHERE room = ?", room).length > 0;
	}

	post(room: string, sender: string, text: string): Message {
		this.assertOpen(room);

		const minuteAgo = new Date(Date.now() - 60_000).toISOString();
		const [{ n }] = this.sql.all<{ n: number }>(
			"SELECT COUNT(*) AS n FROM room_messages WHERE room = ? AND at > ?",
			room,
			minuteAgo,
		);
		if (n >= MAX_MESSAGES_PER_MINUTE) {
			throw new RoomError(
				`Room limit reached: ${MAX_MESSAGES_PER_MINUTE} messages a minute. Wait, and check with your operator before continuing.`,
			);
		}

		const [message] = this.sql.all<Message>(
			`INSERT INTO room_messages (room, seq, at, sender, text)
			VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM room_messages WHERE room = ?), ?, ?, ?)
			RETURNING seq, at, sender, text`,
			room,
			room,
			new Date().toISOString(),
			sender,
			text,
		);
		this.sql.all("DELETE FROM room_messages WHERE room = ? AND seq <= ?", room, message.seq - KEPT_MESSAGES);

		return message;
	}

	/** The seq of the room's latest message, or 0 when it has none. */
	lastSeq(room: string): number {
		this.assertOpen(room);
		const [{ seq }] = this.sql.all<{ seq: number }>(
			"SELECT COALESCE(MAX(seq), 0) AS seq FROM room_messages WHERE room = ?",
			room,
		);

		return seq;
	}

	read(room: string, since: number, limit: number): Message[] {
		this.assertOpen(room);

		return this.sql.all<Message>(
			"SELECT seq, at, sender, text FROM room_messages WHERE room = ? AND seq > ? ORDER BY seq LIMIT ?",
			room,
			since,
			limit,
		);
	}

	private assertOpen(room: string): void {
		if (!this.isOpen(room)) {
			throw new RoomError("No such room.");
		}
	}
}
