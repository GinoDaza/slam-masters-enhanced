/**
 * Runs the game in the page at 60 frames a second: picture on a canvas, sound through Web
 * Audio. Local play steps the game with the local pads; online play ticks a Netplay session,
 * which may re-simulate frames (the renderer and the sound are detached meanwhile).
 */
import { Game, HEIGHT, Netplay, Renderer, RomImage, Sound } from '@ssm/core';
import { installRules, plugMultitap, presetTeamSize, type Ruleset } from '@ssm/rules';
import { Speaker } from './audio.ts';
import { hiddenTicks } from './ticks.ts';
import { Controls } from './input.ts';
import type { Room } from './room.ts';
import { getSettings, onSettings } from './settings.ts';

const FRAME_MS = 1000 / 60;

export interface Online {
  room: Room;
  /** the session slots in play (the seated players' pads), and the local one */
  slots: number[];
  slot: number;
  /** wrestlers a team, the lobby's (the Game Mode Select comes up on it) */
  size: number;
  delay: number;
  /** Ruleset id */
  rules: string;
}

export interface Stats {
  frame: number;
  rollbacks: number;
  resimulated: number;
  stalls: number;
  skipped: number;
  lead: number;
  desync: number;
}

export interface Playing {
  /** A menu is open over the game: a local game pauses, an online one goes on without the local controls. */
  menu(open: boolean): void;
  stop(): void;
}

/** Start the game. */
export function play(canvas: HTMLCanvasElement, rom: Uint8Array, rules: Ruleset, online: Online | null, onStats: (s: Stats) => void): Playing {
  const controls = new Controls(online !== null);
  controls.attach();
  const speaker = new Speaker();
  const setVolume = () => {
    const s = getSettings();
    speaker.setVolume(s.muted ? 0 : s.volume);
  };
  setVolume();
  const offSettings = onSettings(setVolume);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(rules.screenWidth, HEIGHT);
  const game = new Game(new RomImage(rom));
  installRules(game, rules);
  const renderer = new Renderer(game.m, rules.screenWidth);
  renderer.attach();
  const sound = new Sound(game.m);
  sound.attach();
  speaker.start().catch((e: unknown) => console.warn('no sound:', e));
  game.powerOn();
  // the multitap, found by the game at power-on: pads 3 and 4 play with it. Locally the
  // gamepads connected now count (they show up after their first button press)
  game.m.multitap = plugMultitap(rules, online?.size ?? 1, controls.players());
  if (online && rules.modeMenu) presetTeamSize(game.m, online.size);

  let net: Netplay | null = null;
  if (online) {
    net = new Netplay(game, { slots: online.slots, slot: online.slot, delay: online.delay });
    net.send = (data) => online.room.sendBinary(data);
    online.room.onBinary = (data) => net!.receive(data);
    net.session.onResim = (active) => {
      if (active) {
        renderer.detach();
        sound.detach();
      } else {
        renderer.attach();
        sound.attach();
      }
    };
  }

  let paused = false;
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let statsAt = 0;
  const advance = (now: number) => {
    acc += Math.min(now - last, 100);
    last = now;
    let ran = false;
    if (paused) acc = 0;
    while (acc >= FRAME_MS) {
      acc -= FRAME_MS;
      const pads = controls.read();
      if (net) {
        // keyboard and the first gamepad drive the local slot
        if (net.tick(pads[0]!)) ran = true;
      } else {
        game.step(pads);
        ran = true;
      }
      speaker.push(sound.take());
    }
    if (ran && !document.hidden) {
      renderer.toRgba(image.data);
      ctx.putImageData(image, 0, 0);
    }
    if (net && now - statsAt > 250) {
      statsAt = now;
      const s = net.session;
      onStats({ frame: s.frame, rollbacks: s.rollbacks, resimulated: s.resimulated, stalls: net.stalls, skipped: net.skipped, lead: net.lead, desync: net.desync });
    }
  };
  const loop = (now: number) => {
    advance(now);
    raf = requestAnimationFrame(loop);
  };
  // the other players wait for this one's inputs: a match goes on in a hidden tab
  const offTicks = online ? hiddenTicks(advance) : () => {};
  raf = requestAnimationFrame(loop);

  return {
    menu(open) {
      controls.block(open);
      paused = open && !online;
      speaker.pause(paused);
    },
    stop() {
      offSettings();
      offTicks();
      cancelAnimationFrame(raf);
      controls.detach();
      speaker.stop();
      if (online) online.room.onBinary = () => {};
    },
  };
}
