import * as Tone from 'tone';
import type { MetricsSnapshot } from '../metrics/engine';
import { BaseLayer } from './base-layer';
import { Mixer } from './mixer';
import { TensionLayer } from './tension-layer';
import { tensionMix } from './tension-map';

/** Calm tempo; the tension mix raises it toward 90 BPM. */
const BASE_BPM = 60;
const FADE_IN_SEC = 3;
const FADE_OUT_SEC = 1.5;
const MASTER_DB = -2;

export interface AudioParams {
  /** Tonic pitch class, 0 = C … 11 = B. */
  tonicPc: number;
  baseVolumeDb: number;
  tensionVolumeDb: number;
}

export type AudioState = 'stopped' | 'starting' | 'running';

interface Graph {
  mixer: Mixer;
  base: BaseLayer;
  baseChannel: Tone.Volume;
  tension: TensionLayer;
  tensionChannel: Tone.Volume;
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

  setParams(next: AudioParams): void {
    const prev = this.params;
    this.params = next;
    const g = this.graph;
    if (!g) return;
    if (next.tonicPc !== prev.tonicPc) {
      g.base.setTonic(next.tonicPc);
      g.tension.setTonic(next.tonicPc);
    }
    if (next.baseVolumeDb !== prev.baseVolumeDb) {
      g.mixer.setLevel(g.baseChannel, next.baseVolumeDb);
    }
    if (next.tensionVolumeDb !== prev.tensionVolumeDb) {
      g.mixer.setLevel(g.tensionChannel, next.tensionVolumeDb);
    }
  }

  private build(): Graph {
    const mixer = new Mixer();
    const baseChannel = mixer.createChannel(this.params.baseVolumeDb);
    const tensionChannel = mixer.createChannel(this.params.tensionVolumeDb);
    this.graph = {
      mixer,
      baseChannel,
      tensionChannel,
      base: new BaseLayer(baseChannel, this.params.tonicPc),
      tension: new TensionLayer(tensionChannel, this.params.tonicPc),
    };
    return this.graph;
  }
}
