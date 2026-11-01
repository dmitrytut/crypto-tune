import * as Tone from 'tone';
import type { TradeSide } from '../feed/market-feed';
import { degreeToMidi, midiToHz, pitchClassMidi } from './scale';

/** Short, monophonic accents for touching particles; independent of market-event voices. @package */
export class InteractionVoice {
  private readonly synth: Tone.Synth;
  private readonly output: Tone.Gain;
  private tonicPc: number;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    this.output = new Tone.Gain(1).connect(output);
    // Loud and long enough to cut through the drone: at -18 dB with a 50 ms sine it peaked
    // about 12 dB under the music's RMS and was inaudible.
    this.synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.003, decay: 0.14, sustain: 0, release: 0.12 },
      volume: -8,
    }).connect(this.output);
  }

  setTonic(pc: number): void {
    this.tonicPc = pc;
  }

  touch(side: TradeSide, strength: number, time: number): void {
    this.output.gain.rampTo(1, 0.004, time);
    // A higher pentatonic note makes a buy feel lighter; a lower one gives sells a soft tick.
    const degree = side === 'buy' ? 2 : -2;
    const pitch = midiToHz(degreeToMidi(pitchClassMidi(this.tonicPc, 5), degree));
    this.synth.triggerAttackRelease(pitch, 0.08, time, 0.5 + 0.5 * strength);
  }

  /** Cancel future gain changes too: Tone's lookahead may already hold a not-yet-audible strike. */
  silence(time: number): void {
    this.output.gain.cancelScheduledValues(time);
    this.output.gain.rampTo(0, 0.005, time);
  }
}
