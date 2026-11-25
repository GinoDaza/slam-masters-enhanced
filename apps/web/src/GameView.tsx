/**
 * The game alone on a black screen. Esc (or the corner button, shown when the mouse moves) opens
 * the menu: a local game pauses; online the match goes on behind it, without the local controls.
 */
import { useEffect, useRef, useState } from 'react';
import { HEIGHT } from '@ssm/core';
import type { Ruleset } from '@ssm/rules';
import { Fit, useGameScale } from './Fit.tsx';
import { play, type Online, type Playing } from './play.ts';
import { SettingsPanel, useSettings } from './SettingsPanel.tsx';

export function GameView({ rom, online, rules, onBack }: { rom: Uint8Array; online: Online | null; rules: Ruleset; onBack: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playing = useRef<Playing | null>(null);
  const settings = useSettings();
  const scale = useGameScale(rules.screenWidth, settings.scaling === 'integer');
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<'closed' | 'menu' | 'settings'>('closed');
  const [run, setRun] = useState(0); // a restart is a new run
  const mouse = useMouseMoving();
  const [waiting, setWaiting] = useState('');
  /** who ended the online match, or '' */
  const [ended, setEnded] = useState('');
  const open = menu !== 'closed' || !!ended;

  useEffect(() => {
    if (!canvas.current) return;
    const p = play(canvas.current, rom, rules, online, (s) => s.desync >= 0 && setNotice(`Desync at frame ${s.desync}.`));
    playing.current = p;
    if (online) {
      const room = online.room;
      room.onChange = () => {
        const away = room.members.filter((m) => m.away && m.playing).map((m) => m.name);
        setWaiting(room.reconnecting ? 'Reconnecting…' : away.length ? `Waiting for ${away.join(', ')} to reconnect…` : '');
      };
      // the match cannot go on without one of its players
      online.room.onLeave = (m) => setEnded(`${m.name} left the match.`);
      online.room.onClose = () => setEnded('Lost the connection to the server.');
      if (online.room.closed) setEnded('Lost the connection to the server.');
    }
    return () => {
      playing.current = null;
      p.stop();
      if (online) online.room.onLeave = online.room.onClose = online.room.onChange = () => {};
    };
  }, [rom, online, rules, run]);

  useEffect(() => playing.current?.menu(open), [open, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) setMenu((m) => (m === 'closed' ? 'menu' : m === 'settings' ? 'menu' : 'closed'));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // stop first: nothing of this match is sent once the lobby knows we are back
  const leave = () => {
    playing.current?.stop();
    onBack();
  };

  const size = { width: rules.screenWidth * scale, height: HEIGHT * scale };
  return (
    <div className={`game ${mouse || open ? '' : 'idle'}`}>
      <canvas ref={canvas} width={rules.screenWidth} height={HEIGHT} style={size} />
      {settings.scanlines && <div className="scanlines" style={{ ...size, backgroundSize: `100% ${scale}px` }} />}
      {waiting && !ended && <p className="notice" role="status">{waiting}</p>}
      {!waiting && notice && <p className="notice">{notice} Esc for the menu.</p>}
      {!open && mouse && <button className="corner" onClick={(e) => (e.currentTarget.blur(), setMenu('menu'))}>Menu</button>}
      {open && (
        <div className="overlay">
          <Fit>
            {ended ? (
              <section className="panel pause">
                <h1>Match over</h1>
                <p>{ended}</p>
                <button className="primary" autoFocus data-first onClick={leave}>Back to lobby</button>
              </section>
            ) : menu === 'settings' ? (
              <SettingsPanel onBack={() => setMenu('menu')} />
            ) : (
              <section className="panel pause">
                <h1>{online ? 'Menu' : 'Paused'}</h1>
                {online && <p className="help">The match goes on. Ending it takes everybody back to the lobby.</p>}
                <button autoFocus data-first onClick={() => setMenu('closed')}>Resume</button>
                <button onClick={() => setMenu('settings')}>Settings</button>
                {!online && <button onClick={() => (setRun((n) => n + 1), setMenu('closed'))}>Restart</button>}
                <button onClick={leave}>{online ? 'End match' : 'Main menu'}</button>
              </section>
            )}
          </Fit>
        </div>
      )}
    </div>
  );
}

/** Whether the mouse moved in the last 2 s. */
function useMouseMoving(): boolean {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let t = 0;
    const on = () => {
      setMoving(true);
      clearTimeout(t);
      t = window.setTimeout(() => setMoving(false), 2000);
    };
    addEventListener('mousemove', on);
    return () => {
      clearTimeout(t);
      removeEventListener('mousemove', on);
    };
  }, []);
  return moving;
}
