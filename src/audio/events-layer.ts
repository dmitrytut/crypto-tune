import * as Tone from 'tone';
import type { LiquidationSide, TradeSide } from '../feed/market-feed';
import { LIQUIDATION_VOICES, TRADE_VOICES, type VoicePlacement } from './events-map';
import { degreeToMidi, midiToHz, pitchClassMidi } from './scale';

/** Strikes ring out on their own envelope; the note-off only starts the release. */
const STRIKE_SEC = 0.1;
const MAX_GONG_VOICES = 4;

/**
 * One-shot sounds for market events. Liquidations: FM gongs — long is a low,
 * dark, inharmonic gong; short a brighter bell. Large trades: a short pluck,
 * buys right/high, sells left/low. Pitches come from the current tonic's
 * pentatonic, so events never clash with the drone.
 * @package
 */
export class EventsLayer {
  private readonly gongs: Record<LiquidationSide, Tone.PolySynth<Tone.FMSynth>>;
  private readonly plucks: Record<TradeSide, Tone.Synth>;
  private tonicPc: number;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    const longTone = new Tone.Filter({ type: 'lowpass', frequency: 1400 }).connect(output);
    this.gongs = {
      long: gong({ harmonicity: 1.41, modulationIndex: 7, decay: 4.5 }).connect(longTone),
      short: gong({ harmonicity: 3.01, modulationIndex: 10, decay: 2.5 }).connect(output),
    };
    // The lower sell note carries ~5 dB more energy; trim it so both sides sound equal.
    this.plucks = {
      buy: pluck(-1).connect(new Tone.Panner(TRADE_VOICES.buy.pan).connect(output)),
      sell: pluck(-6).connect(new Tone.Panner(TRADE_VOICES.sell.pan).connect(output)),
    };
  }

  setTonic(pc: number): void {
    this.tonicPc = pc;
  }

  liquidation(side: LiquidationSide, velocity: number, time: number): void {
    this.gongs[side].triggerAttackRelease(
      this.hz(LIQUIDATION_VOICES[side]),
      STRIKE_SEC,
      time,
      velocity,
    );
  }

  trade(side: TradeSide, velocity: number, time: number): void {
    this.plucks[side].triggerAttackRelease(this.hz(TRADE_VOICES[side]), STRIKE_SEC, time, velocity);
  }

  private hz(v: VoicePlacement): number {
    return midiToHz(degreeToMidi(pitchClassMidi(this.tonicPc, v.octave), v.degree));
  }
}

function gong(o: { harmonicity: number; modulationIndex: number; decay: number }) {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: o.harmonicity,
    modulationIndex: o.modulationIndex,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.004, decay: o.decay, sustain: 0, release: o.decay },
    // Brightness dies faster than the body: the strike shimmers, then hums.
    modulationEnvelope: { attack: 0.002, decay: o.decay / 3, sustain: 0.05, release: o.decay / 2 },
    volume: 0,
  });
  synth.maxPolyphony = MAX_GONG_VOICES;
  return synth;
}

function pluck(volumeDb: number): Tone.Synth {
  return new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.25 },
    volume: volumeDb,
  });
}
