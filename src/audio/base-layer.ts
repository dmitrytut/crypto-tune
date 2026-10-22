import * as Tone from 'tone';
import { arpDegree, type Contour, PHRASE_STEPS, stickyShift } from './arp-pattern';
import { degreeToMidi, midiToHz, pitchClassMidi } from './scale';
import type { TensionMix } from './tension-map';

/** Drone sits in octave 2 (A2 = 110 Hz), arpeggio starts an octave higher. */
const DRONE_OCTAVE = 2;
const ARP_OCTAVE = 3;
/** Perfect fifth above the drone root. */
const FIFTH = 7;
const TONIC_GLIDE_SEC = 3;
const DRONE_FADE_SEC = 4;
const DRONE_LEVEL_DB = -9;
/** Glide for every tension-driven parameter; mixes arrive every 250 ms. */
const MIX_RAMP_SEC = 0.5;
const VIBRATO_HZ = 5;

/**
 * Always-on layer: a soft drone on tonic + fifth breathing through a slowly
 * swept lowpass, and a pentatonic arpeggio. Calm: quarters at 60 BPM behind a
 * closed filter, register following the price vs its hour EMA. Under tension
 * the filter opens, the contour runs with the move, time doubles, the
 * arpeggio wavers and the drone root drifts flat against the fifth.
 * @package
 */
export class BaseLayer {
  private readonly root: Tone.FatOscillator;
  private readonly fifth: Tone.FatOscillator;
  private readonly droneLevel = new Tone.Gain(0);
  private readonly droneFilter = new Tone.Filter({ type: 'lowpass', frequency: 500, Q: 0.5 });
  private readonly droneSweep = new Tone.LFO({ frequency: 0.03, min: 280, max: 900 });
  private readonly arp = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.03, decay: 0.6, sustain: 0.15, release: 2.2 },
    volume: -5,
  });
  private readonly arpVibrato = new Tone.Vibrato({ frequency: VIBRATO_HZ, depth: 0 });
  private readonly arpFilter = new Tone.Filter({ type: 'lowpass', frequency: 1000, Q: 0.7 });
  private readonly arpEcho = new Tone.FeedbackDelay({
    delayTime: '4n.',
    feedback: 0.28,
    wet: 0.22,
  });
  private readonly loop: Tone.Loop;
  private tonicPc: number;
  private shift = 0;
  private bias = 0;
  private step = 0;
  private contour: Contour = 'calm';
  private nextContour: Contour = 'calm';
  private doubleTime = false;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    const rootMidi = pitchClassMidi(tonicPc, DRONE_OCTAVE);
    this.root = new Tone.FatOscillator({
      frequency: midiToHz(rootMidi),
      type: 'sine',
      count: 3,
      spread: 14,
    });
    this.fifth = new Tone.FatOscillator({
      frequency: midiToHz(rootMidi + FIFTH),
      type: 'sine',
      count: 2,
      spread: 10,
      volume: -6,
    });
    this.root.connect(this.droneFilter);
    this.fifth.connect(this.droneFilter);
    this.droneSweep.connect(this.droneFilter.frequency);
    this.droneFilter.chain(this.droneLevel, output);
    this.arp.chain(this.arpVibrato, this.arpFilter, this.arpEcho, output);

    this.loop = new Tone.Loop((time) => {
      // Contour changes wait for the phrase boundary so a run is never cut mid-way.
      if (this.step % PHRASE_STEPS === 0) this.contour = this.nextContour;
      const degree = arpDegree(this.step++, this.shift + this.bias, this.contour);
      const midi = degreeToMidi(pitchClassMidi(this.tonicPc, ARP_OCTAVE), degree);
      // Slight velocity variation so the loop never sounds mechanical.
      this.arp.triggerAttackRelease(midiToHz(midi), '2n', time, 0.45 + Math.random() * 0.2);
    }, '4n');
  }

  start(time: number): void {
    this.root.start(time);
    this.fifth.start(time);
    this.droneSweep.start(time);
    this.droneLevel.gain.setValueAtTime(0, time);
    this.droneLevel.gain.linearRampToValueAtTime(
      Tone.dbToGain(DRONE_LEVEL_DB),
      time + DRONE_FADE_SEC,
    );
    this.loop.start(time);
  }

  /** Stops sources at `time`; the caller fades the bus out before that. */
  stop(time: number): void {
    this.loop.stop(time);
    this.root.stop(time);
    this.fifth.stop(time);
    this.droneSweep.stop(time);
  }

  setTonic(pc: number): void {
    this.tonicPc = pc;
    const rootMidi = pitchClassMidi(pc, DRONE_OCTAVE);
    this.root.frequency.rampTo(midiToHz(rootMidi), TONIC_GLIDE_SEC);
    this.fifth.frequency.rampTo(midiToHz(rootMidi + FIFTH), TONIC_GLIDE_SEC);
  }

  /** `emaZ`: price vs its hour EMA in spread units; moves the arpeggio register. */
  setTrend(emaZ: number): void {
    this.shift = stickyShift(this.shift, emaZ);
  }

  applyMix(mix: TensionMix): void {
    this.arpFilter.frequency.rampTo(mix.arpCutoffHz, MIX_RAMP_SEC);
    this.arpVibrato.depth.rampTo(mix.vibratoDepth, MIX_RAMP_SEC);
    this.root.detune.rampTo(-mix.droneFlatCents, MIX_RAMP_SEC);
    this.nextContour = mix.contour;
    this.bias = mix.registerBias;
    if (mix.doubleTime !== this.doubleTime) {
      this.doubleTime = mix.doubleTime;
      const interval = mix.doubleTime ? '8n' : '4n';
      // Switch on the next bar line so the pulse never stumbles. The loop's own
      // context, not the global one, so the layer also works in offline renders.
      const transport = this.loop.context.transport;
      transport.scheduleOnce(() => {
        this.loop.interval = interval;
      }, transport.nextSubdivision('1m'));
    }
  }
}
