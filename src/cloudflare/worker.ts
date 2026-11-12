import { handleRequest, matchSocketPath, type Rooms, roomKey } from "../core/app.ts";
import type { Room } from "./room.ts";

export { Room } from "./room.ts";

function room(env: Env, team: string, roomId: string): DurableObjectStub<Room> {
	return env.ROOM.get(env.ROOM.idFromName(roomKey(team, roomId)));
}

function roomsOn(env: Env): Rooms {
	return {
		open: (team, roomId) => room(env, team, roomId).open(),
		post: (team, roomId, sender, text) => room(env, team, roomId).post(sender, text),
		read: (team, roomId, since, limit) => room(env, team, roomId).read(since, limit),
		lastSeq: (team, roomId) => room(env, team, roomId).lastSeq(),
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// The room ID is the read capability: 128 random bits, shared only with the team.
		const socket = matchSocketPath(url);
		if (socket) {
			return room(env, socket.team, socket.roomId).fetch(request);
		}

		return (await handleRequest(request, roomsOn(env), env.TEAMS, url.origin)) ?? new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
