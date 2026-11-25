/**
 * A room on the server's WebSocket relay (/ws). The server only relays: the peer with the
 * lowest id is the host, and its `start` message fixes the seats, the team size and the input
 * delay for everyone. Before the start the host seats the players (`seats` messages): two
 * teams of `size` seats (1 VS 1 to 4 VS 4), numbered team by team (P1-P3 against P4-P6 in
 * 3 VS 3); each seat is a pad of the game (@ssm/rules seatSlot: pad 1 is the first seat, it
 * drives the menus). Seats may stay empty (the CPU), and who has no seat waits in the lobby. A
 * player whose connection drops in a match has a while to come back (the server's `rejoin`). A
 * match ends for everybody when one of its players goes back to the lobby or leaves.
 */
import { rulesById, seatSlot } from '@ssm/rules';

export interface Member {
  peer: number;
  name: string;
  ready: boolean;
  /** in the match */
  playing: boolean;
  /** its connection dropped in the match; it may come back */
  away: boolean;
  /** its round trip to the server, ms (-1: not known yet) */
  rtt: number;
}

export interface StartMsg {
  t: 'start';
  /** each seated player's session slot */
  players: { peer: number; slot: number }[];
  /** wrestlers a team (1-4) */
  size: number;
  delay: number;
  /** Ruleset id: every peer installs the same overrides */
  rules: string;
}

/** seats a team at most */
export const TEAM_SEATS = 4;
/** players in a match at most */
export const MAX_PLAYERS = 2 * TEAM_SEATS;

/**
 * Input delay (frames) for these round trips to the server: an input crosses half of the sender's
 * and half of the receiver's. Rollback hides the rest, so it grows slower than the latency.
 */
export function autoDelay(rtts: readonly number[]): number {
  const [a = 0, b = 0] = [...rtts].sort((x, y) => y - x);
  return Math.min(4, Math.max(2, 1 + Math.ceil((a + b) / 2 / 33)));
}

/** how long a dropped player tries to come back, a little less than the server keeps its place */
const REJOIN_MS = 18_000;
const RETRY_MS = 1_000;
/** no answer from the server in this long: the connection is dead */
const SILENT_MS = 6_000;

export class Room {
  private ws!: WebSocket;
  private token = '';
  private readonly name: string;
  /** our own connection is down, being retried */
  reconnecting = false;
  private lostAt = 0;
  private heardAt = 0;
  me = -1;
  /** the room's name, as the server keeps it */
  code = '';
  members: Member[] = [];
  /** wrestlers a team (1-4), as the host set it */
  size = 2;
  /** seat team * TEAM_SEATS + place -> peer id (null: empty, the CPU); only `size` a team count */
  seats: (number | null)[] = Array<number | null>(MAX_PLAYERS).fill(null);
  /** Ruleset id, as the host set it */
  rules: string;
  /** frames of input delay, null: by the pings (autoDelay) */
  delay: number | null = null;
  onChange: () => void = () => {};
  onStart: (msg: StartMsg) => void = () => {};
  onBinary: (data: Uint8Array) => void = () => {};
  onLeave: (m: Member) => void = () => {};
  onClose: () => void = () => {};
  /** the connection is gone */
  closed = false;
  private timer = 0;

  constructor(code: string, name: string, rules: string) {
    this.rules = rules;
    this.name = name;
    this.connect(() => ({ t: 'join', room: code, name }));
    // closing the page is leaving, not a drop
    addEventListener('pagehide', this.leave);
  }

  private connect(hello: () => object): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this.heardAt = performance.now();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      this.say({ t: 'ping', id: performance.now() });
      // a close on a dead connection may take minutes to be told: drop it
      if (performance.now() - this.heardAt > SILENT_MS) this.lost(ws);
    }, 1000);
    ws.onopen = () => ws.send(JSON.stringify(hello()));
    ws.onclose = () => this.lost(ws);
    ws.onmessage = (e) => {
      this.heardAt = performance.now();
      if (e.data instanceof ArrayBuffer) return this.onBinary(new Uint8Array(e.data));
      const msg = JSON.parse(String(e.data));
      if (msg.t === 'gone') {
        this.lostAt = -Infinity;
        this.lost(ws);
      } else if (msg.t === 'joined') {
        const before = this.members;
        this.reconnecting = false;
        this.token = msg.token;
        this.me = msg.peer;
        this.code = msg.room;
        this.members = [...msg.peers.map((p: Member) => ({ ...p, rtt: -1 })), { peer: msg.peer, name: this.name, ready: msg.ready, playing: msg.playing, away: false, rtt: -1 }].sort((a, b) => a.peer - b.peer);
        this.fixSeats();
        if (this.isHost) this.sendSeats(); // the room list shows the choices
        this.onChange();
        // who left the match while we were away
        const left = before.find((m) => m.playing && m.peer !== this.me && !this.members.some((x) => x.peer === m.peer && x.playing));
        if (left) this.onLeave(left);
      } else if (msg.t === 'peer-join') {
        this.members = [...this.members, { peer: msg.peer, name: msg.name, ready: false, playing: false, away: false, rtt: -1 }].sort((a, b) => a.peer - b.peer);
        this.fixSeats();
        if (this.isHost) this.sendSeats(); // for the newcomer
        this.onChange();
      } else if (msg.t === 'peer-leave') {
        const m = this.members.find((x) => x.peer === msg.peer);
        this.members = this.members.filter((x) => x.peer !== msg.peer);
        this.fixSeats();
        this.onChange();
        if (m?.playing) this.onLeave(m);
      } else if (msg.t === 'pong') {
        const rtt = Math.round(performance.now() - msg.id);
        this.update(this.me, { rtt });
        this.say({ t: 'rtt', rtt });
        this.onChange();
      } else if (msg.t === 'rtt') {
        this.update(msg.from, { rtt: msg.rtt });
        this.onChange();
      } else if (msg.t === 'state') {
        const m = this.members.find((x) => x.peer === msg.peer);
        const left = m?.playing && !msg.playing;
        this.update(msg.peer, { ready: msg.ready, playing: msg.playing, away: msg.away });
        if (this.isHost && m?.away && !msg.away) this.sendSeats(); // it may have missed them
        this.onChange();
        if (m && left && m.peer !== this.me) this.onLeave(m);
      } else if (msg.t === 'take') {
        if (this.isHost) this.seat(msg.from, msg.seat);
      } else if (msg.t === 'seats') {
        if (msg.from !== this.members[0]?.peer) return; // only the host seats
        this.size = msg.size;
        this.rules = msg.rules;
        this.delay = msg.delay;
        this.seats = msg.seats;
        this.fixSeats();
        this.onChange();
      } else if (msg.t === 'start') {
        if (msg.from === this.members[0]?.peer) this.onStart(msg);
      }
    };
  }

  private readonly leave = () => this.close();

  /** The connection `ws` is gone: in a match, try to take our place again for a while. */
  private lost(ws: WebSocket): void {
    if (ws !== this.ws || this.closed) return;
    ws.onclose = ws.onmessage = ws.onopen = null;
    ws.close();
    clearInterval(this.timer);
    const now = performance.now();
    if (!this.reconnecting) {
      if (this.lostAt !== -Infinity) this.lostAt = now;
      this.reconnecting = !!this.self?.playing && this.lostAt === now;
    }
    if (!this.reconnecting || now - this.lostAt > REJOIN_MS) {
      this.reconnecting = false;
      this.closed = true;
      this.onClose();
      return;
    }
    this.onChange();
    this.timer = window.setTimeout(() => this.connect(() => ({ t: 'rejoin', room: this.code, token: this.token })), RETRY_MS);
  }

  private update(peer: number, change: Partial<Member>): void {
    this.members = this.members.map((m) => (m.peer === peer ? { ...m, ...change } : m));
  }

  private say(msg: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get self(): Member | undefined {
    return this.members.find((m) => m.peer === this.me);
  }

  /** Some players are still in a match: the next one waits. */
  get playing(): boolean {
    return this.members.some((m) => m.playing);
  }

  setReady(ready: boolean): void {
    this.say({ t: 'ready', ready });
  }

  /** Out of the match, in the lobby again. Send it after the match's last input. */
  back(): void {
    this.say({ t: 'back' });
  }

  /** Sit on a free seat. */
  take(seat: number): void {
    if (this.isHost) this.seat(this.me, seat);
    else this.say({ t: 'take', seat });
  }

  /** Host: move a member to a free seat. */
  private seat(peer: number, seat: number): void {
    if (!this.open.includes(seat) || this.seated(seat) || !this.members.some((m) => m.peer === peer)) return;
    this.seats = this.seats.map((p, s) => (s === seat ? peer : p === peer ? null : p));
    this.changed();
  }

  /** Host: the mode; team sizes it does not have go back to 2. */
  setRules(rules: string): void {
    if (!this.isHost) return;
    this.rules = rules;
    if (!rulesById(rules).modeMenu) this.size = Math.min(this.size, 2);
    this.changed();
  }

  /** Host: frames of input delay, null for automatic. */
  setDelay(delay: number | null): void {
    if (!this.isHost) return;
    this.delay = delay;
    this.changed();
  }

  /** The delay a match started now gets. */
  get frames(): number {
    return this.delay ?? autoDelay(this.members.map((m) => m.rtt));
  }

  /** Host: the choices changed. */
  private changed(): void {
    this.fixSeats();
    this.sendSeats();
    this.onChange();
  }

  get isHost(): boolean {
    return this.members[0]?.peer === this.me;
  }

  /** The seats that count: each team's first `size`. */
  get open(): number[] {
    return [0, 1].flatMap((team) => Array.from({ length: this.size }, (_, place) => team * TEAM_SEATS + place));
  }

  /** The member in a seat. */
  seated(seat: number): Member | undefined {
    const p = this.seats[seat];
    return p === null || p === undefined ? undefined : this.members.find((m) => m.peer === p);
  }

  /** The members without a seat that counts. */
  get watching(): Member[] {
    const open = this.open;
    return this.members.filter((m) => !open.some((s) => this.seats[s] === m.peer));
  }

  /** The player number of a seat (P1 ...): team by team. */
  number(seat: number): number {
    const team = Math.floor(seat / TEAM_SEATS);
    return team * this.size + (seat % TEAM_SEATS) + 1;
  }

  /** Host: swap seats `a` and `b` (either may be empty). */
  swap(a: number, b: number): void {
    if (!this.isHost) return;
    const next = [...this.seats];
    [next[a], next[b]] = [next[b]!, next[a]!];
    this.seats = next;
    this.changed();
  }

  /** Host: the team size; whoever loses a seat takes a free one, or watches. */
  setSize(size: number): void {
    if (!this.isHost) return;
    this.size = size;
    this.changed();
  }

  /** Host: deal the seated players to the open seats at random. */
  shuffle(): void {
    if (!this.isHost) return;
    const open = this.open;
    const people = open.map((s) => this.seats[s]!).filter((p) => p !== null);
    const next = Array<number | null>(MAX_PLAYERS).fill(null);
    const free = [...open];
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j]!, free[i]!];
    }
    people.forEach((p, k) => (next[free[k]!] = p));
    // pad 1 drives the menus: its seat is never left empty
    if (next[0] === null) {
      const k = open.find((s) => next[s] !== null)!;
      [next[0], next[k]] = [next[k]!, null];
    }
    this.seats = next;
    this.changed();
  }

  /**
   * Only present members sit, each once, in seats that count; the others (newcomers first)
   * fill the free ones, the emptier team first.
   */
  private fixSeats(): void {
    const open = this.open;
    const next = Array<number | null>(MAX_PLAYERS).fill(null);
    const seated = new Set<number>();
    for (const s of open) {
      const p = this.seats[s];
      if (p !== null && p !== undefined && !seated.has(p) && this.members.some((m) => m.peer === p)) {
        next[s] = p;
        seated.add(p);
      }
    }
    for (const m of this.members) {
      if (seated.has(m.peer)) continue;
      const count = (team: number) => open.filter((s) => Math.floor(s / TEAM_SEATS) === team && next[s] !== null).length;
      const free = open.filter((s) => next[s] === null).sort((a, b) => count(Math.floor(a / TEAM_SEATS)) - count(Math.floor(b / TEAM_SEATS)) || a - b);
      if (!free.length) break;
      next[free[0]!] = m.peer;
      seated.add(m.peer);
    }
    this.seats = next;
  }

  private sendSeats(): void {
    this.say({ t: 'seats', seats: this.seats, size: this.size, rules: this.rules, delay: this.delay });
  }

  /** Pad 1's seat (the first of team 1) is taken: the game can start. */
  get ready(): boolean {
    return this.seats[0] !== null && this.members.length > 1 && !this.playing;
  }

  /** Host: start the match for everyone in the room (the host included). */
  start(): void {
    if (!this.isHost || !this.ready) return;
    const players = this.open
      .filter((s) => this.seats[s] !== null)
      .map((s) => ({ peer: this.seats[s]!, slot: seatSlot(this.size, Math.floor(s / TEAM_SEATS), s % TEAM_SEATS) }));
    const msg: StartMsg = { t: 'start', players, size: this.size, delay: this.frames, rules: this.rules };
    this.say(msg);
    this.onStart(msg);
  }

  sendBinary(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void {
    this.closed = true;
    removeEventListener('pagehide', this.leave);
    clearInterval(this.timer);
    this.ws.onclose = null;
    this.ws.close(1000); // on purpose
  }
}
