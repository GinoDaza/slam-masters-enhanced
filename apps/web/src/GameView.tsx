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
  const open = menu !== 'closed';

  useEffect(() => {
    if (!canvas.current) return;
    const p = play(canvas.current, rom, rules, online, (s) => s.desync >= 0 && setNotice(`Desync at frame ${s.desync}.`));
    playing.current = p;
    if (online) {
      online.room.onLeave = (m) => setNotice(`${m.name} left the match.`);
      online.room.onClose = () => setNotice('Lost the connection to the server.');
    }
    return () => {
      playing.current = null;
      p.stop();
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

  const size = { width: rules.screenWidth * scale, height: HEIGHT * scale };
  return (
    <div className={`game ${mouse || open ? '' : 'idle'}`}>
      <canvas ref={canvas} width={rules.screenWidth} height={HEIGHT} style={size} />
      {settings.scanlines && <div className="scanlines" style={{ ...size, backgroundSize: `100% ${scale}px` }} />}
      {notice && <p className="notice">{notice} Esc for the menu.</p>}
      {!open && mouse && <button className="corner" onClick={(e) => (e.currentTarget.blur(), setMenu('menu'))}>Menu</button>}
      {open && (
        <div className="overlay">
          <Fit>
            {menu === 'settings' ? (
              <SettingsPanel onBack={() => setMenu('menu')} />
            ) : (
              <section className="panel pause">
                <h1>{online ? 'Menu' : 'Paused'}</h1>
                {online && <p className="help">The match goes on.</p>}
                <button autoFocus onClick={() => setMenu('closed')}>Resume</button>
                <button onClick={() => setMenu('settings')}>Settings</button>
                {!online && <button onClick={() => (setRun((n) => n + 1), setMenu('closed'))}>Restart</button>}
                <button onClick={onBack}>{online ? 'Leave match' : 'Main menu'}</button>
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
