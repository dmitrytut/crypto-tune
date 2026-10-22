import * as Tone from 'tone';
import type { Liquidation, LiquidationSide, Trade, TradeSide } from '../feed/market-feed';
import type { MetricsSnapshot } from '../metrics/engine';
import { AmbienceLayer } from './ambience-layer';
import { BaseLayer } from './base-layer';
import { EventsLayer } from './events-layer';
import { collapse, type EventCue, eventVelocity, type PendingEvent } from './events-map';
import { Mixer } from './mixer';
import { TensionLayer } from './tension-layer';
import { INITIAL_SHOCK, type ShockState, stepShock, tensionMix } from './tension-map';

/** Calm tempo; the tension mix raises it toward 90 BPM. */
const BASE_BPM = 60;
const FADE_IN_SEC = 3;
const FADE_OUT_SEC = 1.5;
const MASTER_DB = -2;
/** Events older than this on the feed clock are dropped instead of played late. */
const EVENT_MAX_AGE_MS = 2_000;

export interface AudioParams {
  /** Tonic pitch class, 0 = C … 11 = B. */
  tonicPc: number;
  baseVolumeDb: number;
  tensionVolumeDb: number;
  eventsVolumeDb: number;
  /** Liquidations at or above this quote notional strike a gong. */
  liqThresholdUsd: number;
  /** Aggressive trades at or above this quote notional pluck an accent. */
  tradeThresholdUsd: number;
}

export type AudioState = 'stopped' | 'starting' | 'running';

/** What one tick's events collapsed to; each kind plays at most one voice. */
export interface EventCues {
  liquidation: EventCue<LiquidationSide> | null;
  trade: EventCue<TradeSide> | null;
}

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
  /** Last tempo written to the transport, whole BPM. */
  private bpm = BASE_BPM;
  private shock: ShockState = INITIAL_SHOCK;
  private pendingLiqs: PendingEvent<LiquidationSide>[] = [];
  private pendingTrades: PendingEvent<TradeSide>[] = [];

  constructor(private params: AudioParams) {}

  get current(): AudioState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.state = 'starting';
    await Tone.start();
    const g = this.graph ?? this.build();
    await g.mixer.ready;
    const transport = Tone.getTransport();
    transport.bpm.value = BASE_BPM;
    this.bpm = BASE_BPM;
    const t = Tone.now() + 0.05;
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
    g.base.stop(end);
    g.tension.stop(end);
    Tone.getTransport().stop(end);
    this.state = 'stopped';
  }

  update(s: MetricsSnapshot): void {
    const g = this.graph;
    if (!g) return;
    const mix = tensionMix(s.tension, s.direction, this.doubleTime);
    this.doubleTime = mix.doubleTime;
    g.base.setTrend(s.emaZ);
    g.base.applyMix(mix);
    const shock = stepShock(this.shock, s.tension, s.ts);
    this.shock = shock.state;
    if (shock.fired && this.state === 'running') g.tension.shock(s.ret >= 0, Tone.now());
    g.tension.applyMix(mix);
    // Tempo moves in whole-BPM steps, written only on change. Re-issuing
    // bpm.rampTo every tick crashes Tone 15's transport clock after ~1 min of
    // live tension (TickSource.getTicksAtTime: "reading 'time'"). 1-BPM steps
    // are inaudible, and the smoothed tension already makes them gradual.
    const bpm = Math.round(mix.bpm);
    if (bpm !== this.bpm) {
      this.bpm = bpm;
      const transport = Tone.getTransport();
      transport.bpm.setValueAtTime(bpm, Tone.now());
    }
  }

  /** Called for every trade; only those above the threshold are kept. */
  onTrade(t: Trade): void {
    const usd = t.price * t.qty;
    if (usd >= this.params.tradeThresholdUsd)
      this.pendingTrades.push({ ts: t.ts, side: t.side, usd });
  }

  onLiquidation(l: Liquidation): void {
    if (l.usd >= this.params.liqThresholdUsd)
      this.pendingLiqs.push({ ts: l.ts, side: l.side, usd: l.usd });
  }

  /**
   * Once per tick: collapses buffered events into at most one cue per kind and
   * plays them if audio is running. Returns the cues either way so the UI can
   * show events while muted. `now` is the feed clock.
   */
  flushEvents(now: number): EventCues {
    const minTs = now - EVENT_MAX_AGE_MS;
    const cues: EventCues = {
      liquidation: collapse(this.pendingLiqs, minTs),
      trade: collapse(this.pendingTrades, minTs),
    };
    this.pendingLiqs = [];
    this.pendingTrades = [];
    const g = this.graph;
    if (this.state === 'running' && g) {
      const t = Tone.now();
      const { liquidation: liq, trade } = cues;
      if (liq)
        g.events.liquidation(liq.side, eventVelocity(liq.usd, this.params.liqThresholdUsd), t);
      if (trade)
        g.events.trade(trade.side, eventVelocity(trade.usd, this.params.tradeThresholdUsd), t);
    }
    return cues;
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

  private build(): Graph {
    const mixer = new Mixer();
    const baseChannel = mixer.createChannel(this.params.baseVolumeDb);
    const tensionChannel = mixer.createChannel(this.params.tensionVolumeDb);
    const eventsChannel = mixer.createChannel(this.params.eventsVolumeDb);
    this.graph = {
      mixer,
      baseChannel,
      tensionChannel,
      eventsChannel,
      base: new BaseLayer(baseChannel, this.params.tonicPc),
      ambience: new AmbienceLayer(baseChannel, this.params.tonicPc),
      tension: new TensionLayer(tensionChannel, this.params.tonicPc),
      events: new EventsLayer(eventsChannel, this.params.tonicPc),
    };
    return this.graph;
  }
}
