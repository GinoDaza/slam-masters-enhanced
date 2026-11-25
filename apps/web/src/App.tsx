import { useEffect, useState } from 'react';
import { rulesById } from '@ssm/rules';
import { Fit } from './Fit.tsx';
import { GameView } from './GameView.tsx';
import { Home } from './Home.tsx';
import { Lobby } from './Lobby.tsx';
import { startNav } from './nav.ts';
import type { Online } from './play.ts';
import { Room } from './room.ts';
import { Rooms } from './Rooms.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { load, save } from './storage.ts';
import { useBack } from './useBack.ts';

const invite = (new URLSearchParams(location.search).get('room') ?? '').slice(0, 16).toUpperCase();

/**
 * Loads the ROM, then: the modes, the rooms, a room's lobby, the game. The lobby's room lives
 * here: it stays connected during its matches.
 */
export function App() {
  const [rom, setRom] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<'home' | 'rooms' | 'lobby' | 'settings' | 'game'>(invite ? 'rooms' : 'home');
  const [rules, setRulesId] = useState(() => rulesById(load('rules') ?? ''));
  const [room, setRoom] = useState<Room | null>(null);
  const [online, setOnline] = useState<Online | null>(null);

  useEffect(startNav, []);

  useEffect(() => {
    fetch('/api/rom')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => setRom(new Uint8Array(buf)))
      .catch((e: unknown) => setError(`Could not load the game: ${String(e)}`));
  }, []);

  // the host's start takes everyone with a seat into the match, from the settings too
  useEffect(() => {
    if (!room) return;
    room.onStart = (msg) => {
      const mine = msg.players.find((p) => p.peer === room.me);
      if (!mine) return; // no seat: stay in the lobby
      setOnline({ room, slots: msg.players.map((p) => p.slot), slot: mine.slot, size: msg.size, delay: msg.delay, rules: msg.rules });
      setScreen('game');
    };
    return () => {
      room.onStart = () => {};
    };
  }, [room]);

  if (error) return <Fit><section className="panel"><p>{error}</p></section></Fit>;
  if (!rom) return <Fit><section className="panel"><p>Loading game data…</p></section></Fit>;

  if (screen === 'game') {
    const leave = () => {
      online?.room.back();
      setOnline(null);
      setScreen(online ? 'lobby' : 'home');
    };
    return <GameView rom={rom} online={online} rules={online ? rulesById(online.rules) : rules} onBack={leave} />;
  }
  return (
    <Fit>
      {screen === 'home' && (
        <Home
          rules={rules}
          setRules={(id) => {
            save('rules', id);
            setRulesId(rulesById(id));
          }}
          onLocal={() => setScreen('game')}
          onOnline={() => setScreen('rooms')}
          onSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'rooms' && (
        <Rooms
          rules={rules}
          invite={invite}
          onJoin={(code, name) => {
            setRoom(new Room(code, name, rules.id));
            setScreen('lobby');
          }}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'lobby' && room && (
        <Lobby
          room={room}
          onSettings={() => setScreen('settings')}
          onBack={() => {
            room.close();
            setRoom(null);
            setScreen('rooms');
          }}
        />
      )}
      {screen === 'settings' && <MenuSettings onBack={() => setScreen(room ? 'lobby' : 'home')} />}
    </Fit>
  );
}

function MenuSettings({ onBack }: { onBack: () => void }) {
  useBack(onBack);
  return <SettingsPanel onBack={onBack} />;
}
