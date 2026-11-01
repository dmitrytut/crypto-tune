import * as Tone from 'tone';
import type { TradeSide } from '../feed/market-feed';
import type { MetricsSnapshot } from '../metrics/engine';
import type { EventCues } from '../metrics/events';
import {
  type AudioParams,
  buildGraph,
  Conductor,
  type Graph,
  LOOKAHEAD_SEC,
  startGraph,
} from './graph';

const FADE_OUT_SEC = 1.5;
const TOUCH_SPACING_SEC = 0.1;
/**
 * Live scheduling headroom while a clip renders, s (Tone's default is 0.1): building the clip's
 * graph is one synchronous task of 100–200 ms on a slow CPU, which made a live note late.
 */
const RENDER_LOOKAHEAD_SEC = 0.3;

/** @package */
export type AudioState = 'stopped' | 'starting' | 'running';

/**
 * Owns the Tone.js graph. Built lazily on the first start(), which must run
 * inside a user gesture (browser autoplay policy). Stop fades out and keeps
 * the graph for the next start.
 */
export class AudioEngine {
  private graph: Graph | null = null;
  private state: AudioState = 'stopped';
  private readonly conductor = new Conductor();
  /** Context time at which the last stop's scheduled teardown (sources, transport) runs. */
  private stopAt = 0;
  private lastTouchAt = Number.NEGATIVE_INFINITY;

  constructor(private params: AudioParams) {}

  get current(): AudioState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.state = 'starting';
    try {
      await Tone.start();
      const g = this.graph ?? (await this.build());
      // shortcut: a failed reverb impulse is not retried; every later start rejects here until
      // a reload. Tone keeps the rejected `ready` (a new generate() awaits it first) and the
      // layers have no dispose, so a rebuild would double the transport loops. An offline
      // render failing is very unlikely; a real report would justify a disposable graph.
      await g.mixer.ready;
      // A restart before the last stop's teardown would be undone by it: Tone ignores
      // transport.start while the pending stop still reads "started", then stops.
      const pending = this.stopAt - Tone.now();
      if (pending > 0) await wait(pending * 1000);
      // Resume at the market's current tempo: update() keeps tracking it while stopped,
      // so restarting mid-move does not drop to calm and jump back on the next tick.
      startGraph(g, this.conductor.bpm, Tone.now() + LOOKAHEAD_SEC);
      this.lastTouchAt = Number.NEGATIVE_INFINITY;
      this.state = 'running';
    } catch (err) {
      // Left "starting", every later press would return at once and report a silent start.
      this.state = 'stopped';
      throw err;
    }
  }

  stop(): void {
    const g = this.graph;
    if (this.state !== 'running' || !g) return;
    g.interaction.silence(Tone.immediate());
    g.mixer.fadeMaster(Number.NEGATIVE_INFINITY, FADE_OUT_SEC);
    const end = Tone.now() + FADE_OUT_SEC + 0.1;
    this.stopAt = end;
    g.base.stop(end);
    g.tension.stop(end);
    Tone.getTransport().stop(end);
    this.lastTouchAt = Number.NEGATIVE_INFINITY;
    this.state = 'stopped';
  }

  update(s: MetricsSnapshot): void {
    this.conductor.update(s, this.graph, this.state === 'running');
  }

  /** Once per tick: plays the tick's event cues if audio is running. */
  play(cues: EventCues): void {
    const g = this.graph;
    if (this.state !== 'running' || !g) return;
    this.conductor.play(cues, g);
  }

  /** Immediate, opt-in particle accent; never wakes audio or enters the market cue pipeline. */
  touch(side: TradeSide, strength: number): void {
    const g = this.graph;
    if (
      this.state !== 'running' ||
      !this.params.interactionSound ||
      Tone.getContext().state !== 'running' ||
      !g
    )
      return;
    const now = Tone.now();
    if (now >= this.lastTouchAt && now - this.lastTouchAt < TOUCH_SPACING_SEC) return;
    this.lastTouchAt = now;
    g.interaction.touch(side, Math.min(1, Math.max(0, strength)), now);
  }

  setParams(next: AudioParams): void {
    const prev = this.params;
    this.params = next;
    const g = this.graph;
    if (!g) return;
    if (prev.interactionSound && !next.interactionSound) {
      g.interaction.silence(Tone.immediate());
    }
    if (next.tonicPc !== prev.tonicPc) {
      g.base.setTonic(next.tonicPc);
      g.ambience.setTonic(next.tonicPc);
      g.tension.setTonic(next.tonicPc);
      g.events.setTonic(next.tonicPc);
      g.interaction.setTonic(next.tonicPc);
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
   * Runs `work` (a clip render) with more live scheduling headroom, so its long tasks do not make
   * live notes late; live cues sound up to RENDER_LOOKAHEAD_SEC later meanwhile.
   */
  async withHeadroom<T>(work: () => Promise<T>): Promise<T> {
    const ctx = Tone.getContext();
    const before = ctx.lookAhead;
    ctx.lookAhead = Math.max(before, RENDER_LOOKAHEAD_SEC);
    try {
      return await work();
    } finally {
      ctx.lookAhead = before;
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
    const steps = buildGraph(p);
    // Each wait(0) ends the task, so the browser can paint and handle input between steps.
    await wait(0);
    let step = steps.next();
    while (!step.done) {
      await wait(0);
      step = steps.next();
    }
    this.graph = step.value;
    // Settings changed while building: setParams diffs against what the layers were built with.
    const latest = this.params;
    this.params = p;
    this.setParams(latest);
    return this.graph;
  }
}

/** Resolves after `ms` in a new task. */
function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
