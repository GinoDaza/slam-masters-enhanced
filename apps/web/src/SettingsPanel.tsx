/** The settings screen: controls, sound, picture. Changes apply at once, in a match too. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { connectedGamepads } from './input.ts';
import { BUTTONS, BUTTON_HELP, bindButton, bindKey, buttonsOf, defaults, getSettings, keyName, onSettings, setSettings, type Button, type Settings } from './settings.ts';

export const useSettings = (): Settings => useSyncExternalStore(onSettings, getSettings);

const TABS = ['Controls', 'Sound', 'Picture'] as const;

export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Controls');
  return (
    <section className="panel settings">
      <h1>Settings</h1>
      <div className="row" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 'Controls' && <ControlSettings />}
        {tab === 'Sound' && <SoundSettings />}
        {tab === 'Picture' && <PictureSettings />}
      </div>
      <button onClick={onBack}>Back</button>
    </section>
  );
}

/** The connected gamepads, looked up twice a second. */
function useGamepads(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const look = () => {
      const now = [...new Set(connectedGamepads().map((g) => g.id))];
      setIds((was) => (was.join('\n') === now.join('\n') ? was : now));
    };
    look();
    const t = setInterval(look, 500);
    return () => clearInterval(t);
  }, []);
  return ids;
}

function ControlSettings() {
  const s = useSettings();
  const pads = useGamepads();
  /** 'k0', 'k1' or a gamepad's id */
  const [device, setDevice] = useState('k0');
  const [waiting, setWaiting] = useState<Button | null>(null);
  const keyboard = device === 'k0' ? 0 : device === 'k1' ? 1 : null;
  const gone = keyboard === null && !pads.includes(device);

  useEffect(() => {
    if (gone) {
      setDevice('k0');
      setWaiting(null);
    }
  }, [gone]);

  // take the next key, or the next new press of the gamepad's buttons; Esc cancels
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Esc does not close the menu
      if (e.code !== 'Escape') {
        if (keyboard === null || e.repeat) return;
        setSettings(bindKey(getSettings(), keyboard, waiting, e.code));
      }
      setWaiting(null);
    };
    addEventListener('keydown', onKey, true);
    let raf = 0;
    let before: Set<number> | null = null;
    const poll = () => {
      const now = new Set(connectedGamepads().filter((g) => g.id === device).flatMap((g) => g.buttons.flatMap((b, i) => (b.pressed ? [i] : []))));
      const fresh = before && [...now].find((i) => !before!.has(i));
      if (fresh !== null && fresh !== undefined) {
        setSettings(bindButton(getSettings(), device, waiting, fresh));
        setWaiting(null);
        return;
      }
      before = now;
      raf = requestAnimationFrame(poll);
    };
    if (keyboard === null) raf = requestAnimationFrame(poll);
    return () => {
      removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
    };
  }, [waiting, device, keyboard]);

  const reset = () => {
    if (keyboard !== null) {
      // both layouts: a key of one may be bound in the other
      setSettings({ ...s, keyboards: defaults().keyboards });
    } else {
      const gamepads = { ...s.gamepads };
      delete gamepads[device];
      setSettings({ ...s, gamepads });
    }
  };
  const bound = (b: Button) => {
    if (keyboard !== null) return keyName(s.keyboards[keyboard][b]);
    const i = buttonsOf(s, device)[b];
    return i < 0 ? '—' : `Button ${i}`;
  };

  return (
    <>
      <div className="row">
        <label className="row">
          Device
          <select value={device} onChange={(e) => (setWaiting(null), setDevice(e.target.value))}>
            <option value="k0">Keyboard, player 1</option>
            <option value="k1">Keyboard, player 2</option>
            {pads.map((id) => <option key={id} value={id}>{id.replace(/\s*\(.*$/, '') || 'Gamepad'}</option>)}
          </select>
        </label>
        <button onClick={reset}>{keyboard !== null ? 'Reset keyboards' : 'Reset gamepad'}</button>
      </div>
      <div className="binds">
        {BUTTONS.map((b) => (
          <div key={b}>
            <span>{BUTTON_HELP[b]}</span>
            <button className={waiting === b ? 'on' : ''} aria-label={`${BUTTON_HELP[b]}: ${bound(b)}`} onClick={() => setWaiting(waiting === b ? null : b)}>
              {waiting === b ? (keyboard !== null ? 'Press a key…' : 'Press a button…') : bound(b)}
            </button>
          </div>
        ))}
      </div>
      <p className="help">
        {pads.length === 0 && 'Press any button of a gamepad to see it here. '}Esc cancels.
      </p>
      <label className="row">
        <input type="checkbox" checked={s.keyboard2} onChange={(e) => setSettings({ ...s, keyboard2: e.target.checked })} />
        Second player on the keyboard (local games)
      </label>
      <label className="row">
        First gamepad (local games)
        <select value={s.firstGamepad} onChange={(e) => setSettings({ ...s, firstGamepad: e.target.value === '2' ? 2 : 1 })}>
          <option value={1}>Player 1, with the keyboard</option>
          <option value={2}>Player 2</option>
        </select>
      </label>
    </>
  );
}

function SoundSettings() {
  const s = useSettings();
  return (
    <>
      <label className="row">
        Volume
        <input type="range" min={0} max={100} value={s.volume} onChange={(e) => setSettings({ ...s, volume: Number(e.target.value), muted: false })} />
        <output>{s.volume}</output>
      </label>
      <label className="row">
        <input type="checkbox" checked={s.muted} onChange={(e) => setSettings({ ...s, muted: e.target.checked })} />
        Mute
      </label>
    </>
  );
}

function PictureSettings() {
  const s = useSettings();
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return (
    <>
      <label className="row">
        Size
        <select value={s.scaling} onChange={(e) => setSettings({ ...s, scaling: e.target.value === 'integer' ? 'integer' : 'fill' })}>
          <option value="fill">Fill the window</option>
          <option value="integer">Whole pixels</option>
        </select>
      </label>
      <label className="row">
        <input type="checkbox" checked={s.scanlines} onChange={(e) => setSettings({ ...s, scanlines: e.target.checked })} />
        Scanlines
      </label>
      <label className="row">
        <input type="checkbox" checked={full} onChange={() => void toggleFullscreen()} />
        Full screen
      </label>
    </>
  );
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return await document.exitFullscreen();
    await document.documentElement.requestFullscreen();
    // where it exists (Chromium, https or localhost): Esc stays the game's menu
    await (navigator as { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard?.lock?.(['Escape']);
  } catch {
    // refused: stay as it is
  }
}
