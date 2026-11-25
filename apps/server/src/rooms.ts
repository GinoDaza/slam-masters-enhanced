/**
 * Rooms over WebSocket (/ws). The server relays; it never decides game state. JSON
 * messages for control, binary messages (game inputs) relayed as they are. The host is the
 * peer that joined first.
 *   client -> server  {t: 'join', room, name}   {t: 'ping', id}
 *                     {t: 'ready', ready}       {t: 'back'} (out of the match, in the lobby)
 *                     {t: 'seats'} / {t: 'start'} from the host, {t: 'take'} / {t: 'rtt'}: relayed
 *   server -> client  {t: 'joined', room, peer, peers}  {t: 'peer-join'|'peer-leave', peer}
 *                     {t: 'state', peer, ready, playing}  {t: 'pong', id}
 * A `start` puts its players in the match; `back` or leaving takes them out. Messages of one
 * peer keep their order, so once everybody is back no input of the old match is on its way.
 * The room list is public: GET /api/rooms.
 */
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

interface Peer {
  id: number;
  name: string;
  ready: boolean;
  playing: boolean;
  ws: WebSocket;
}

interface Room {
  peers: Map<number, Peer>;
  /** the host's choices, for the list */
  rules: string;
  size: number;
}

export interface RoomInfo {
  code: string;
  players: string[];
  playing: boolean;
  rules: string;
  size: number;
}

interface Msg {
  t?: unknown;
  room?: unknown;
  name?: unknown;
  id?: unknown;
  ready?: unknown;
  rules?: unknown;
  size?: unknown;
  players?: unknown;
}

const HOST_ONLY = new Set<unknown>(['seats', 'start']);
const RELAYED = new Set<unknown>(['seats', 'start', 'take', 'rtt']);

/** Attaches the relay; returns the current room list. */
export function attachRooms(server: Server): () => RoomInfo[] {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map<string, Room>();
  let nextId = 1;

  wss.on('connection', (ws) => {
    let code = '';
    let room: Room | null = null;
    let me: Peer | null = null;
    const id = nextId++;

    ws.on('message', (raw, binary) => {
      if (binary) {
        if (room) relay(room, id, raw as Buffer, true);
        return;
      }
      let msg: Msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null) return;
      if (msg.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong', id: msg.id }));
      } else if (msg.t === 'join' && typeof msg.room === 'string' && !room) {
        code = msg.room.slice(0, 16).toUpperCase();
        room = rooms.get(code) ?? { peers: new Map<number, Peer>(), rules: '', size: 2 };
        rooms.set(code, room);
        const others = [...room.peers.values()].map(({ id: peer, name, ready, playing }) => ({ peer, name, ready, playing }));
        me = { id, name: (typeof msg.name === 'string' ? msg.name : `player${id}`).slice(0, 16), ready: false, playing: false, ws };
        room.peers.set(id, me);
        ws.send(JSON.stringify({ t: 'joined', room: code, peer: id, peers: others }));
        relay(room, id, JSON.stringify({ t: 'peer-join', peer: id, name: me.name }), false);
      } else if (!room || !me) {
        return;
      } else if (msg.t === 'ready') {
        me.ready = msg.ready === true;
        state(room, me);
      } else if (msg.t === 'back') {
        me.playing = me.ready = false;
        state(room, me);
      } else if (RELAYED.has(msg.t)) {
        if (HOST_ONLY.has(msg.t) && hostOf(room) !== me) return;
        if (msg.t === 'seats') {
          if (typeof msg.rules === 'string') room.rules = msg.rules.slice(0, 32);
          if (typeof msg.size === 'number') room.size = msg.size;
        }
        relay(room, id, JSON.stringify({ ...msg, from: id }), false);
        if (msg.t === 'start' && Array.isArray(msg.players)) {
          for (const p of msg.players as { peer?: unknown }[]) {
            const peer = room.peers.get(Number(p?.peer));
            if (!peer) continue;
            peer.playing = true;
            state(room, peer);
          }
        }
      }
    });

    ws.on('close', () => {
      if (!room) return;
      room.peers.delete(id);
      if (room.peers.size === 0) rooms.delete(code);
      else relay(room, id, JSON.stringify({ t: 'peer-leave', peer: id }), false);
    });
  });

  /** The peer that joined first. */
  function hostOf(room: Room): Peer | undefined {
    return room.peers.values().next().value;
  }

  /** Tell everyone, the peer itself included. */
  function state(room: Room, p: Peer): void {
    relay(room, -1, JSON.stringify({ t: 'state', peer: p.id, ready: p.ready, playing: p.playing }), false);
  }

  function relay(room: Room, from: number, data: Buffer | string, binary: boolean): void {
    for (const p of room.peers.values()) if (p.id !== from) p.ws.send(data, { binary });
  }

  return () =>
    [...rooms].map(([code, { peers, rules, size }]) => {
      const all = [...peers.values()];
      return { code, players: all.map((p) => p.name), playing: all.some((p) => p.playing), rules, size };
    });
}
