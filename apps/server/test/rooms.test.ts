/** The relay: who hosts, what it passes on, and who is in the match. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachRooms, type RoomInfo } from '../src/rooms.ts';

let server: Server;
let list: () => RoomInfo[];
const open: WebSocket[] = [];

beforeEach(async () => {
  server = createServer();
  list = attachRooms(server, 150);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
});
afterEach(() => {
  for (const ws of open.splice(0)) ws.terminate();
  server.close();
});

interface Client {
  id: number;
  got: Record<string, unknown>[];
  say(m: unknown): void;
  /** everything sent before this is handled */
  sync(): Promise<void>;
  leave(): void;
}

async function join(name: string, hello: object = { t: 'join', room: 'ring', name }): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
  open.push(ws);
  const got: Record<string, unknown>[] = [];
  const waits: (() => void)[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Record<string, unknown>;
    if (m['t'] === 'pong') waits.shift()?.();
    else got.push(m);
  });
  await new Promise((done) => ws.on('open', done));
  const say = (m: unknown) => ws.send(JSON.stringify(m));
  const sync = () => new Promise<void>((done) => (waits.push(done), say({ t: 'ping', id: 0 })));
  say(hello);
  await sync();
  return { id: got[0]!['peer'] as number, got, say, sync, leave: () => ws.terminate() };
}

it('a match starts, its players come back, and a newcomer sees who plays', async () => {
  const a = await join('A');
  const b = await join('B');
  a.say({ t: 'seats', seats: [], size: 3, rules: 'team-arena' });
  b.say({ t: 'ready', ready: true });
  await Promise.all([a.sync(), b.sync()]);
  a.say({ t: 'start', players: [{ peer: a.id }, { peer: b.id }] });
  await a.sync();
  expect(list()).toEqual([{ code: 'RING', players: ['A', 'B'], playing: true, rules: 'team-arena', size: 3 }]);
  const c = await join('C');
  expect(c.got[0]!['peers']).toEqual([
    { peer: a.id, name: 'A', ready: false, playing: true, away: false },
    { peer: b.id, name: 'B', ready: true, playing: true, away: false },
  ]);
  a.say({ t: 'back' });
  await a.sync();
  expect(list()[0]!.playing).toBe(true);
  b.say({ t: 'back' });
  await b.sync();
  expect(list()[0]!.playing).toBe(false);
  await c.sync();
  expect(c.got.at(-1)).toEqual({ t: 'state', peer: b.id, ready: false, playing: false, away: false });
});

it('only the host seats and starts; unknown and server messages are not relayed', async () => {
  const a = await join('A');
  const b = await join('B');
  const seen = a.got.length;
  b.say({ t: 'start', players: [{ peer: a.id }] });
  b.say({ t: 'seats', seats: [], size: 1, rules: 'x' });
  b.say({ t: 'joined', peer: 9 });
  b.say(null);
  b.say({ t: 'take', seat: 3, from: 77 });
  await b.sync();
  await a.sync();
  expect(a.got.slice(seen)).toEqual([{ t: 'take', seat: 3, from: b.id }]);
  expect(list()[0]!.playing).toBe(false);
});

it('the next peer hosts when the host leaves', async () => {
  const a = await join('A');
  const b = await join('B');
  const c = await join('C');
  a.leave();
  while (!b.got.some((m) => m['t'] === 'peer-leave')) await b.sync();
  b.say({ t: 'start', players: [{ peer: b.id }] });
  await b.sync();
  await c.sync();
  expect(c.got.some((m) => m['t'] === 'start')).toBe(true);
});

it('a player who drops in a match takes its place again; too late, it is gone', async () => {
  const a = await join('A');
  const b = await join('B');
  a.say({ t: 'start', players: [{ peer: a.id }, { peer: b.id }] });
  await a.sync();
  const token = b.got[0]!['token'];
  const away = () => a.got.filter((m) => m['t'] === 'state' && m['peer'] === b.id).at(-1)?.['away'];
  b.leave();
  while (!away()) await a.sync();
  const again = await join('B', { t: 'rejoin', room: 'RING', token });
  expect(again.id).toBe(b.id);
  expect(again.got[0]).toMatchObject({ t: 'joined', playing: true, peers: [{ peer: a.id, playing: true }] });
  await a.sync();
  expect(away()).toBe(false);
  await new Promise((done) => setTimeout(done, 250)); // the old place's time is over
  await a.sync();
  expect(a.got.some((m) => m['t'] === 'peer-leave')).toBe(false);

  again.leave();
  while (!a.got.some((m) => m['t'] === 'peer-leave')) {
    await new Promise((done) => setTimeout(done, 20));
    await a.sync();
  }
  expect((await join('B', { t: 'rejoin', room: 'RING', token })).got[0]).toEqual({ t: 'gone' });
});
