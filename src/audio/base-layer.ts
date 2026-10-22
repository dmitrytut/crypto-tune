import * as Tone from 'tone';
import { arpDegree, type Contour, entryStep, stickyShift } from './arp-pattern';
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
/**
 * Drone root cycle in semitones from the tonic: i → VI → iv → i → III → VII.
 * The arpeggio stays in the tonic's minor pentatonic, which is consonant over
 * every root here (Fmaj7/9, Dm11, C6/9, G6sus over A).
 */
const PROGRESSION = [0, -4, -7, 0, 3, -2] as const;
/** Bars per chord: ~64 s at 60 BPM, so the full cycle takes ~6.4 min. */
const CHORD_BARS = 16;
/** Crossfade between drone voices on a chord change; long enough to never sound like a switch. */
const CHORD_FADE_SEC = 6;
/** Chance a weak-beat note rests in a calm market; tension fills the line back in. */
const MAX_REST_PROB = 0.25;
/** Glide for every tension-driven parameter; mixes arrive every 250 ms. */
const MIX_RAMP_SEC = 0.5;
const VIBRATO_HZ = 5;

interface DroneVoice {
  root: Tone.FatOscillator;
  fifth: Tone.FatOscillator;
}

/**
 * Always-on layer: a soft drone on root + fifth breathing through a slowly
 * swept lowpass and drifting through a slow chord cycle (two voices
 * crossfading, never gliding), and a pentatonic arpeggio. Calm: quarters at
 * 60 BPM behind a closed filter with occasional rests, register following the
 * price vs its hour EMA. Under tension the filter opens, the line fills in,
 * the contour runs with the move from the next note, time doubles on the next
 * beat, the arpeggio wavers and the drone root drifts flat against the fifth.
 * @package
 */
export class BaseLayer {
  private readonly voices: [DroneVoice, DroneVoice];
  /** Equal-power blend of the two drone voices: 0 = voices[0], 1 = voices[1]. */
  private readonly droneBlend = new Tone.CrossFade(0);
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
  private readonly chordLoop: Tone.Loop;
  private tonicPc: number;
  private chordStep = 0;
  /** Index of the sounding drone voice. */
  private active: 0 | 1 = 0;
  private shift = 0;
  private bias = 0;
  private step = 0;
  /** Pattern degree of the last arpeggio step, for seamless contour switches. */
  private lastDegree = 0;
  private contour: Contour = 'calm';
  private nextContour: Contour = 'calm';
  private doubleTime = false;
  private restProb = MAX_REST_PROB;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    const voice = (input: Tone.InputNode): DroneVoice => {
      const rootMidi = this.droneRootMidi();
      const root = new Tone.FatOscillator({
        frequency: midiToHz(rootMidi),
        type: 'sine',
        count: 3,
        spread: 14,
      }).connect(input);
      const fifth = new Tone.FatOscillator({
        frequency: midiToHz(rootMidi + FIFTH),
        type: 'sine',
        count: 2,
        spread: 10,
        volume: -6,
      }).connect(input);
      return { root, fifth };
    };
    this.voices = [voice(this.droneBlend.a), voice(this.droneBlend.b)];
    this.droneSweep.connect(this.droneFilter.frequency);
    this.droneBlend.chain(this.droneFilter, this.droneLevel, output);
    this.arp.chain(this.arpVibrato, this.arpFilter, this.arpEcho, output);

    this.loop = new Tone.Loop((time) => {
      if (this.nextContour !== this.contour) {
        this.contour = this.nextContour;
        this.step = entryStep(this.contour, this.lastDegree);
      }
      const step = this.step++;
      this.lastDegree = arpDegree(step, 0, this.contour);
      // Odd steps are weak beats; resting there thins a calm line without losing the pulse.
      if (step % 2 === 1 && Math.random() < this.restProb) return;
      const degree = this.lastDegree + this.shift + this.bias;
      const midi = degreeToMidi(pitchClassMidi(this.tonicPc, ARP_OCTAVE), degree);
      // Slight velocity variation so the loop never sounds mechanical.
      this.arp.triggerAttackRelease(midiToHz(midi), '2n', time, 0.45 + Math.random() * 0.2);
    }, '4n');
    this.chordLoop = new Tone.Loop((time) => this.nextChord(time), `${CHORD_BARS}m`);
  }

  start(time: number): void {
    for (const v of this.voices) {
      v.root.start(time);
      v.fifth.start(time);
    }
    this.droneSweep.start(time);
    this.droneLevel.gain.setValueAtTime(0, time);
    this.droneLevel.gain.linearRampToValueAtTime(
      Tone.dbToGain(DRONE_LEVEL_DB),
      time + DRONE_FADE_SEC,
    );
    // Loops are placed on the transport timeline once (transport time, not
    // context time) and follow transport start/stop; a restart replays from 0.
    this.loop.start(0);
    this.chordLoop.start(`${CHORD_BARS}m`);
  }

  /** Stops sources at `time`; the caller fades the bus out and stops the transport. */
  stop(time: number): void {
    for (const v of this.voices) {
      v.root.stop(time);
      v.fifth.stop(time);
    }
    this.droneSweep.stop(time);
  }

  setTonic(pc: number): void {
    this.tonicPc = pc;
    const rootMidi = this.droneRootMidi();
    for (const v of this.voices) {
      v.root.frequency.rampTo(midiToHz(rootMidi), TONIC_GLIDE_SEC);
      v.fifth.frequency.rampTo(midiToHz(rootMidi + FIFTH), TONIC_GLIDE_SEC);
    }
  }

  /** `emaZ`: price vs its hour EMA in spread units; moves the arpeggio register. */
  setTrend(emaZ: number): void {
    this.shift = stickyShift(this.shift, emaZ);
  }

  applyMix(mix: TensionMix): void {
    this.arpFilter.frequency.rampTo(mix.arpCutoffHz, MIX_RAMP_SEC);
    this.arpVibrato.depth.rampTo(mix.vibratoDepth, MIX_RAMP_SEC);
    for (const v of this.voices) v.root.detune.rampTo(-mix.droneFlatCents, MIX_RAMP_SEC);
    this.nextContour = mix.contour;
    this.bias = mix.registerBias;
    this.restProb = MAX_REST_PROB * (1 - mix.intensity);
    if (mix.doubleTime !== this.doubleTime) {
      this.doubleTime = mix.doubleTime;
      const interval = mix.doubleTime ? '8n' : '4n';
      // Switch on the next beat so the pulse never stumbles. nextSubdivision
      // returns context time but scheduleOnce reads transport time, so convert
      // through ticks. The loop's own context, not the global one, so the layer
      // also works in offline renders.
      const transport = this.loop.context.transport;
      const beat = Math.round(transport.getTicksAtTime(transport.nextSubdivision('4n')));
      transport.scheduleOnce(() => {
        this.loop.interval = interval;
      }, `${beat}i`);
    }
  }

  private droneRootMidi(): number {
    return pitchClassMidi(this.tonicPc, DRONE_OCTAVE) + (PROGRESSION[this.chordStep] as number);
  }

  /** Retunes the silent voice to the next chord and crossfades to it. */
  private nextChord(time: number): void {
    this.chordStep = (this.chordStep + 1) % PROGRESSION.length;
    this.active = this.active === 0 ? 1 : 0;
    const rootMidi = this.droneRootMidi();
    const v = this.voices[this.active];
    // Drop a pending tonic glide: its end point would pull the voice back to the old chord.
    v.root.frequency.cancelAndHoldAtTime(time);
    v.fifth.frequency.cancelAndHoldAtTime(time);
    v.root.frequency.setValueAtTime(midiToHz(rootMidi), time);
    v.fifth.frequency.setValueAtTime(midiToHz(rootMidi + FIFTH), time);
    this.droneBlend.fade.rampTo(this.active, CHORD_FADE_SEC, time);
  }
}
