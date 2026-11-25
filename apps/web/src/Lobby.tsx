/** A room before (and between) its matches: the teams, the host's choices, who is ready. */
import { useEffect, useState } from 'react';
import { PLAYABLE_RULES, rulesById } from '@ssm/rules';
import { TEAM_SEATS, autoDelay, type Member, type Room } from './room.ts';

interface Props {
  room: Room;
  onSettings: () => void;
  onBack: () => void;
}

export function Lobby({ room, onSettings, onBack }: Props) {
  const [, redraw] = useState(0);
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);
  /** host: the seat picked to move to another */
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    room.onChange = () => redraw((n) => n + 1);
    room.onClose = () => setClosed(true);
    if (room.closed) setClosed(true);
    return () => {
      room.onChange = () => {};
      room.onClose = () => {};
    };
  }, [room]);

  // the picked member moved or left meanwhile
  const pickedPeer = picked === null ? undefined : room.seated(picked)?.peer;
  useEffect(() => {
    if (picked !== null && pickedPeer === undefined) setPicked(null);
  }, [picked, pickedPeer]);

  const copyInvite = () => {
    const link = `${location.origin}/?room=${encodeURIComponent(room.code)}`;
    const done = navigator.clipboard?.writeText(link);
    if (!done) return void prompt('Invite link', link); // http: no clipboard
    done.then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => prompt('Invite link', link),
    );
  };

  if (closed)
    return (
      <section className="panel">
        <h1>Disconnected</h1>
        <p>Lost the connection to the server.</p>
        <button data-first autoFocus onClick={onBack}>Back</button>
      </section>
    );

  const rules = rulesById(room.rules);
  const sizes = rules.modeMenu ? [1, 2, 3, 4] : [1, 2];
  const host = room.members[0];
  const me = room.self;
  const seated = room.open.some((s) => room.seats[s] === room.me);
  const unready = room.open.map((s) => room.seated(s)).filter((m): m is Member => !!m && m !== host && !m.ready);
  const auto = autoDelay(room.members.map((m) => m.rtt));
  const hint =
    room.members.length < 2 ? 'Waiting for another player. Share the invite link.'
    : room.playing ? 'A match is being played.'
    : room.seats[0] === null ? 'Someone has to take seat P1: it drives the game’s menus.'
    : unready.length ? `Not ready: ${unready.map((m) => m.name).join(', ')}`
    : room.isHost ? 'Everybody is ready.'
    : 'Waiting for the host to start.';

  const press = (s: number) => {
    const m = room.seated(s);
    if (room.isHost && picked !== null) {
      if (picked !== s) room.swap(picked, s);
      setPicked(null);
    } else if (m) {
      if (room.isHost) setPicked(s);
    } else room.take(s);
  };

  return (
    <section className="panel lobby">
      <header>
        <h1>{room.code || '…'}</h1>
        <button onClick={copyInvite}>{copied ? 'Copied!' : 'Copy invite link'}</button>
        <button onClick={onSettings}>Settings</button>
      </header>

      <div className="choices">
        <Choice label="Mode" host={room.isHost} value={room.rules} text={rules.label} set={(v) => room.setRules(v)} options={PLAYABLE_RULES.map((r) => [r.id, r.label])} />
        <Choice label="Match" host={room.isHost} value={String(room.size)} text={`${room.size} VS ${room.size}`} set={(v) => room.setSize(Number(v))} options={sizes.map((n) => [String(n), `${n} VS ${n}`])} />
        <Choice
          label="Input delay"
          host={room.isHost}
          value={room.delay === null ? 'auto' : String(room.delay)}
          text={`${room.frames} frames`}
          set={(v) => room.setDelay(v === 'auto' ? null : Number(v))}
          options={[['auto', `Auto (${auto})`], ...[0, 1, 2, 3, 4, 5].map((d): [string, string] => [String(d), String(d)])]}
        />
      </div>

      <div className="teams">
        {[0, 1].map((team) => (
          <div key={team} className={`team team-${team}`}>
            <h2>{team === 0 ? 'Red corner' : 'Blue corner'}</h2>
            {room.open.filter((s) => Math.floor(s / TEAM_SEATS) === team).map((s) => {
              const m = room.seated(s);
              const target = picked !== null && picked !== s;
              const can = room.isHost || !m;
              return (
                <button
                  key={s}
                  className={`seat ${picked === s ? 'on' : ''} ${target ? 'target' : ''}`}
                  disabled={!can}
                  draggable={room.isHost && !!m}
                  onDragStart={() => setPicked(s)}
                  onDragEnd={() => setPicked(null)}
                  onDragOver={(e) => room.isHost && e.preventDefault()}
                  onDrop={() => press(s)}
                  onClick={() => press(s)}
                >
                  <b>P{room.number(s)}</b>
                  <span className="name">
                    {m ? m.name : 'CPU'}
                    {m && m.peer === room.me && ' (you)'}
                  </span>
                  <span className="state">
                    {m ? status(m, host) : target ? 'Move here' : seated || !me ? 'Free' : 'Sit here'}
                    {m && m.rtt >= 0 && <small> {m.rtt} ms</small>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="help">
        {room.isHost ? 'Press a player, then a seat, to move them. ' : 'Press a free seat to move. '}
        Empty seats are the CPU.
        {room.watching.length > 0 && ` Without a seat: ${room.watching.map((m) => m.name).join(', ')}.`}
      </p>

      <footer>
        <button onClick={onBack}>Leave room</button>
        {room.isHost && room.members.length > 1 && <button onClick={() => (setPicked(null), room.shuffle())}>Shuffle teams</button>}
        <p className="hint" role="status">{hint}</p>
        {room.isHost ? (
          <button className="primary" data-first disabled={!room.ready} onClick={() => room.start()}>{room.ready && unready.length ? 'Start anyway' : 'Start'}</button>
        ) : (
          <button className={me?.ready ? '' : 'primary'} data-first onClick={() => room.setReady(!me?.ready)}>{me?.ready ? 'Not ready' : 'Ready'}</button>
        )}
      </footer>
    </section>
  );
}

function status(m: Member, host: Member | undefined): string {
  if (m.playing) return 'In match';
  if (m === host) return 'Host';
  return m.ready ? 'Ready' : 'Not ready';
}

/** The host picks, the others read. */
function Choice({ label, host, value, text, set, options }: { label: string; host: boolean; value: string; text: string; set: (v: string) => void; options: [string, string][] }) {
  return (
    <label>
      <span>{label}</span>
      {host ? (
        <select value={value} onChange={(e) => set(e.target.value)}>
          {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      ) : (
        <b>{text}</b>
      )}
    </label>
  );
}
