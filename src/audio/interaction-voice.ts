import * as Tone from 'tone';
import type { TradeSide } from '../feed/market-feed';
import { degreeToMidi, midiToHz, pitchClassMidi } from './scale';

/** Quiet, monophonic accents for touching particles; independent of market-event voices. @package */
export class InteractionVoice {
  private readonly synth: Tone.Synth;
  private readonly output: Tone.Gain;
  private tonicPc: number;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    this.output = new Tone.Gain(1).connect(output);
    this.synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 0.05, sustain: 0, release: 0.025 },
      volume: -18,
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
    this.synth.triggerAttackRelease(pitch, 0.05, time, 0.2 + 0.25 * strength);
  }

  /** Cancel future gain changes too: Tone's lookahead may already hold a not-yet-audible strike. */
  silence(time: number): void {
    this.output.gain.cancelScheduledValues(time);
    this.output.gain.rampTo(0, 0.005, time);
  }
}
