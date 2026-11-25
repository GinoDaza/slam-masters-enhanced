/**
 * Rooms over WebSocket (/ws). The server relays; it never decides game state. JSON
 * messages for control, binary messages (game inputs) relayed as they are. The host is the
 * peer that joined first.
 *   client -> server  {t: 'join', room, name}   {t: 'ping', id}   {t: 'rejoin', room, token}
 *                     {t: 'ready', ready}       {t: 'back'} (out of the match, in the lobby)
 *                     {t: 'seats'} / {t: 'start'} from the host, {t: 'take'} / {t: 'rtt'}: relayed
 *   server -> client  {t: 'joined', room, peer, token, peers}  {t: 'peer-join'|'peer-leave', peer}
 *                     {t: 'state', peer, ready, playing, away}  {t: 'pong', id}  {t: 'gone'}
 * A `start` puts its players in the match; `back` or leaving takes them out. Messages of one
 * peer keep their order, so once everybody is back no input of the old match is on its way.
 * A player whose connection drops in a match is `away` for AWAY_MS: a `rejoin` with its token takes
 * its place again (the netplay resends what got lost). Dead connections are found by pings.
 * The room list is public: GET /api/rooms.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

interface Peer {
  id: number;
  name: string;
  ready: boolean;
  playing: boolean;
  /** the connection dropped in a match; it may come back */
  away: boolean;
  token: string;
  timer: NodeJS.Timeout | undefined;
  ws: WebSocket;
}

interface Room {
  code: string;
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
  token?: unknown;
  name?: unknown;
  id?: unknown;
  ready?: unknown;
  rules?: unknown;
  size?: unknown;
  players?: unknown;
}

const HOST_ONLY = new Set<unknown>(['seats', 'start']);
const RELAYED = new Set<unknown>(['seats', 'start', 'take', 'rtt']);

const AWAY_MS = 20_000;
/** a connection that does not answer a ping until the next is dead */
const PING_MS = 5_000;

/** Attaches the relay; returns the current room list. */
export function attachRooms(server: Server, awayMs = AWAY_MS): () => RoomInfo[] {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map<string, Room>();
  let nextId = 1;
  const alive = new WeakSet<WebSocket>();
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.delete(ws)) ws.terminate();
      else ws.ping();
    }
  }, PING_MS);
  beat.unref();
  server.on('close', () => clearInterval(beat));

  wss.on('connection', (ws) => {
    let code = '';
    let room: Room | null = null;
    let me: Peer | null = null;
    let id = nextId++;
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    ws.on('message', (raw, binary) => {
      alive.add(ws);
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
        room = rooms.get(code) ?? { code, peers: new Map<number, Peer>(), rules: '', size: 2 };
        rooms.set(code, room);
        me = { id, name: (typeof msg.name === 'string' ? msg.name : `player${id}`).slice(0, 16), ready: false, playing: false, away: false, token: randomUUID(), timer: undefined, ws };
        room.peers.set(id, me);
        welcome(room, me);
        relay(room, id, JSON.stringify({ t: 'peer-join', peer: id, name: me.name }), false);
      } else if (msg.t === 'rejoin' && typeof msg.room === 'string' && !room) {
        const r = rooms.get(msg.room);
        const p = [...(r?.peers.values() ?? [])].find((x) => x.token === msg.token);
        if (!r || !p) return void ws.send(JSON.stringify({ t: 'gone' }));
        code = msg.room;
        room = r;
        me = p;
        id = p.id;
        clearTimeout(p.timer);
        const old = p.ws;
        p.ws = ws;
        p.away = false;
        if (old !== ws) old.terminate();
        welcome(r, p);
        state(r, p);
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

    ws.on('close', (clean) => {
      if (!room || !me || me.ws !== ws) return; // a rejoin took its place
      const r = room;
      const p = me;
      // a close on purpose (1000) leaves at once
      if (!p.playing || clean === 1000) return remove(r, code, p);
      p.away = true;
      p.timer = setTimeout(() => remove(r, code, p), awayMs);
      state(r, p);
    });
  });

  function remove(room: Room, code: string, p: Peer): void {
    clearTimeout(p.timer);
    room.peers.delete(p.id);
    if (room.peers.size === 0) rooms.delete(code);
    else relay(room, p.id, JSON.stringify({ t: 'peer-leave', peer: p.id }), false);
  }

  function welcome(room: Room, p: Peer): void {
    const peers = [...room.peers.values()].filter((x) => x !== p).map(({ id: peer, name, ready, playing, away }) => ({ peer, name, ready, playing, away }));
    p.ws.send(JSON.stringify({ t: 'joined', room: room.code, peer: p.id, token: p.token, ready: p.ready, playing: p.playing, peers }));
  }

  /** The peer that joined first. */
  function hostOf(room: Room): Peer | undefined {
    return room.peers.values().next().value;
  }

  /** Tell everyone, the peer itself included. */
  function state(room: Room, p: Peer): void {
    relay(room, -1, JSON.stringify({ t: 'state', peer: p.id, ready: p.ready, playing: p.playing, away: p.away }), false);
  }

  function relay(room: Room, from: number, data: Buffer | string, binary: boolean): void {
    for (const p of room.peers.values()) if (p.id !== from && p.ws.readyState === p.ws.OPEN) p.ws.send(data, { binary });
  }

  return () =>
    [...rooms].map(([code, { peers, rules, size }]) => {
      const all = [...peers.values()];
      return { code, players: all.map((p) => p.name), playing: all.some((p) => p.playing), rules, size };
    });
}
