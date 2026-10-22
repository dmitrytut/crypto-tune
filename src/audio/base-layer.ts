import * as Tone from 'tone';
import { arpDegree, stickyShift } from './arp-pattern';
import { degreeToMidi, pitchClassMidi } from './scale';

/** Drone sits in octave 2 (A2 = 110 Hz), arpeggio starts an octave higher. */
const DRONE_OCTAVE = 2;
const ARP_OCTAVE = 3;
/** Perfect fifth above the drone root. */
const FIFTH = 7;
const TONIC_GLIDE_SEC = 3;
const DRONE_FADE_SEC = 4;
const DRONE_LEVEL_DB = -9;

const midiHz = (midi: number) => Tone.Frequency(midi, 'midi').toFrequency();

/**
 * Always-on layer: a soft drone on tonic + fifth breathing through a slowly
 * swept lowpass, and a slow pentatonic arpeggio whose register follows the
 * price relative to its hour EMA.
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
  private readonly arpEcho = new Tone.FeedbackDelay({
    delayTime: '4n.',
    feedback: 0.28,
    wet: 0.22,
  });
  private readonly loop: Tone.Loop;
  private tonicPc: number;
  private shift = 0;
  private step = 0;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    const rootMidi = pitchClassMidi(tonicPc, DRONE_OCTAVE);
    this.root = new Tone.FatOscillator({
      frequency: midiHz(rootMidi),
      type: 'sine',
      count: 3,
      spread: 14,
    });
    this.fifth = new Tone.FatOscillator({
      frequency: midiHz(rootMidi + FIFTH),
      type: 'sine',
      count: 2,
      spread: 10,
      volume: -6,
    });
    this.root.connect(this.droneFilter);
    this.fifth.connect(this.droneFilter);
    this.droneSweep.connect(this.droneFilter.frequency);
    this.droneFilter.chain(this.droneLevel, output);
    this.arp.chain(this.arpEcho, output);

    this.loop = new Tone.Loop((time) => {
      const degree = arpDegree(this.step++, this.shift);
      const midi = degreeToMidi(pitchClassMidi(this.tonicPc, ARP_OCTAVE), degree);
      // Slight velocity variation so the loop never sounds mechanical.
      this.arp.triggerAttackRelease(midiHz(midi), '2n', time, 0.45 + Math.random() * 0.2);
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
    this.root.frequency.rampTo(midiHz(rootMidi), TONIC_GLIDE_SEC);
    this.fifth.frequency.rampTo(midiHz(rootMidi + FIFTH), TONIC_GLIDE_SEC);
  }

  /** `emaZ`: price vs its hour EMA in spread units; moves the arpeggio register. */
  setTrend(emaZ: number): void {
    this.shift = stickyShift(this.shift, emaZ);
  }
}
