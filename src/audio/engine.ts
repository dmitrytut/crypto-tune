import * as Tone from 'tone';
import type { MetricsSnapshot } from '../metrics/engine';
import type { EventCues } from '../metrics/events';
import { AmbienceLayer } from './ambience-layer';
import { BaseLayer } from './base-layer';
import { EventsLayer } from './events-layer';
import { eventVelocity } from './events-map';
import { Mixer } from './mixer';
import { TensionLayer } from './tension-layer';
import { CALM_BPM, INITIAL_SHOCK, type ShockState, stepShock, tensionMix } from './tension-map';

const FADE_IN_SEC = 3;
const FADE_OUT_SEC = 1.5;
const MASTER_DB = -2;
/** Headroom before playback so Tone has a moment to prepare the first scheduled event. */
const LOOKAHEAD_SEC = 0.05;

export interface AudioParams {
  /** Tonic pitch class, 0 = C … 11 = B. */
  tonicPc: number;
  baseVolumeDb: number;
  tensionVolumeDb: number;
  eventsVolumeDb: number;
}

/** @package */
export type AudioState = 'stopped' | 'starting' | 'running';

interface Graph {
  mixer: Mixer;
  base: BaseLayer;
  ambience: AmbienceLayer;
  baseChannel: Tone.Volume;
  tension: TensionLayer;
  tensionChannel: Tone.Volume;
  events: EventsLayer;
  eventsChannel: Tone.Volume;
}

/**
 * Owns the Tone.js graph. Built lazily on the first start(), which must run
 * inside a user gesture (browser autoplay policy). Stop fades out and keeps
 * the graph for the next start.
 */
export class AudioEngine {
  private graph: Graph | null = null;
  private state: AudioState = 'stopped';
  /** Hysteresis state for double time, carried between ticks. */
  private doubleTime = false;
  /** Last tempo written to the transport, whole BPM; tracks the market while stopped too. */
  private bpm = CALM_BPM;
  private shock: ShockState = INITIAL_SHOCK;
  /** Context time at which the last stop's scheduled teardown (sources, transport) runs. */
  private stopAt = 0;

  constructor(private params: AudioParams) {}

  get current(): AudioState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.state = 'starting';
    await Tone.start();
    const g = this.graph ?? (await this.build());
    await g.mixer.ready;
    // A restart before the last stop's teardown would be undone by it: Tone ignores
    // transport.start while the pending stop still reads "started", then stops.
    const pending = this.stopAt - Tone.now();
    if (pending > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, pending * 1000);
      await promise;
    }
    const transport = Tone.getTransport();
    // Resume at the market's current tempo: update() keeps tracking it while stopped,
    // so restarting mid-move does not drop to calm and jump back on the next tick.
    transport.bpm.value = this.bpm;
    const t = Tone.now() + LOOKAHEAD_SEC;
    g.base.start(t);
    g.tension.start(t);
    transport.start(t);
    g.mixer.fadeMaster(MASTER_DB, FADE_IN_SEC);
    this.state = 'running';
  }

  stop(): void {
    const g = this.graph;
    if (this.state !== 'running' || !g) return;
    g.mixer.fadeMaster(Number.NEGATIVE_INFINITY, FADE_OUT_SEC);
    const end = Tone.now() + FADE_OUT_SEC + 0.1;
    this.stopAt = end;
    g.base.stop(end);
    g.tension.stop(end);
    Tone.getTransport().stop(end);
    this.state = 'stopped';
  }

  update(s: MetricsSnapshot): void {
    const mix = tensionMix(s.tension, s.direction, this.doubleTime);
    this.doubleTime = mix.doubleTime;
    // Tempo moves in whole-BPM steps, written only on change. Re-issuing
    // bpm.rampTo every tick crashes Tone 15's transport clock after ~1 min of
    // live tension (TickSource.getTicksAtTime: "reading 'time'"). 1-BPM steps
    // are inaudible, and the smoothed tension already makes them gradual.
    // Tracked even before the graph exists, so the first start() lands on it.
    const bpm = Math.round(mix.bpm);
    const bpmChanged = bpm !== this.bpm;
    this.bpm = bpm;
    const g = this.graph;
    if (!g) return;
    g.base.setTrend(s.emaZ);
    g.base.applyMix(mix);
    const shock = stepShock(this.shock, s.tension, s.ts);
    this.shock = shock.state;
    if (shock.fired && this.state === 'running') g.tension.shock(s.ret >= 0, Tone.now());
    g.tension.applyMix(mix);
    if (bpmChanged) Tone.getTransport().bpm.setValueAtTime(bpm, Tone.now());
  }

  /** Once per tick: plays the tick's event cues if audio is running. */
  play(cues: EventCues): void {
    const g = this.graph;
    if (this.state !== 'running' || !g) return;
    const t = Tone.now();
    const { liquidation: liq, trade } = cues;
    if (liq) g.events.liquidation(liq.side, eventVelocity(liq.size), t);
    if (trade) g.events.trade(trade.side, eventVelocity(trade.size), t);
  }

  setParams(next: AudioParams): void {
    const prev = this.params;
    this.params = next;
    const g = this.graph;
    if (!g) return;
    if (next.tonicPc !== prev.tonicPc) {
      g.base.setTonic(next.tonicPc);
      g.ambience.setTonic(next.tonicPc);
      g.tension.setTonic(next.tonicPc);
      g.events.setTonic(next.tonicPc);
    }
    if (next.baseVolumeDb !== prev.baseVolumeDb) {
      g.mixer.setLevel(g.baseChannel, next.baseVolumeDb);
    }
    if (next.tensionVolumeDb !== prev.tensionVolumeDb) {
      g.mixer.setLevel(g.tensionChannel, next.tensionVolumeDb);
    }
    if (next.eventsVolumeDb !== prev.eventsVolumeDb) {
      g.mixer.setLevel(g.eventsChannel, next.eventsVolumeDb);
    }
  }

  /**
   * Builds the graph a layer per task: built in one go it is a single long task right after
   * the Listen press (~150 ms at 4× CPU throttling), which delays the paint of "Starting…".
   * Every layer is built with the params as they were when the build began; a change made
   * meanwhile is applied once the graph exists.
   */
  private async build(): Promise<Graph> {
    const p = this.params;
    await yieldToMain();
    const mixer = new Mixer();
    const baseChannel = mixer.createChannel(p.baseVolumeDb);
    const tensionChannel = mixer.createChannel(p.tensionVolumeDb);
    const eventsChannel = mixer.createChannel(p.eventsVolumeDb);
    await yieldToMain();
    const base = new BaseLayer(baseChannel, p.tonicPc);
    await yieldToMain();
    const ambience = new AmbienceLayer(baseChannel, p.tonicPc);
    await yieldToMain();
    const tension = new TensionLayer(tensionChannel, p.tonicPc);
    const events = new EventsLayer(eventsChannel, p.tonicPc);
    this.graph = {
      mixer,
      baseChannel,
      tensionChannel,
      eventsChannel,
      base,
      ambience,
      tension,
      events,
    };
    // Settings changed while building: setParams diffs against what the layers were built with.
    const latest = this.params;
    this.params = p;
    this.setParams(latest);
    return this.graph;
  }
}

/** Ends the current task so the browser can paint and handle input before the next step. */
function yieldToMain(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
