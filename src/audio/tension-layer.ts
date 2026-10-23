import * as Tone from 'tone';
import { midiToHz, pitchClassMidi, TONIC_GLIDE_SEC } from './scale';
import { MIX_RAMP_SEC, type TensionMix } from './tension-map';
import { stepIndex } from './transport-step';

/** Sub-bass on the tonic in octave 1 (A1 = 55 Hz). */
const SUB_OCTAVE = 1;
/** Full-intensity linear gains of each element. */
const SUB_MAX_GAIN = Tone.dbToGain(0);
const PERC_MAX_GAIN = Tone.dbToGain(-6);
const RISER_MAX_GAIN = Tone.dbToGain(-4);
/** Shaker accents over two beats of eighths, repeated: strong, soft, medium, soft. */
const PERC_ACCENTS = [1, 0.35, 0.6, 0.35] as const;
/** Shock swell: pink-noise band sweeping with the move; gain > 1 offsets the narrow band. */
const SHOCK_GAIN = Tone.dbToGain(9);
const SHOCK_ATTACK_SEC = 0.6;
const SHOCK_RELEASE_SEC = 1.4;
const SHOCK_LOW_HZ = 300;
const SHOCK_HIGH_HZ = 4000;

/**
 * Silent while calm; fades in with tension. Between mid and high: a soft sub
 * pulse on half notes and a quiet high shaker on eighths. Above high: a
 * filtered pink-noise riser whose band climbs with the peak. On a sudden move,
 * a one-shot noise swell sweeping up or down with the price. Sources run
 * continuously and only their gains move, so nothing ever switches on with a click.
 * @package
 */
export class TensionLayer {
  private readonly sub = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.04, decay: 0.3, sustain: 0.6, release: 0.9 },
  });
  private readonly subLevel = new Tone.Gain(0);
  private readonly perc = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
  });
  private readonly percFilter = new Tone.Filter({ type: 'highpass', frequency: 6500 });
  private readonly percLevel = new Tone.Gain(0);
  private readonly riser = new Tone.Noise('pink');
  private readonly riserFilter = new Tone.Filter({ type: 'bandpass', frequency: 400, Q: 1.2 });
  private readonly riserLevel = new Tone.Gain(0);
  private readonly shockFilter = new Tone.Filter({
    type: 'bandpass',
    frequency: SHOCK_LOW_HZ,
    Q: 1,
  });
  private readonly shockLevel = new Tone.Gain(0);
  private readonly subLoop: Tone.Loop;
  private readonly percLoop: Tone.Loop;
  private subHz: number;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.subHz = midiToHz(pitchClassMidi(tonicPc, SUB_OCTAVE));
    this.sub.chain(this.subLevel, output);
    this.perc.chain(this.percFilter, this.percLevel, output);
    this.riser.chain(this.riserFilter, this.riserLevel, output);
    // One noise source feeds both bands: the riser and the shock swell.
    this.riser.chain(this.shockFilter, this.shockLevel, output);

    this.subLoop = new Tone.Loop((time) => {
      this.sub.triggerAttackRelease(this.subHz, '4n', time, 0.8);
    }, '2n');
    const transport = this.perc.context.transport;
    this.percLoop = new Tone.Loop((time) => {
      // Eighth in the beat from the transport, so accents stay on the beat after a restart.
      const eighth = stepIndex(
        transport.getTicksAtTime(time),
        transport.PPQ / 2,
        PERC_ACCENTS.length,
      );
      const accent = PERC_ACCENTS[eighth] as number;
      this.perc.triggerAttackRelease('32n', time, accent);
    }, '8n');
  }

  start(time: number): void {
    this.riser.start(time);
    // Transport time, placed once: the loops follow transport start/stop.
    this.subLoop.start(0);
    this.percLoop.start(0);
  }

  stop(time: number): void {
    this.riser.stop(time);
  }

  setTonic(pc: number): void {
    this.subHz = midiToHz(pitchClassMidi(pc, SUB_OCTAVE));
    // A sounding sub note glides; the next pulses start on the new pitch.
    this.sub.frequency.rampTo(this.subHz, TONIC_GLIDE_SEC);
  }

  applyMix(mix: TensionMix): void {
    this.subLevel.gain.rampTo(SUB_MAX_GAIN * mix.subLevel, MIX_RAMP_SEC);
    this.percLevel.gain.rampTo(PERC_MAX_GAIN * mix.percLevel, MIX_RAMP_SEC);
    this.riserLevel.gain.rampTo(RISER_MAX_GAIN * mix.riserLevel, MIX_RAMP_SEC);
    this.riserFilter.frequency.rampTo(mix.riserHz, MIX_RAMP_SEC);
  }

  /** Noise swell at `time`: sweeps up for a rising price, down for a falling one. */
  shock(up: boolean, time: number): void {
    const [from, to] = up ? [SHOCK_LOW_HZ, SHOCK_HIGH_HZ] : [SHOCK_HIGH_HZ, SHOCK_LOW_HZ];
    const end = time + SHOCK_ATTACK_SEC + SHOCK_RELEASE_SEC;
    const f = this.shockFilter.frequency;
    f.cancelScheduledValues(time);
    f.setValueAtTime(from, time);
    f.exponentialRampToValueAtTime(to, end);
    const g = this.shockLevel.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(SHOCK_GAIN, time + SHOCK_ATTACK_SEC);
    g.linearRampToValueAtTime(0, end);
  }
}
