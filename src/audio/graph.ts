import type * as Tone from 'tone';
import type { MetricsSnapshot } from '../metrics/engine';
import type { EventCues } from '../metrics/events';
import { AmbienceLayer } from './ambience-layer';
import { BaseLayer } from './base-layer';
import { EventsLayer } from './events-layer';
import { eventVelocity } from './events-map';
import { InteractionVoice } from './interaction-voice';
import { Mixer } from './mixer';
import { TensionLayer } from './tension-layer';
import { CALM_BPM, INITIAL_SHOCK, type ShockState, stepShock, tensionMix } from './tension-map';

const FADE_IN_SEC = 3;
const MASTER_DB = -2;
/**
 * Headroom before playback so Tone has a moment to prepare the first scheduled event.
 * @package
 */
export const LOOKAHEAD_SEC = 0.05;

export interface AudioParams {
  /** Tonic pitch class, 0 = C … 11 = B. */
  tonicPc: number;
  baseVolumeDb: number;
  tensionVolumeDb: number;
  eventsVolumeDb: number;
  interactionSound: boolean;
}

/**
 * Every node of the music, built in one Tone context.
 * @package
 */
export interface Graph {
  mixer: Mixer;
  base: BaseLayer;
  ambience: AmbienceLayer;
  baseChannel: Tone.Volume;
  tension: TensionLayer;
  tensionChannel: Tone.Volume;
  events: EventsLayer;
  interaction: InteractionVoice;
  eventsChannel: Tone.Volume;
}

/**
 * Builds the graph in Tone's current context, yielding between layers. Live, each yield ends a
 * task so the Listen press stays responsive; offline it runs straight through, because the
 * global context points at the offline one only while nothing else can run.
 * @package
 */
export function* buildGraph(p: AudioParams): Generator<void, Graph, void> {
  const mixer = new Mixer();
  const baseChannel = mixer.createChannel(p.baseVolumeDb);
  const tensionChannel = mixer.createChannel(p.tensionVolumeDb);
  const eventsChannel = mixer.createChannel(p.eventsVolumeDb);
  yield;
  const base = new BaseLayer(baseChannel, p.tonicPc);
  yield;
  const ambience = new AmbienceLayer(baseChannel, p.tonicPc);
  yield;
  const tension = new TensionLayer(tensionChannel, p.tonicPc);
  const events = new EventsLayer(eventsChannel, p.tonicPc);
  const interaction = new InteractionVoice(eventsChannel, p.tonicPc);
  return {
    mixer,
    baseChannel,
    tensionChannel,
    eventsChannel,
    base,
    ambience,
    tension,
    events,
    interaction,
  };
}

/**
 * Starts the music at `time` of the graph's context, at `bpm`, fading the bus in.
 * @package
 */
export function startGraph(g: Graph, bpm: number, time: number): void {
  const transport = g.mixer.context.transport;
  transport.bpm.value = bpm;
  g.base.start(time);
  g.tension.start(time);
  transport.start(time);
  g.mixer.fadeMaster(MASTER_DB, FADE_IN_SEC);
}

/**
 * Turns each metrics tick into music: the mix, tempo, shock swell and event voices. Time and
 * transport come from the graph's own context, so the same code plays live and offline.
 * @package
 */
export class Conductor {
  /** Hysteresis state for double time, carried between ticks. */
  private doubleTime = false;
  /** Current market tempo, whole BPM; written while playing and applied at each start. */
  bpm = CALM_BPM;
  private shock: ShockState = INITIAL_SHOCK;

  /** `sounding`: the music is playing, so a shock may swell. */
  update(s: MetricsSnapshot, g: Graph | null, sounding: boolean): void {
    const mix = tensionMix(s.tension, s.direction, this.doubleTime);
    this.doubleTime = mix.doubleTime;
    // Tempo moves in whole-BPM steps, written only on change. Re-issuing
    // bpm.rampTo every tick crashes Tone 15's transport clock after ~1 min of
    // live tension (TickSource.getTicksAtTime: "reading 'time'"). 1-BPM steps
    // are inaudible, and the smoothed tension already makes them gradual.
    // Tracked even before the graph exists, so the first start lands on it.
    const bpm = Math.round(mix.bpm);
    const bpmChanged = bpm !== this.bpm;
    this.bpm = bpm;
    if (!g) return;
    const ctx = g.mixer.context;
    g.base.setTrend(s.emaZ);
    g.base.applyMix(mix);
    const shock = stepShock(this.shock, s.tension, s.ts);
    this.shock = shock.state;
    if (shock.fired && sounding) g.tension.shock(s.ret >= 0, ctx.now());
    g.tension.applyMix(mix);
    if (bpmChanged && sounding) ctx.transport.bpm.setValueAtTime(bpm, ctx.now());
  }

  /** The tick's event cues, now. */
  play(cues: EventCues, g: Graph): void {
    const t = g.mixer.context.now();
    const { liquidation: liq, trade } = cues;
    if (liq) g.events.liquidation(liq.side, eventVelocity(liq.size), t);
    if (trade) g.events.trade(trade.side, eventVelocity(trade.size), t);
  }
}
