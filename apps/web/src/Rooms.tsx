/** Online: your name, the open rooms, a new room. */
import { useEffect, useState } from 'react';
import { rulesById, type Ruleset } from '@ssm/rules';
import { newRoomCode } from './modes.ts';
import { MAX_PLAYERS } from './room.ts';
import { load, save } from './storage.ts';
import { useBack } from './useBack.ts';

interface RoomInfo {
  code: string;
  players: string[];
  playing: boolean;
  rules: string;
  size: number;
}

/** The server's open rooms, refreshed every 2 s; null before the first answer. */
function useRooms(): { rooms: RoomInfo[] | null; failed: boolean } {
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const get = () =>
      fetch('/api/rooms')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((list: RoomInfo[]) => alive && (setRooms(list), setFailed(false)))
        .catch(() => alive && setFailed(true));
    get();
    const t = setInterval(get, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return { rooms, failed };
}

interface Props {
  rules: Ruleset;
  /** the invite link's room */
  invite: string;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}

export function Rooms({ rules, invite, onJoin, onBack }: Props) {
  const [name, setName] = useState(() => load('name') ?? '');
  const [code, setCode] = useState(invite);
  const { rooms, failed } = useRooms();
  useBack(onBack);
  const join = (room: string) => {
    if (!room.trim()) return;
    save('name', name.trim());
    onJoin(room.trim(), name.trim() || 'Player');
  };
  return (
    <section className="panel rooms-screen">
      <header>
        <h1>Online</h1>
        <label className="row">
          Your name
          <input value={name} placeholder="Player" maxLength={16} onChange={(e) => setName(e.target.value)} />
        </label>
      </header>
      <ul className="rooms">
        {failed && <li className="empty">The server does not answer. Trying again…</li>}
        {!failed && rooms?.length === 0 && <li className="empty">No open rooms. Create one and invite your friends.</li>}
        {rooms?.map((r) => (
          <li key={r.code}>
            <div>
              <b>{r.code}</b>
              <span className="help">{r.players.join(', ')}</span>
            </div>
            <span>{r.rules ? `${rulesById(r.rules).label} · ${r.size} VS ${r.size}` : ''}</span>
            <span className={r.playing ? 'tag live' : 'tag'}>{r.playing ? 'In match' : 'In lobby'}</span>
            <span className="count">{r.players.length}/{MAX_PLAYERS}</span>
            <button disabled={r.players.length >= MAX_PLAYERS} aria-label={`Join ${r.code}`} onClick={() => join(r.code)}>Join</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => (e.preventDefault(), join(code))}>
        <input placeholder="Room name" aria-label="Room name" value={code} maxLength={16} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button disabled={!code.trim()}>{invite && code === invite ? 'Join invite' : 'Join or create'}</button>
      </form>
      <footer>
        <button onClick={onBack}>Back</button>
        <button className="primary" data-first onClick={() => join(newRoomCode((rooms ?? []).map((r) => r.code)))}>Create {rules.label} room</button>
      </footer>
    </section>
  );
}
