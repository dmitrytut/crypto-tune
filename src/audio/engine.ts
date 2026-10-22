import * as Tone from 'tone';
import type { MetricsSnapshot } from '../metrics/engine';
import { BaseLayer } from './base-layer';
import { Mixer } from './mixer';

/** Slow, meditative base tempo; the tension layer will raise it. */
const BASE_BPM = 60;
const FADE_IN_SEC = 3;
const FADE_OUT_SEC = 1.5;
const MASTER_DB = -2;

export interface AudioParams {
  /** Tonic pitch class, 0 = C … 11 = B. */
  tonicPc: number;
  baseVolumeDb: number;
}

export type AudioState = 'stopped' | 'starting' | 'running';

/**
 * Owns the Tone.js graph. Built lazily on the first start(), which must run
 * inside a user gesture (browser autoplay policy). Stop fades out and keeps
 * the graph for the next start.
 */
export class AudioEngine {
  private mixer: Mixer | null = null;
  private base: BaseLayer | null = null;
  private baseChannel: Tone.Volume | null = null;
  private state: AudioState = 'stopped';

  constructor(private params: AudioParams) {}

  get current(): AudioState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.state = 'starting';
    await Tone.start();
    if (!this.mixer) {
      this.mixer = new Mixer();
      this.baseChannel = this.mixer.createChannel(this.params.baseVolumeDb);
      this.base = new BaseLayer(this.baseChannel, this.params.tonicPc);
    }
    await this.mixer.ready;
    const transport = Tone.getTransport();
    transport.bpm.value = BASE_BPM;
    const t = Tone.now() + 0.05;
    this.base?.start(t);
    transport.start(t);
    this.mixer.fadeMaster(MASTER_DB, FADE_IN_SEC);
    this.state = 'running';
  }

  stop(): void {
    if (this.state !== 'running' || !this.mixer) return;
    this.mixer.fadeMaster(Number.NEGATIVE_INFINITY, FADE_OUT_SEC);
    const end = Tone.now() + FADE_OUT_SEC + 0.1;
    this.base?.stop(end);
    Tone.getTransport().stop(end);
    this.state = 'stopped';
  }

  update(s: MetricsSnapshot): void {
    this.base?.setTrend(s.emaZ);
  }

  setParams(next: AudioParams): void {
    const prev = this.params;
    this.params = next;
    if (next.tonicPc !== prev.tonicPc) this.base?.setTonic(next.tonicPc);
    if (next.baseVolumeDb !== prev.baseVolumeDb && this.mixer && this.baseChannel) {
      this.mixer.setLevel(this.baseChannel, next.baseVolumeDb);
    }
  }
}
